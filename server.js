const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Rate limiting
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

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

// Media file rate limiting (stricter)
const mediaLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20, // limit each IP to 20 media requests per minute
    message: { error: 'Too many media requests' }
});

// Store temporary signed URLs
const signedUrls = new Map();
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Clean up expired signed URLs
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of signedUrls.entries()) {
        if (data.expiry < now) {
            signedUrls.delete(key);
        }
    }
}, CLEANUP_INTERVAL);

// Generate obfuscated signed URL for media access
function generateSignedUrl(filename, req = null, duration = 300000) { // 5 minutes for better compatibility
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString('hex');
    const expiry = timestamp + duration;

    // Create a more complex signature with multiple factors
    const data = `${filename}:${timestamp}:${random}:${expiry}`;
    const signature = crypto.createHmac('sha256', ADMIN_PASSWORD)
        .update(data)
        .digest('hex');

    // Store the minimal required data
    signedUrls.set(random, { filename, expiry, timestamp });

    // Create an obfuscated URL that doesn't reveal the structure
    const params = Buffer.from(`${random}:${signature}:${expiry}`).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const relativePath = `/api/stream/${params}`;

    // If request object is provided, generate absolute URL for mobile compatibility
    if (req) {
        const protocol = req.protocol;
        const host = req.get('host');
        return `${protocol}://${host}${relativePath}`;
    }

    return relativePath;
}

// Verify obfuscated signed URL
function verifyObfuscatedUrl(params) {
    try {
        // Decode the obfuscated parameters
        const decoded = Buffer.from(params.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
        const [random, signature, expiryStr] = decoded.split(':');

        if (!random || !signature || !expiryStr) {
            return false;
        }

        const expiry = parseInt(expiryStr);
        if (isNaN(expiry) || Date.now() > expiry) {
            return false;
        }

        const data = signedUrls.get(random);
        if (!data || data.expiry !== expiry) {
            return false;
        }

        // Verify the signature
        const expectedSignature = crypto.createHmac('sha256', ADMIN_PASSWORD)
            .update(`${data.filename}:${data.timestamp}:${random}:${expiry}`)
            .digest('hex');

        if (signature !== expectedSignature) {
            signedUrls.delete(random);
            return false;
        }

        // Return the filename and clean up
        const filename = data.filename;
        signedUrls.delete(random);
        return filename;

    } catch (error) {
        console.error('URL verification error:', error);
        return false;
    }
}

const app = express();
const PORT = process.env.PORT || 3000;
const MUSIC_DIR = path.join(__dirname, 'music');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'; // Default fallback

// Ensure music directory exists
if (!fs.existsSync(MUSIC_DIR)) {
    fs.mkdirSync(MUSIC_DIR);
}

// Enhanced anti-hotlinking middleware
function antiHotlinking(req, res, next) {
    const referer = req.headers.referer || req.headers.referrer;
    const userAgent = req.headers['user-agent'] || '';
    const origin = req.headers.origin;
    const host = req.headers.host;
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;

    // Check if it's an internal/private IP address
    function isInternalIP(ip) {
        // Private IP ranges
        const privateRanges = [
            /^10\./,           // 10.0.0.0/8
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
            /^192\.168\./,    // 192.168.0.0/16
            /^127\./,         // 127.0.0.0/8 (localhost)
            /^169\.254\./,    // 169.254.0.0/16 (link-local)
            /^::1$/,          // IPv6 localhost
            /^fc00:/,         // IPv6 private
        ];
        return privateRanges.some(range => range.test(ip));
    }

    // Allow internal IPs automatically
    if (isInternalIP(clientIP) || isInternalIP(host.split(':')[0])) {
        console.log(`Allowing internal IP access: ${clientIP}`);
        return next();
    }

    // Special handling for mobile browsers accessing signed media
    const isMobileUA = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);
    const isSignedMediaRequest = req.path.startsWith('/api/stream/') || req.path.startsWith('/stream/') || req.path.startsWith('/api/media/');

    // Allow mobile browsers to access signed media more easily
    if (isSignedMediaRequest && isMobileUA) {
        console.log(`Allowing mobile signed media request from ${clientIP}`);
        return next();
    }

    // Get allowed origins from settings
    const allowedOrigins = getAllowedOrigins();

    // Check if request is from allowed origin
    let isValidOrigin = false;
    if (referer) {
        try {
            const refererUrl = new URL(referer);
            isValidOrigin = refererUrl.host === host || allowedOrigins.includes(refererUrl.host);
        } catch (e) {
            // Invalid referer URL
        }
    } else if (origin) {
        try {
            const originUrl = new URL(origin);
            isValidOrigin = originUrl.host === host || allowedOrigins.includes(originUrl.host);
        } catch (e) {
            // Invalid origin URL
        }
    }

    // Allow same origin and configured origins
    if (isValidOrigin) {
        return next();
    }

    if (isSignedMediaRequest) {
        // For signed requests, allow all but obvious bots
        const blockedPatterns = [
            /bot/i, /crawler/i, /spider/i, /scraper/i
        ];

        const isBlockedUA = blockedPatterns.some(pattern => pattern.test(userAgent));
        if (isBlockedUA) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Allow signed requests to pass through for verification
        // Mobile browsers often don't send referer/origin headers, but signed URL is sufficient
        console.log(`Allowing signed media request from ${clientIP} UA: ${userAgent.substring(0, 50)}`);
        return next();
    }

    // Block suspicious patterns for non-signed requests
    const blockedPatterns = [
        /bot/i, /crawler/i, /spider/i, /scraper/i, /curl/i, /wget/i,
        /python/i, /java/i, /php/i, /node/i, /ruby/i, /go-http/i
    ];

    const isBlockedUA = blockedPatterns.some(pattern => pattern.test(userAgent));
    if (isBlockedUA) {
        return res.status(403).json({ error: 'Access denied' });
    }

    // Block requests with no proper identification
    if (!userAgent) {
        return res.status(403).json({ error: 'Access denied' });
    }

    // For all other cases, require signed URL
    return res.status(403).json({ error: 'Access denied' });
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

// Middleware with dynamic CORS
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, etc.)
        if (!origin) return callback(null, true);

        // Check if it's an internal IP
        function isInternalOrigin(originUrl) {
            try {
                const url = new URL(originUrl);
                const hostname = url.hostname;

                // Private IP ranges
                const privateRanges = [
                    /^10\./,           // 10.0.0.0/8
                    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
                    /^192\.168\./,    // 192.168.0.0/16
                    /^127\./,         // 127.0.0.0/8 (localhost)
                    /^localhost$/,    // localhost
                    /^169\.254\./,    // 169.254.0.0/16 (link-local)
                ];
                return privateRanges.some(range => range.test(hostname));
            } catch (e) {
                return false;
            }
        }

        // Auto-allow internal origins
        if (isInternalOrigin(origin)) {
            return callback(null, true);
        }

        const allowedOrigins = getAllowedOrigins();
        if (allowedOrigins.length === 0) {
            // If no origins specified, allow all
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        } else {
            return callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(generalLimiter); // Apply general rate limiting
app.use(express.static('public')); // Serve public player
app.use('/admin', express.static('admin')); // Serve admin panel

// Protected music file serving with anti-hotlinking
app.use('/music', mediaLimiter, antiHotlinking, express.static(MUSIC_DIR, {
    setHeaders: (res, filePath) => {
        // Prevent caching and add security headers
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        // Set content type based on file extension
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.m4a': 'audio/mp4'
        };

        if (mimeTypes[ext]) {
            res.setHeader('Content-Type', mimeTypes[ext]);
        }
    }
}));

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
            url: generateSignedUrl(file, req) // Pass req for absolute URL
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
        return { siteTitle: 'Scan to Listen', allowedOrigins: [] };
    }
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE));
    } catch (e) {
        return { siteTitle: 'Scan to Listen', allowedOrigins: [] };
    }
}

function getAllowedOrigins() {
    const settings = getSettings();
    const envOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
    const settingsOrigins = settings.allowedOrigins || [];
    return [...new Set([...envOrigins, ...settingsOrigins])];
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
            url: generateSignedUrl(file, req), // Use signed URL for admin too
            hidden: hiddenFiles.includes(file)
        }));

        res.json(musicFiles);
    });
});

// 8. Get Media File via Obfuscated URL
app.get('/api/stream/:params', mediaLimiter, (req, res) => {
    const { params } = req.params;
    console.log(`Media request for params: ${params.substring(0, 20)}... from ${req.ip} UA: ${req.get('User-Agent')?.substring(0, 50)}`);

    // Verify the obfuscated URL and get filename
    const filename = verifyObfuscatedUrl(params);
    if (!filename) {
        console.log(`Invalid/expired URL verification failed for params: ${params.substring(0, 20)}...`);
        return res.status(403).json({ error: 'Invalid or expired media URL' });
    }

    console.log(`Successfully verified URL for file: ${filename}`);

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

    // Set mobile-friendly CORS headers
    const userAgent = req.headers['user-agent'] || '';
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // More permissive CORS for mobile devices
    if (isMobile) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        console.log(`Mobile CORS headers set for: ${userAgent.substring(0, 50)}`);
    }

    // Set content type
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4'
    };

    if (mimeTypes[ext]) {
        res.setHeader('Content-Type', mimeTypes[ext]);
    }

    // Stream the file with error handling
    console.log(`Successfully serving file: ${filename} to ${req.ip}`);
    const fileStream = fs.createReadStream(filepath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
        console.error('File stream error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to stream file' });
        }
    });

    fileStream.on('end', () => {
        console.log(`File streaming completed: ${filename}`);
    });
});

// Legacy support for old URL format (will be removed in future)
app.get('/api/media/:id/:signature/:filename', mediaLimiter, antiHotlinking, (req, res) => {
    return res.status(410).json({ error: 'Legacy URL format no longer supported' });
});

// 9. Toggle File Visibility (Protected)
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
