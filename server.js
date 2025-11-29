const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Rate limiting
const rateLimit = require('express-rate-limit');

// General rate limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later' }
});

// Auth rate limiting
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 auth requests per windowMs
    message: { error: 'Too many authentication attempts, please try again later' }
});

const app = express();
const PORT = process.env.PORT || 3000;
const MUSIC_DIR = path.join(__dirname, 'music');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'; // Default fallback

// Ensure music directory exists
if (!fs.existsSync(MUSIC_DIR)) {
    fs.mkdirSync(MUSIC_DIR);
}

// Security middleware
app.use((req, res, next) => {
    // Prevent XSS
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Prevent content type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    // Enable HSTS
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Content Security Policy
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data:; " +
        "media-src 'self'; " +
        "connect-src 'self'"
    );
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Middleware
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(generalLimiter); // Apply general rate limiting
app.use(express.static('public')); // Serve public player
app.use('/admin', express.static('admin')); // Serve admin panel
app.use('/music', express.static(MUSIC_DIR)); // Serve music files

// File upload security settings
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit
const ALLOWED_MIME_TYPES = [
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/mp4',
    'audio/x-m4a'
];
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a'];

// Sanitize filename
function sanitizeFilename(filename) {
    if (!filename) return 'unnamed';

    // Remove dangerous characters
    const sanitized = filename
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff.-]/g, '_')
        .replace(/_{2,}/g, '_')
        .substring(0, 255); // Limit length

    // Ensure extension is safe
    const ext = path.extname(sanitized).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return null; // Invalid extension
    }

    return sanitized;
}

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, MUSIC_DIR);
    },
    filename: (req, file, cb) => {
        const sanitized = sanitizeFilename(file.originalname);
        if (!sanitized) {
            return cb(new Error('Invalid file type'));
        }
        cb(null, sanitized);
    }
});

const fileFilter = (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only audio files are allowed.'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1
    }
});

// Security check: prevent directory traversal
function validatePath(filepath, allowedDir) {
    if (!filepath) return false;

    // Normalize paths
    const normalizedPath = path.normalize(filepath);
    const normalizedAllowedDir = path.normalize(allowedDir);

    // Check if normalized path starts with allowed directory
    if (!normalizedPath.startsWith(normalizedAllowedDir)) {
        return false;
    }

    // Check for dangerous path components
    if (filepath.includes('../') || filepath.includes('..\\')) {
        return false;
    }

    // Check for null bytes (potential attack vector)
    if (filepath.includes('\0')) {
        return false;
    }

    return true;
}

// Validate filename to prevent injection
function validateFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        return false;
    }

    // Check length
    if (filename.length > 255 || filename.length < 1) {
        return false;
    }

    // Check for dangerous characters/patterns
    const dangerousPatterns = [
        /\.\./,           // Directory traversal
        /\0/,             // Null bytes
        /[<>:"|?*]/,      // Windows reserved characters
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, // Windows reserved names
        /^\./,            // Hidden files (Unix)
        /[\/\\]/,         // Path separators
    ];

    return !dangerousPatterns.some(pattern => pattern.test(filename));
}

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
app.post('/api/verify', authLimiter, checkAuth, (req, res) => {
    res.json({ success: true });
});

// --- API Routes ---

// 1. Get Playlist (Public)
app.get('/api/playlist', (req, res) => {
    fs.readdir(MUSIC_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to scan directory' });
        }

        // Get hidden files from settings
        const settings = getSettings();
        const hiddenFiles = settings.hiddenFiles || [];

        const musicFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext) && !hiddenFiles.includes(file);
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

// Multer error handler
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large. Maximum size is 50MB' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files' });
        }
        return res.status(400).json({ error: 'File upload error' });
    }

    if (err.message === 'Invalid file type. Only audio files are allowed.') {
        return res.status(400).json({ error: err.message });
    }

    if (err.message === 'Invalid file type') {
        return res.status(400).json({ error: 'Invalid file type' });
    }

    // Generic error for other cases
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
});

// 3. Delete File (Protected)
app.delete('/api/music/:filename', checkAuth, (req, res) => {
    const filename = req.params.filename;

    // Validate filename
    if (!validateFilename(filename)) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(MUSIC_DIR, filename);

    // Security check: prevent directory traversal
    if (!validatePath(filepath, MUSIC_DIR)) {
        return res.status(403).json({ error: 'Invalid file path' });
    }

    if (fs.existsSync(filepath)) {
        fs.unlink(filepath, (err) => {
            if (err) {
                console.error('Delete error:', err);
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

    // Validate both old and new filenames
    if (!validateFilename(oldName) || !validateFilename(newName)) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    // Sanitize new name
    const safeNewName = sanitizeFilename(newName);
    if (!safeNewName) {
        return res.status(400).json({ error: 'Invalid file type for new name' });
    }

    const oldPath = path.join(MUSIC_DIR, oldName);
    const newPath = path.join(MUSIC_DIR, safeNewName);

    // Security check
    if (!validatePath(oldPath, MUSIC_DIR) || !validatePath(newPath, MUSIC_DIR)) {
        return res.status(403).json({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'File not found' });
    if (fs.existsSync(newPath)) return res.status(400).json({ error: 'File already exists' });

    fs.rename(oldPath, newPath, (err) => {
        if (err) {
            console.error('Rename error:', err);
            return res.status(500).json({ error: 'Rename failed' });
        }
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

// 7. Get Admin Playlist (Protected) - Shows all files including hidden ones
app.get('/api/admin/playlist', checkAuth, (req, res) => {
    fs.readdir(MUSIC_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to scan directory' });
        }

        // Get hidden files from settings
        const settings = getSettings();
        const hiddenFiles = settings.hiddenFiles || [];

        const musicFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext);
        }).map(file => ({
            name: file,
            url: `/music/${encodeURIComponent(file)}`,
            hidden: hiddenFiles.includes(file)
        }));

        res.json(musicFiles);
    });
});

// 8. Toggle File Visibility (Protected)
app.put('/api/music/:filename/visibility', checkAuth, (req, res) => {
    const filename = req.params.filename;
    const { hidden } = req.body;

    // Validate filename
    if (!validateFilename(filename)) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(MUSIC_DIR, filename);

    // Security check: prevent directory traversal
    if (!validatePath(filepath, MUSIC_DIR)) {
        return res.status(403).json({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    // Get current settings
    const settings = getSettings();
    if (!settings.hiddenFiles) {
        settings.hiddenFiles = [];
    }

    const index = settings.hiddenFiles.indexOf(filename);
    if (hidden && index === -1) {
        settings.hiddenFiles.push(filename);
    } else if (!hidden && index > -1) {
        settings.hiddenFiles.splice(index, 1);
    }

    saveSettings(settings);
    res.json({ message: 'File visibility updated', hidden });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Music directory: ${MUSIC_DIR}`);
});
