const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const MUSIC_DIR = path.join(__dirname, 'music');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'; // Default fallback

// Ensure music directory exists
if (!fs.existsSync(MUSIC_DIR)) {
    fs.mkdirSync(MUSIC_DIR);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve public player
app.use('/admin', express.static('admin')); // Serve admin panel
app.use('/music', express.static(MUSIC_DIR)); // Serve music files

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, MUSIC_DIR);
    },
    filename: (req, file, cb) => {
        // Use original name directly. Modern browsers send UTF-8.
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// Auth Middleware
const checkAuth = (req, res, next) => {
    const password = req.headers['x-admin-password'] || req.query.password;
    if (password === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// Verify Auth Endpoint
app.post('/api/verify', checkAuth, (req, res) => {
    res.json({ success: true });
});

// --- API Routes ---

// 1. Get Playlist (Public)
app.get('/api/playlist', (req, res) => {
    fs.readdir(MUSIC_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to scan directory' });
        }

        const musicFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext);
        }).map(file => ({
            name: file,
            url: `/music/${encodeURIComponent(file)}`
        }));

        res.json(musicFiles);
    });
});

// 2. Upload File (Protected)
app.post('/api/upload', checkAuth, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ message: 'File uploaded successfully', filename: req.file.filename });
});

// 3. Delete File (Protected)
app.delete('/api/music/:filename', checkAuth, (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(MUSIC_DIR, filename);

    // Security check: prevent directory traversal
    if (!filepath.startsWith(MUSIC_DIR)) {
        return res.status(403).json({ error: 'Invalid filename' });
    }

    if (fs.existsSync(filepath)) {
        fs.unlink(filepath, (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete file' });
            }
            res.json({ message: 'File deleted successfully' });
        });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// --- New Features ---

const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

function getSettings() {
    if (!fs.existsSync(SETTINGS_FILE)) {
        return { siteTitle: 'Scan to Listen' };
    }
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE));
    } catch (e) {
        return { siteTitle: 'Scan to Listen' };
    }
}

function saveSettings(settings) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// 4. Rename File (Protected)
app.put('/api/music/:filename', checkAuth, (req, res) => {
    const oldName = req.params.filename;
    const newName = req.body.newName;

    if (!newName) return res.status(400).json({ error: 'New name required' });

    // Sanitize new name (basic)
    const safeNewName = path.basename(newName);

    // Ensure extension remains or is valid if user provided one? 
    // For simplicity, we assume user provides full name. 
    // But safer to keep original extension if user didn't provide one?
    // Let's just trust the user input for now but ensure it's a filename.

    const oldPath = path.join(MUSIC_DIR, oldName);
    const newPath = path.join(MUSIC_DIR, safeNewName);

    // Security check
    if (!oldPath.startsWith(MUSIC_DIR) || !newPath.startsWith(MUSIC_DIR)) {
        return res.status(403).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'File not found' });
    if (fs.existsSync(newPath)) return res.status(400).json({ error: 'File already exists' });

    fs.rename(oldPath, newPath, (err) => {
        if (err) return res.status(500).json({ error: 'Rename failed' });
        res.json({ message: 'Renamed successfully', newName: safeNewName });
    });
});

// 5. Get Settings (Public)
app.get('/api/settings', (req, res) => {
    res.json(getSettings());
});

// 6. Update Settings (Protected)
app.post('/api/settings', checkAuth, (req, res) => {
    const settings = req.body;
    saveSettings(settings);
    res.json({ message: 'Settings saved' });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Music directory: ${MUSIC_DIR}`);
});
