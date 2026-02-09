/**
 * ============================================================
 * UNIVIDOWN - Universal Media Downloader Server v1.0.0
 * ============================================================
 * Multi-platform downloader supporting various sites.
 * Powered by yt-dlp.
 * 
 * FEATURES:
 * - Multi-platform support (YouTube, TikTok, Vimeo, etc.)
 * - FIFO Queue with max 2 concurrent downloads
 * - Real-time SSE progress with hardening
 * - Cancel download with complete cleanup
 * - Auto cleanup progress map (10 min after completion)
 * - Auto cleanup downloaded files (>24 hours)
 * - Rate limiting for /api/download and /api/info
 * - 30 minute timeout with graceful handling
 * - Download duration logging
 * - Playlist merge limit (max 50 videos)
 * - Strict security validation
 * - Custom filename support
 * - Subtitle download support
 * - Duration warning for long videos
 * - Automatic platform detection
 * - High compatibility mode (H.264/AAC re-encoding)
 * - Graceful shutdown
 * - Electron desktop app support
 * ============================================================
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// ELECTRON DESKTOP APP SUPPORT
// ============================================================
// Detect if running in Electron packaged app
const isElectronPackaged = !!process.env.UNIVIDOWN_BIN_PATH;
const basePath = process.env.UNIVIDOWN_BASE_PATH || __dirname;
const binPath = process.env.UNIVIDOWN_BIN_PATH || path.join(__dirname, 'bin');

// Binary executables - use local bin if available, otherwise system PATH
const YTDLP_PATH = (() => {
    const localPath = path.join(binPath, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    if (fs.existsSync(localPath)) {
        return localPath;
    }
    return 'yt-dlp'; // fallback to system PATH
})();

const FFMPEG_PATH = (() => {
    const localPath = path.join(binPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(localPath)) {
        return localPath;
    }
    return 'ffmpeg'; // fallback to system PATH
})();

// ============================================================
// KONFIGURASI
// ============================================================
const CONFIG = {
    // Queue & Concurrency
    MAX_CONCURRENT_DOWNLOADS: 2,
    
    // Timeouts
    DOWNLOAD_TIMEOUT_MS: 30 * 60 * 1000,        // 30 menit
    INFO_TIMEOUT_MS: 30 * 1000,                  // 30 detik
    
    // Limits
    MAX_URL_LENGTH: 500,
    MAX_PLAYLIST_MERGE: 50,
    LONG_DURATION_WARNING_SEC: 3600,             // 1 jam
    MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024 * 1024, // 5GB
    MAX_FILENAME_LENGTH: 150,                    // Max karakter nama file
    
    // Cleanup
    FILE_MAX_AGE_MS: 24 * 60 * 60 * 1000,        // 24 jam
    PROGRESS_CLEANUP_MS: 10 * 60 * 1000,         // 10 menit
    CLEANUP_INTERVAL_MS: 60 * 60 * 1000,         // 1 jam
    
    // SSE
    HEARTBEAT_INTERVAL_MS: 15000,
    
    // Rate Limiting
    DOWNLOAD_RATE_WINDOW_MS: 5000,
    DOWNLOAD_RATE_MAX: 1,
    INFO_RATE_WINDOW_MS: 3000,
    INFO_RATE_MAX: 3
};

// ============================================================
// DIREKTORI
// ============================================================
const downloadsDir = path.join(basePath, 'downloads');
const tempDir = path.join(basePath, 'temp');
const subtitlesDir = path.join(basePath, 'downloads', 'subtitles');

[downloadsDir, tempDir, subtitlesDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Log binary paths on startup
console.log(`[UniviDown] Base path: ${basePath}`);
console.log(`[UniviDown] Bin path: ${binPath}`);
console.log(`[UniviDown] yt-dlp: ${YTDLP_PATH}`);
console.log(`[UniviDown] ffmpeg: ${FFMPEG_PATH}`);

// ============================================================
// STATE MANAGEMENT
// ============================================================
let activeDownloads = 0;
const downloadQueue = [];               // FIFO queue
const downloadProgress = new Map();     // Progress data
const sseClients = new Map();           // SSE connections
const activeProcesses = new Map();      // Active yt-dlp/ffmpeg processes
const downloadTimeouts = new Map();     // Timeout timers
const progressCleanupTimers = new Map(); // Cleanup timers untuk progress map

// ============================================================
// LOGGING UTILITY
// ============================================================
const log = {
    info: (msg) => console.log(`[${new Date().toISOString()}] ℹ️  ${msg}`),
    success: (msg) => console.log(`[${new Date().toISOString()}] ✅ ${msg}`),
    warn: (msg) => console.log(`[${new Date().toISOString()}] ⚠️  ${msg}`),
    error: (msg) => console.error(`[${new Date().toISOString()}] ❌ ${msg}`),
    duration: (id, seconds) => console.log(`[${new Date().toISOString()}] ⏱️  Download ${id.slice(0, 8)} selesai dalam ${seconds.toFixed(1)} detik`)
};

// ============================================================
// QUEUE MANAGEMENT (FIFO)
// ============================================================

/**
 * Menambahkan download ke antrian FIFO
 */
function enqueueDownload(downloadId, task) {
    downloadQueue.push({ downloadId, task, addedAt: Date.now() });
    
    const queuePosition = downloadQueue.length;
    updateProgress(downloadId, {
        status: 'queued',
        progress: 0,
        message: `Menunggu antrian... (Posisi: ${queuePosition})`,
        queuePosition,
        canCancel: true
    });
    
    log.info(`Download ${downloadId.slice(0, 8)} masuk antrian (posisi ${queuePosition})`);
    processQueue();
}

/**
 * Memproses antrian FIFO
 */
function processQueue() {
    while (activeDownloads < CONFIG.MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
        // FIFO: ambil dari depan antrian
        const { downloadId, task } = downloadQueue.shift();
        activeDownloads++;
        
        // Update posisi antrian untuk semua yang tersisa
        broadcastQueuePositions();
        
        log.info(`Memproses download ${downloadId.slice(0, 8)} (aktif: ${activeDownloads}/${CONFIG.MAX_CONCURRENT_DOWNLOADS})`);
        
        task()
            .catch(err => log.error(`Download ${downloadId.slice(0, 8)} error: ${err.message}`))
            .finally(() => {
                activeDownloads--;
                activeProcesses.delete(downloadId);
                clearTimeout(downloadTimeouts.get(downloadId));
                downloadTimeouts.delete(downloadId);
                processQueue();
            });
    }
}

/**
 * Broadcast update posisi antrian ke semua client yang menunggu
 */
function broadcastQueuePositions() {
    downloadQueue.forEach((item, index) => {
        updateProgress(item.downloadId, {
            status: 'queued',
            progress: 0,
            message: `Menunggu antrian... (Posisi: ${index + 1})`,
            queuePosition: index + 1
        });
    });
}

/**
 * Menghapus download dari antrian
 */
function removeFromQueue(downloadId) {
    const index = downloadQueue.findIndex(item => item.downloadId === downloadId);
    if (index !== -1) {
        downloadQueue.splice(index, 1);
        // Update posisi untuk yang tersisa via SSE
        broadcastQueuePositions();
        return true;
    }
    return false;
}

// ============================================================
// PROGRESS MAP CLEANUP
// ============================================================

/**
 * Menjadwalkan cleanup progress map 10 menit setelah selesai
 */
function scheduleProgressCleanup(downloadId) {
    // Clear timer lama jika ada
    if (progressCleanupTimers.has(downloadId)) {
        clearTimeout(progressCleanupTimers.get(downloadId));
    }
    
    const timer = setTimeout(() => {
        downloadProgress.delete(downloadId);
        sseClients.delete(downloadId);
        progressCleanupTimers.delete(downloadId);
        log.info(`Progress ${downloadId.slice(0, 8)} dibersihkan dari memory`);
    }, CONFIG.PROGRESS_CLEANUP_MS);
    
    progressCleanupTimers.set(downloadId, timer);
}

// ============================================================
// AUTO CLEANUP FILES
// ============================================================

function cleanupTempFiles() {
    try {
        if (fs.existsSync(tempDir)) {
            const items = fs.readdirSync(tempDir);
            let count = 0;
            items.forEach(item => {
                const itemPath = path.join(tempDir, item);
                try {
                    if (isPathSafe(itemPath, tempDir)) {
                        const stats = fs.statSync(itemPath);
                        if (stats.isDirectory()) {
                            fs.rmSync(itemPath, { recursive: true, force: true });
                        } else {
                            fs.unlinkSync(itemPath);
                        }
                        count++;
                    }
                } catch (err) {
                    log.warn(`Gagal hapus temp ${item}: ${err.message}`);
                }
            });
            if (count > 0) {
                log.success(`Folder temp dibersihkan (${count} item)`);
            }
        }
    } catch (err) {
        log.error(`Cleanup temp error: ${err.message}`);
    }
}

function cleanupOldDownloads() {
    try {
        const now = Date.now();
        const files = fs.readdirSync(downloadsDir);
        let deletedCount = 0;
        
        files.forEach(file => {
            const filePath = path.join(downloadsDir, file);
            try {
                const stats = fs.statSync(filePath);
                if (stats.isFile() && now - stats.mtimeMs > CONFIG.FILE_MAX_AGE_MS) {
                    if (isPathSafe(filePath, downloadsDir)) {
                        fs.unlinkSync(filePath);
                        deletedCount++;
                    }
                }
            } catch (err) {
                log.warn(`Gagal hapus ${file}: ${err.message}`);
            }
        });
        
        if (deletedCount > 0) {
            log.success(`${deletedCount} file lama (>24 jam) dihapus`);
        }
    } catch (err) {
        log.error(`Cleanup downloads error: ${err.message}`);
    }
}

function cleanupDir(dir) {
    try {
        if (dir && fs.existsSync(dir) && isPathSafe(dir, tempDir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    } catch (err) {
        log.warn(`Cleanup dir error: ${err.message}`);
    }
}

// Jalankan cleanup saat server start
cleanupTempFiles();
cleanupOldDownloads();

// Periodic cleanup setiap 1 jam
setInterval(() => {
    cleanupOldDownloads();
    cleanupTempFiles();
}, CONFIG.CLEANUP_INTERVAL_MS);

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(downloadsDir));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Rate limiter untuk /api/download
const downloadLimiter = rateLimit({
    windowMs: CONFIG.DOWNLOAD_RATE_WINDOW_MS,
    max: CONFIG.DOWNLOAD_RATE_MAX,
    message: { 
        error: 'Terlalu banyak request download. Tunggu 5 detik.',
        retryAfter: 5
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || req.connection.remoteAddress
});

// Rate limiter untuk /api/info (lebih longgar)
const infoLimiter = rateLimit({
    windowMs: CONFIG.INFO_RATE_WINDOW_MS,
    max: CONFIG.INFO_RATE_MAX,
    message: { 
        error: 'Terlalu banyak request info. Tunggu sebentar.',
        retryAfter: 3
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || req.connection.remoteAddress
});

// Global error handler
app.use((err, req, res, next) => {
    log.error(`Express error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// VALIDASI & KEAMANAN
// ============================================================

/**
 * Validasi URL - menerima semua URL http/https yang valid
 * yt-dlp akan menangani deteksi platform secara otomatis
 */
function isValidUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.length > CONFIG.MAX_URL_LENGTH) return false;
    
    const cleanUrl = url.trim();
    
    // Terima semua URL http/https yang valid
    try {
        const urlObj = new URL(cleanUrl);
        return ['http:', 'https:'].includes(urlObj.protocol);
    } catch {
        // Coba dengan https:// prefix
        try {
            const urlObj = new URL('https://' + cleanUrl);
            return ['http:', 'https:'].includes(urlObj.protocol);
        } catch {
            return false;
        }
    }
}

function sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') return 'download';
    
    return filename
        // Hapus karakter berbahaya
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        // Hapus newlines dan karakter control
        .replace(/[\r\n\t]/g, ' ')
        // Hapus multiple dots
        .replace(/\.{2,}/g, '.')
        // Hapus dots di awal/akhir
        .replace(/^\.+|\.+$/g, '')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim()
        // Batasi panjang (150 karakter)
        .substring(0, CONFIG.MAX_FILENAME_LENGTH);
}

/**
 * Sanitasi path untuk concat file FFmpeg
 */
function sanitizeConcatPath(filePath) {
    return filePath
        .replace(/\\/g, '/')           // Windows path separator
        .replace(/'/g, "'\\''")        // Escape single quotes
        .replace(/[\r\n]/g, '')        // Hapus newlines
        .replace(/[\x00-\x1f]/g, '');  // Hapus control characters
}

function isPathSafe(testPath, baseDir) {
    try {
        const resolvedPath = path.resolve(testPath);
        const resolvedBase = path.resolve(baseDir);
        return resolvedPath.startsWith(resolvedBase + path.sep) || resolvedPath === resolvedBase;
    } catch {
        return false;
    }
}

// ============================================================
// SSE PROGRESS (HARDENED)
// ============================================================

function updateProgress(downloadId, data) {
    const currentProgress = downloadProgress.get(downloadId) || {};
    const newProgress = {
        ...currentProgress,
        ...data,
        downloadId,
        timestamp: Date.now()
    };
    downloadProgress.set(downloadId, newProgress);
    
    // Broadcast ke SSE clients dengan error handling
    const clients = sseClients.get(downloadId);
    if (clients && clients.size > 0) {
        const message = `data: ${JSON.stringify(newProgress)}\n\n`;
        const deadClients = [];
        
        clients.forEach(client => {
            try {
                const written = client.write(message);
                if (!written) {
                    deadClients.push(client);
                }
            } catch (err) {
                // Client disconnected - mark for removal
                deadClients.push(client);
            }
        });
        
        // Cleanup dead clients
        deadClients.forEach(client => {
            clients.delete(client);
            try { client.end(); } catch {}
        });
        
        if (clients.size === 0) {
            sseClients.delete(downloadId);
        }
    }
    
    // Schedule cleanup jika status final
    if (['finished', 'error', 'cancelled'].includes(data.status)) {
        scheduleProgressCleanup(downloadId);
    }
}

function cleanupSSEClient(downloadId, res) {
    const clients = sseClients.get(downloadId);
    if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
            sseClients.delete(downloadId);
        }
    }
}

// ============================================================
// ENDPOINT: GET VIDEO INFO
// ============================================================

app.post('/api/info', infoLimiter, async (req, res) => {
    const { url } = req.body;

    if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'URL tidak valid. Masukkan URL http/https yang benar.' });
    }

    let cleanUrl = url.trim();
    // Add https:// if missing
    if (!cleanUrl.match(/^https?:\/\//i)) {
        cleanUrl = 'https://' + cleanUrl;
    }
    const isPlaylist = cleanUrl.includes('playlist?list=') || cleanUrl.includes('/playlist/');

    const args = [
        '--dump-json',
        '--no-warnings',
        '--socket-timeout', '30',
        '--no-check-certificates'
    ];

    if (isPlaylist) {
        args.push('--flat-playlist');
    } else {
        args.push('--no-playlist');
    }

    args.push(cleanUrl);

    let output = '';
    let errorOutput = '';
    let responded = false;

    const ytdlp = spawn(YTDLP_PATH, args);

    const timeout = setTimeout(() => {
        if (!responded) {
            responded = true;
            ytdlp.kill('SIGTERM');
            res.status(504).json({ error: 'Timeout mengambil info video' });
        }
    }, CONFIG.INFO_TIMEOUT_MS);

    ytdlp.stdout.on('data', (data) => {
        output += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
        errorOutput += data.toString();
    });

    ytdlp.on('close', (code) => {
        clearTimeout(timeout);
        if (responded) return;
        responded = true;
        
        if (code !== 0) {
            log.warn(`yt-dlp info error: ${errorOutput.substring(0, 200)}`);
            return res.status(500).json({ 
                error: 'Gagal mengambil info video',
                details: errorOutput.includes('Video unavailable') ? 'Video tidak tersedia' :
                         errorOutput.includes('Private video') ? 'Video privat' :
                         errorOutput.includes('Sign in') ? 'Video memerlukan login' : undefined
            });
        }

        try {
            if (isPlaylist) {
                const lines = output.trim().split('\n').filter(Boolean);
                const videos = lines.map(line => {
                    try { return JSON.parse(line); } 
                    catch { return null; }
                }).filter(Boolean);

                if (videos.length === 0) {
                    return res.status(404).json({ error: 'Playlist kosong atau tidak ditemukan' });
                }

                const firstVideo = videos[0];
                const totalDuration = videos.reduce((sum, v) => sum + (v.duration || 0), 0);

                res.json({
                    isPlaylist: true,
                    videoCount: videos.length,
                    title: firstVideo.playlist_title || `Playlist (${videos.length} video)`,
                    thumbnail: firstVideo.thumbnail || firstVideo.thumbnails?.[0]?.url,
                    duration: formatDuration(totalDuration),
                    durationSeconds: totalDuration,
                    channel: firstVideo.uploader || firstVideo.channel || 'Unknown',
                    estimatedSize: null,
                    isLongDuration: totalDuration > CONFIG.LONG_DURATION_WARNING_SEC,
                    canMerge: videos.length <= CONFIG.MAX_PLAYLIST_MERGE,
                    platform: firstVideo.extractor || firstVideo.extractor_key || 'Unknown',
                    videos: videos.slice(0, 100).map(v => ({
                        id: v.id,
                        title: v.title,
                        duration: formatDuration(v.duration),
                        thumbnail: v.thumbnail
                    }))
                });
            } else {
                const info = JSON.parse(output);
                
                // Estimasi ukuran file
                let estimatedSize = info.filesize || info.filesize_approx;
                if (!estimatedSize && info.formats) {
                    const bestFormat = info.formats
                        .filter(f => f.filesize || f.filesize_approx)
                        .sort((a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0))[0];
                    estimatedSize = bestFormat?.filesize || bestFormat?.filesize_approx;
                }
                
                // Cek ketersediaan subtitle
                const hasSubtitles = !!(info.subtitles && Object.keys(info.subtitles).length > 0);
                const availableSubtitles = hasSubtitles ? Object.keys(info.subtitles) : [];

                // Extract available qualities
                const { resolutions, audioCodecs, hasVideoFormats } = extractAvailableQualities(info.formats);

                // Check file size limit
                const fileSizeExceeded = estimatedSize && estimatedSize > CONFIG.MAX_FILE_SIZE_BYTES;

                res.json({
                    isPlaylist: false,
                    videoCount: 1,
                    title: info.title || 'Unknown',
                    thumbnail: info.thumbnail,
                    duration: formatDuration(info.duration),
                    durationSeconds: info.duration,
                    channel: info.uploader || info.channel || 'Unknown',
                    estimatedSize,
                    fileSizeExceeded,
                    viewCount: info.view_count,
                    uploadDate: info.upload_date,
                    description: info.description?.substring(0, 200),
                    isLongDuration: (info.duration || 0) > CONFIG.LONG_DURATION_WARNING_SEC,
                    hasSubtitles,
                    availableSubtitles: availableSubtitles.slice(0, 20),
                    platform: info.extractor || info.extractor_key || 'Unknown',
                    availableResolutions: resolutions,
                    availableAudioCodecs: audioCodecs,
                    hasVideoFormats
                });
            }
        } catch (err) {
            log.error(`Parse info error: ${err.message}`);
            res.status(500).json({ error: 'Gagal memproses info video' });
        }
    });

    ytdlp.on('error', (err) => {
        clearTimeout(timeout);
        if (responded) return;
        responded = true;
        log.error(`yt-dlp spawn error: ${err.message}`);
        res.status(500).json({ error: 'yt-dlp tidak ditemukan. Pastikan sudah terinstall.' });
    });
});

// ============================================================
// QUALITY DETECTION HELPERS
// ============================================================

function extractAvailableQualities(formats) {
    if (!formats || !Array.isArray(formats)) {
        return { resolutions: [], audioCodecs: [], hasVideoFormats: false };
    }

    // Check if any video formats exist (even without height)
    const hasVideoFormats = formats.some(f => f.vcodec && f.vcodec !== 'none');

    // Extract unique video resolutions (height) where vcodec is not 'none'
    const resolutions = [...new Set(
        formats
            .filter(f => f.height && f.vcodec && f.vcodec !== 'none')
            .map(f => f.height)
    )].sort((a, b) => b - a); // Sort descending

    // Extract unique audio codecs where acodec is not 'none'
    const audioCodecs = [...new Set(
        formats
            .filter(f => f.acodec && f.acodec !== 'none')
            .map(f => f.acodec)
    )];

    return { resolutions, audioCodecs, hasVideoFormats };
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '--:--';
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ============================================================
// ENDPOINT: DOWNLOAD
// ============================================================

app.post('/api/download', downloadLimiter, async (req, res) => {
    const { 
        url, 
        type, 
        mode,
        format, 
        quality, 
        merge, 
        embedThumbnail, 
        normalizeAudio,
        customFilename,
        downloadSubtitles,
        subtitleLang,
        highCompatibility
    } = req.body;

    // Validasi URL
    if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'URL tidak valid' });
    }

    // Normalisasi type - handle jika frontend mengirim format sebagai type atau menggunakan mode
    const audioFormats = ['mp3', 'm4a', 'wav', 'flac', 'opus'];
    const videoFormats = ['mp4', 'webm'];
    
    let finalType = type || mode; // Support both 'type' and 'mode' field
    
    // Jika type adalah format audio, ubah ke 'audio'
    if (audioFormats.includes(finalType)) {
        finalType = 'audio';
    }
    // Jika type adalah format video, ubah ke 'video'
    else if (videoFormats.includes(finalType)) {
        finalType = 'video';
    }

    // Validasi type setelah normalisasi
    if (!['video', 'audio'].includes(finalType)) {
        return res.status(400).json({ error: 'Tipe download tidak valid' });
    }

    // Validasi format
    const validFormats = finalType === 'video' ? videoFormats : audioFormats;
    if (!validFormats.includes(format)) {
        return res.status(400).json({ error: 'Format tidak valid' });
    }

    // Validasi quality untuk video
    if (finalType === 'video') {
        const validQualities = ['360', '480', '720', '1080', '1440', '2160', 'best'];
        if (!validQualities.includes(quality)) {
            return res.status(400).json({ error: 'Kualitas tidak valid' });
        }
    }

    // Cek playlist merge limit
    if (merge === true && url.includes('playlist?list=')) {
        // Akan dicek lagi saat proses download
    }

    const downloadId = uuidv4();
    const sanitizedCustomName = customFilename ? sanitizeFilename(customFilename) : null;
    
    log.info(`Request download: ${finalType}/${format} - ${url.substring(0, 50)}...`);

    // Inisialisasi progress
    updateProgress(downloadId, {
        status: 'queued',
        progress: 0,
        message: 'Menunggu antrian...',
        type: finalType,
        format,
        files: [],
        canCancel: true,
        startedAt: Date.now()
    });

    res.json({ downloadId, message: 'Download dimulai' });

    // Tambahkan ke queue FIFO
    enqueueDownload(downloadId, () => {
        return processDownload(downloadId, {
            url: url.trim(),
            type: finalType,
            format,
            quality: quality || 'best',
            merge: merge === true,
            embedThumbnail: embedThumbnail !== false,
            normalizeAudio: normalizeAudio === true,
            customFilename: sanitizedCustomName,
            downloadSubtitles: downloadSubtitles === true,
            subtitleLang: subtitleLang || 'en',
            highCompatibility: highCompatibility === true
        });
    });
});

// ============================================================
// ENDPOINT: CANCEL DOWNLOAD
// ============================================================

app.post('/api/cancel/:id', (req, res) => {
    const { id } = req.params;
    
    log.info(`Cancel request untuk ${id.slice(0, 8)}`);
    
    // Cek di queue
    if (removeFromQueue(id)) {
        updateProgress(id, {
            status: 'cancelled',
            progress: 0,
            message: 'Download dibatalkan dari antrian',
            canCancel: false
        });
        log.success(`Download ${id.slice(0, 8)} dibatalkan dari antrian`);
        return res.json({ success: true, message: 'Download dibatalkan dari antrian' });
    }
    
    // Cek di active processes
    const processInfo = activeProcesses.get(id);
    if (processInfo) {
        try {
            processInfo.cancelled = true;
            
            // Kill semua process (yt-dlp dan ffmpeg)
            if (processInfo.process && !processInfo.process.killed) {
                processInfo.process.kill('SIGTERM');
                // Force kill setelah 5 detik
                setTimeout(() => {
                    try {
                        if (processInfo.process && !processInfo.process.killed) {
                            processInfo.process.kill('SIGKILL');
                        }
                    } catch {}
                }, 5000);
            }
            
            if (processInfo.ffmpegProcess && !processInfo.ffmpegProcess.killed) {
                processInfo.ffmpegProcess.kill('SIGTERM');
            }
            
            // Cleanup temp folder
            if (processInfo.tempDir) {
                cleanupDir(processInfo.tempDir);
            }
            
            // Clear timeout
            clearTimeout(downloadTimeouts.get(id));
            downloadTimeouts.delete(id);
            
            updateProgress(id, {
                status: 'cancelled',
                progress: 0,
                message: 'Download dibatalkan',
                canCancel: false
            });
            
            log.success(`Download ${id.slice(0, 8)} dibatalkan`);
            return res.json({ success: true, message: 'Download dibatalkan' });
        } catch (err) {
            log.error(`Cancel error: ${err.message}`);
            return res.status(500).json({ error: 'Gagal membatalkan download' });
        }
    }
    
    res.status(404).json({ error: 'Download tidak ditemukan' });
});

// ============================================================
// ENDPOINT: SSE PROGRESS
// ============================================================

app.get('/api/progress/:id', (req, res) => {
    const { id } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Kirim progress awal
    const currentProgress = downloadProgress.get(id);
    if (currentProgress) {
        res.write(`data: ${JSON.stringify(currentProgress)}\n\n`);
    } else {
        res.write(`data: ${JSON.stringify({ status: 'unknown', message: 'Download tidak ditemukan' })}\n\n`);
    }

    // Register client
    if (!sseClients.has(id)) {
        sseClients.set(id, new Set());
    }
    sseClients.get(id).add(res);

    // Heartbeat untuk keep connection alive
    const heartbeat = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        } catch (err) {
            clearInterval(heartbeat);
            cleanupSSEClient(id, res);
        }
    }, CONFIG.HEARTBEAT_INTERVAL_MS);

    // Cleanup saat client disconnect
    req.on('close', () => {
        clearInterval(heartbeat);
        cleanupSSEClient(id, res);
    });

    req.on('error', () => {
        clearInterval(heartbeat);
        cleanupSSEClient(id, res);
    });
});

// ============================================================
// PROSES DOWNLOAD
// ============================================================

async function processDownload(downloadId, options) {
    const { url, type, format, quality, merge, embedThumbnail, normalizeAudio, customFilename, downloadSubtitles, subtitleLang, highCompatibility } = options;
    const startTime = Date.now();

    // Setup timeout 30 menit
    const timeoutId = setTimeout(() => {
        const processInfo = activeProcesses.get(downloadId);
        if (processInfo && !processInfo.cancelled) {
            log.warn(`Download ${downloadId.slice(0, 8)} timeout setelah 30 menit`);
            processInfo.cancelled = true;
            
            // Kill process
            if (processInfo.process && !processInfo.process.killed) {
                processInfo.process.kill('SIGTERM');
            }
            if (processInfo.ffmpegProcess && !processInfo.ffmpegProcess.killed) {
                processInfo.ffmpegProcess.kill('SIGTERM');
            }
            
            // Cleanup temp
            if (processInfo.tempDir) {
                cleanupDir(processInfo.tempDir);
            }
            
            updateProgress(downloadId, {
                status: 'error',
                progress: 0,
                message: 'Download timeout (melebihi 30 menit)',
                canCancel: false
            });
        }
    }, CONFIG.DOWNLOAD_TIMEOUT_MS);
    
    downloadTimeouts.set(downloadId, timeoutId);

    try {
        updateProgress(downloadId, {
            status: 'starting',
            progress: 0,
            message: 'Memulai download...',
            canCancel: true
        });

        if (type === 'video') {
            await downloadVideo(downloadId, url, quality, format, embedThumbnail, customFilename, downloadSubtitles, subtitleLang, highCompatibility);
        } else {
            await downloadAudio(downloadId, url, format, merge, embedThumbnail, normalizeAudio, customFilename);
        }
        
        // Log durasi download
        const duration = (Date.now() - startTime) / 1000;
        log.duration(downloadId, duration);
        
    } catch (err) {
        const processInfo = activeProcesses.get(downloadId);
        if (!processInfo?.cancelled) {
            log.error(`Download ${downloadId.slice(0, 8)} error: ${err.message}`);
            updateProgress(downloadId, {
                status: 'error',
                progress: 0,
                message: err.message || 'Download gagal',
                canCancel: false
            });
        }
    } finally {
        clearTimeout(timeoutId);
        downloadTimeouts.delete(downloadId);
    }
}

// ============================================================
// DOWNLOAD VIDEO
// ============================================================

function downloadVideo(downloadId, url, quality, format, embedThumbnail, customFilename, downloadSubtitles, subtitleLang, highCompatibility) {
    return new Promise((resolve, reject) => {
        updateProgress(downloadId, {
            status: 'downloading_video',
            progress: 0,
            message: highCompatibility ? 'Mengunduh video (High Compatibility)...' : 'Mengunduh video...'
        });

        let formatString;
        const numericQuality = parseInt(quality, 10);
        
        if (!isNaN(numericQuality) && numericQuality > 0) {
            // Dynamic resolution with comprehensive fallback chain
            formatString = `bestvideo[height<=${numericQuality}]+bestaudio/best[height<=${numericQuality}]/bestvideo+bestaudio/best`;
        } else {
            // 'best' or invalid quality - get best available
            formatString = 'bestvideo+bestaudio/best';
        }

        // Output template
        const outputName = customFilename 
            ? `${customFilename}_%(id)s.%(ext)s`
            : '%(title).100s_%(id)s.%(ext)s';
        const outputTemplate = path.join(downloadsDir, outputName);
        
        const args = [
            '-f', formatString,
            '--merge-output-format', format || 'mp4',
            '-o', outputTemplate,
            '--newline',
            '--no-warnings',
            '--no-playlist',
            '--add-metadata',
            '--socket-timeout', '30',
            '--retries', '5',
            '--fragment-retries', '5',
            '--no-check-certificates'
        ];

        if (embedThumbnail) {
            args.push('--embed-thumbnail');
        }
        
        // Subtitle download
        if (downloadSubtitles) {
            args.push('--write-subs');
            args.push('--sub-lang', subtitleLang || 'en');
            args.push('--convert-subs', 'srt');
        }

        // High Compatibility Mode - recode to H.264/AAC for universal playback
        if (highCompatibility) {
            args.push('--recode-video', 'mp4');
            args.push('--postprocessor-args', `${FFMPEG_PATH}:-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k`);
        }

        args.push(url);

        const ytdlp = spawn(YTDLP_PATH, args);
        
        activeProcesses.set(downloadId, { 
            process: ytdlp, 
            cancelled: false,
            tempDir: null,
            startedAt: Date.now()
        });

        let lastProgressUpdate = 0;

        ytdlp.stdout.on('data', (data) => {
            const output = data.toString();
            const processInfo = activeProcesses.get(downloadId);
            if (processInfo?.cancelled) return;
            
            // Parse progress dengan regex yang lebih akurat (throttled 500ms)
            const now = Date.now();
            if (now - lastProgressUpdate > 500) {
                const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
                if (progressMatch) {
                    const percent = parseFloat(progressMatch[1]);
                    updateProgress(downloadId, {
                        status: 'downloading_video',
                        progress: Math.min(percent * 0.85, 85),
                        message: `Mengunduh video: ${percent.toFixed(1)}%`
                    });
                    lastProgressUpdate = now;
                }
            }

            // Status updates
            if (output.includes('[Merger]') || output.includes('Merging formats')) {
                updateProgress(downloadId, {
                    status: 'postprocessing',
                    progress: 88,
                    message: 'Menggabungkan video dan audio...'
                });
            }

            if (output.includes('[EmbedThumbnail]')) {
                updateProgress(downloadId, {
                    status: 'embedding_metadata',
                    progress: 92,
                    message: 'Menyematkan thumbnail...'
                });
            }

            if (output.includes('[Metadata]') || output.includes('Adding metadata')) {
                updateProgress(downloadId, {
                    status: 'embedding_metadata',
                    progress: 95,
                    message: 'Menambahkan metadata...'
                });
            }
            
            if (output.includes('[SubtitlesConvertor]')) {
                updateProgress(downloadId, {
                    status: 'postprocessing',
                    progress: 93,
                    message: 'Mengkonversi subtitle...'
                });
            }
        });

        ytdlp.stderr.on('data', (data) => {
            const error = data.toString();
            if (!error.includes('WARNING')) {
                log.warn(`yt-dlp: ${error.trim().substring(0, 100)}`);
            }
        });

        ytdlp.on('close', (code) => {
            const processInfo = activeProcesses.get(downloadId);
            if (processInfo?.cancelled) {
                reject(new Error('Download dibatalkan'));
                return;
            }

            if (code === 0) {
                // Finalizing stage
                updateProgress(downloadId, {
                    status: 'finalizing',
                    progress: 98,
                    message: 'Memfinalisasi file...'
                });
                
                const files = getRecentFiles(downloadsDir, `.${format || 'mp4'}`, 5);
                
                updateProgress(downloadId, {
                    status: 'finished',
                    progress: 100,
                    message: 'Download selesai!',
                    files,
                    canCancel: false
                });
                resolve();
            } else {
                reject(new Error('Download video gagal'));
            }
        });

        ytdlp.on('error', (err) => {
            reject(new Error(`yt-dlp error: ${err.message}`));
        });
    });
}

// ============================================================
// DOWNLOAD AUDIO
// ============================================================

function downloadAudio(downloadId, url, format, merge, embedThumbnail, normalizeAudio, customFilename) {
    return new Promise(async (resolve, reject) => {
        const sessionId = uuidv4();
        const sessionTempDir = path.join(tempDir, sessionId);

        try {
            // Cek playlist merge limit
            if (merge && url.includes('playlist?list=')) {
                // Ambil info playlist dulu untuk cek jumlah video
                const countArgs = ['--flat-playlist', '--dump-json', '--no-warnings', url];
                const countProcess = spawn(YTDLP_PATH, countArgs);
                let countOutput = '';
                
                await new Promise((resolveCount, rejectCount) => {
                    countProcess.stdout.on('data', (data) => { countOutput += data.toString(); });
                    countProcess.on('close', (code) => {
                        if (code === 0) {
                            const lines = countOutput.trim().split('\n').filter(Boolean);
                            if (lines.length > CONFIG.MAX_PLAYLIST_MERGE) {
                                rejectCount(new Error(`Playlist terlalu besar untuk merge (${lines.length} video, max ${CONFIG.MAX_PLAYLIST_MERGE})`));
                            } else {
                                resolveCount();
                            }
                        } else {
                            resolveCount(); // Lanjut saja kalau gagal cek
                        }
                    });
                    countProcess.on('error', () => resolveCount());
                });
            }

            if (merge) {
                fs.mkdirSync(sessionTempDir, { recursive: true });
            }

            updateProgress(downloadId, {
                status: 'downloading_audio',
                progress: 0,
                message: 'Mengunduh audio...'
            });

            // Output template
            const outputName = customFilename 
                ? `${customFilename}_%(id)s.%(ext)s`
                : '%(title).100s_%(id)s.%(ext)s';
            
            const outputDir = merge ? sessionTempDir : downloadsDir;
            const outputTemplate = path.join(outputDir, outputName);

            const args = [
                '-x',
                '--audio-format', format,
                '-o', outputTemplate,
                '--newline',
                '--no-warnings',
                '--add-metadata',
                '--parse-metadata', 'uploader:%(artist)s',
                '--socket-timeout', '30',
                '--retries', '5',
                '--no-check-certificates'
            ];
            
            if (format === 'mp3') {
                args.push('--audio-quality', '0'); // Best quality (320kbps untuk MP3)
            }

            if (embedThumbnail && !['wav'].includes(format)) {
                args.push('--embed-thumbnail');
            }

            if (!merge) {
                args.push('--no-playlist');
            }

            args.push(url);

            const ytdlp = spawn(YTDLP_PATH, args);
            
            activeProcesses.set(downloadId, { 
                process: ytdlp, 
                cancelled: false,
                tempDir: merge ? sessionTempDir : null,
                startedAt: Date.now()
            });

            let totalVideos = 0;
            let currentVideo = 0;
            let lastProgressUpdate = 0;

            ytdlp.stdout.on('data', (data) => {
                const output = data.toString();
                const processInfo = activeProcesses.get(downloadId);
                if (processInfo?.cancelled) return;

                // Playlist progress
                const playlistMatch = output.match(/\[download\] Downloading item (\d+) of (\d+)/);
                if (playlistMatch) {
                    currentVideo = parseInt(playlistMatch[1]);
                    totalVideos = parseInt(playlistMatch[2]);
                }

                // Download progress dengan regex akurat (throttled)
                const now = Date.now();
                if (now - lastProgressUpdate > 500) {
                    const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
                    if (progressMatch) {
                        let percent = parseFloat(progressMatch[1]);
                        
                        if (totalVideos > 1) {
                            const baseProgress = ((currentVideo - 1) / totalVideos) * 100;
                            const videoProgress = (percent / 100) * (100 / totalVideos);
                            percent = baseProgress + videoProgress;
                        }
                        
                        percent = Math.min(percent * 0.80, 80);

                        updateProgress(downloadId, {
                            status: 'downloading_audio',
                            progress: percent,
                            message: totalVideos > 1 
                                ? `Mengunduh ${currentVideo}/${totalVideos}: ${parseFloat(progressMatch[1]).toFixed(1)}%`
                                : `Mengunduh audio: ${parseFloat(progressMatch[1]).toFixed(1)}%`
                        });
                        lastProgressUpdate = now;
                    }
                }

                // Status updates
                if (output.includes('[ExtractAudio]')) {
                    updateProgress(downloadId, {
                        status: 'converting_audio',
                        progress: 85,
                        message: `Mengkonversi ke ${format.toUpperCase()}...`
                    });
                }

                if (output.includes('[EmbedThumbnail]')) {
                    updateProgress(downloadId, {
                        status: 'embedding_metadata',
                        progress: 90,
                        message: 'Menyematkan cover art...'
                    });
                }

                if (output.includes('[Metadata]')) {
                    updateProgress(downloadId, {
                        status: 'embedding_metadata',
                        progress: 93,
                        message: 'Menambahkan metadata...'
                    });
                }
            });

            ytdlp.stderr.on('data', (data) => {
                const error = data.toString();
                if (!error.includes('WARNING')) {
                    log.warn(`yt-dlp: ${error.trim().substring(0, 100)}`);
                }
            });

            ytdlp.on('close', async (code) => {
                const processInfo = activeProcesses.get(downloadId);
                if (processInfo?.cancelled) {
                    cleanupDir(sessionTempDir);
                    reject(new Error('Download dibatalkan'));
                    return;
                }

                if (code !== 0) {
                    cleanupDir(sessionTempDir);
                    reject(new Error('Download audio gagal'));
                    return;
                }

                try {
                    if (merge) {
                        updateProgress(downloadId, {
                            status: 'merging_playlist',
                            progress: 95,
                            message: 'Menggabungkan file audio playlist...'
                        });

                        const mergedFile = await mergeAudioFiles(downloadId, sessionTempDir, downloadsDir, format, normalizeAudio, customFilename);
                        cleanupDir(sessionTempDir);
                        
                        // Finalizing
                        updateProgress(downloadId, {
                            status: 'finalizing',
                            progress: 98,
                            message: 'Memfinalisasi file...'
                        });

                        const stats = fs.statSync(mergedFile);
                        updateProgress(downloadId, {
                            status: 'finished',
                            progress: 100,
                            message: 'Download dan merge selesai!',
                            files: [{
                                name: path.basename(mergedFile),
                                url: `/downloads/${encodeURIComponent(path.basename(mergedFile))}`,
                                size: stats.size
                            }],
                            canCancel: false
                        });
                    } else {
                        // Finalizing
                        updateProgress(downloadId, {
                            status: 'finalizing',
                            progress: 98,
                            message: 'Memfinalisasi file...'
                        });
                        
                        const files = getRecentFiles(downloadsDir, `.${format}`, 10);
                        
                        updateProgress(downloadId, {
                            status: 'finished',
                            progress: 100,
                            message: 'Download selesai!',
                            files,
                            canCancel: false
                        });
                    }
                    resolve();
                } catch (err) {
                    cleanupDir(sessionTempDir);
                    reject(err);
                }
            });

            ytdlp.on('error', (err) => {
                cleanupDir(sessionTempDir);
                reject(new Error(`yt-dlp error: ${err.message}`));
            });

        } catch (err) {
            cleanupDir(sessionTempDir);
            reject(err);
        }
    });
}

// ============================================================
// MERGE AUDIO FILES
// ============================================================

function mergeAudioFiles(downloadId, inputDir, outputDir, format, normalizeAudio, customFilename) {
    return new Promise((resolve, reject) => {
        const files = fs.readdirSync(inputDir)
            .filter(f => f.endsWith(`.${format}`))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map(f => path.join(inputDir, f));

        if (files.length === 0) {
            reject(new Error('Tidak ada file audio untuk digabungkan'));
            return;
        }

        if (files.length === 1) {
            const destFile = path.join(outputDir, path.basename(files[0]));
            fs.copyFileSync(files[0], destFile);
            resolve(destFile);
            return;
        }

        // Buat file concat list dengan sanitasi path
        const concatFile = path.join(inputDir, 'concat.txt');
        const concatContent = files.map(f => `file '${sanitizeConcatPath(f)}'`).join('\n');
        fs.writeFileSync(concatFile, concatContent);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const outputName = customFilename 
            ? `${customFilename}_merged.${format}`
            : `merged_playlist_${timestamp}.${format}`;
        const outputFile = path.join(outputDir, outputName);

        const args = [
            '-f', 'concat',
            '-safe', '0',
            '-i', concatFile
        ];

        // Codec berdasarkan format
        switch (format) {
            case 'mp3':
                args.push('-c:a', 'libmp3lame', '-b:a', '320k');
                break;
            case 'flac':
                args.push('-c:a', 'flac');
                break;
            case 'wav':
                args.push('-c:a', 'pcm_s16le');
                break;
            case 'opus':
                args.push('-c:a', 'libopus', '-b:a', '192k');
                break;
            default:
                args.push('-c:a', 'copy');
        }

        // Normalisasi audio (loudnorm)
        if (normalizeAudio && format !== 'flac') {
            args.push('-af', 'loudnorm=I=-16:LRA=11:TP=-1.5');
        }

        args.push('-y', outputFile);

        const ffmpeg = spawn(FFMPEG_PATH, args);
        
        // Store ffmpeg process untuk cancel
        const processInfo = activeProcesses.get(downloadId);
        if (processInfo) {
            processInfo.ffmpegProcess = ffmpeg;
        }

        ffmpeg.stderr.on('data', () => {});

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve(outputFile);
            } else {
                reject(new Error('Gagal menggabungkan file audio'));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(new Error(`FFmpeg error: ${err.message}`));
        });
    });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getRecentFiles(dir, extension, limit) {
    try {
        return fs.readdirSync(dir)
            .filter(f => f.toLowerCase().endsWith(extension.toLowerCase()))
            .map(f => {
                const filePath = path.join(dir, f);
                try {
                    const stats = fs.statSync(filePath);
                    return {
                        name: f,
                        url: `/downloads/${encodeURIComponent(f)}`,
                        size: stats.size,
                        mtime: stats.mtimeMs,
                        extension: path.extname(f).slice(1).toLowerCase()
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, limit);
    } catch (err) {
        return [];
    }
}

// ============================================================
// ENDPOINT: LIST FILES
// ============================================================

app.get('/api/files', (req, res) => {
    try {
        const files = fs.readdirSync(downloadsDir)
            .filter(f => !f.startsWith('.') && !fs.statSync(path.join(downloadsDir, f)).isDirectory())
            .map(f => {
                const filePath = path.join(downloadsDir, f);
                try {
                    const stats = fs.statSync(filePath);
                    return {
                        name: f,
                        url: `/downloads/${encodeURIComponent(f)}`,
                        size: stats.size,
                        date: stats.mtime,
                        extension: path.extname(f).slice(1).toLowerCase()
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        
        res.json({ files, count: files.length });
    } catch (err) {
        log.error(`List files error: ${err.message}`);
        res.status(500).json({ error: 'Gagal membaca daftar file' });
    }
});

// ============================================================
// ENDPOINT: DELETE FILE
// ============================================================

app.delete('/api/files/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = path.join(downloadsDir, filename);

        // Security check
        if (!isPathSafe(filePath, downloadsDir)) {
            return res.status(403).json({ error: 'Akses ditolak' });
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
            log.info(`File dihapus: ${filename}`);
            res.json({ success: true, message: 'File berhasil dihapus' });
        } else {
            res.status(404).json({ error: 'File tidak ditemukan' });
        }
    } catch (err) {
        log.error(`Delete file error: ${err.message}`);
        res.status(500).json({ error: 'Gagal menghapus file' });
    }
});

// ============================================================
// ENDPOINT: QUEUE STATUS
// ============================================================

app.get('/api/queue', (req, res) => {
    res.json({
        activeDownloads,
        maxConcurrent: CONFIG.MAX_CONCURRENT_DOWNLOADS,
        queueLength: downloadQueue.length,
        queuedIds: downloadQueue.map(item => item.downloadId)
    });
});

// ============================================================
// ENDPOINT: SERVER STATUS
// ============================================================

app.get('/api/status', (req, res) => {
    const downloadsCount = fs.readdirSync(downloadsDir)
        .filter(f => !f.startsWith('.') && fs.statSync(path.join(downloadsDir, f)).isFile()).length;
    
    res.json({
        version: '5.0.0-final',
        status: 'running',
        uptime: process.uptime(),
        activeDownloads,
        queueLength: downloadQueue.length,
        downloadsCount,
        progressMapSize: downloadProgress.size,
        sseClientsCount: Array.from(sseClients.values()).reduce((sum, set) => sum + set.size, 0),
        config: {
            maxConcurrent: CONFIG.MAX_CONCURRENT_DOWNLOADS,
            timeout: CONFIG.DOWNLOAD_TIMEOUT_MS / 60000 + ' menit',
            maxPlaylistMerge: CONFIG.MAX_PLAYLIST_MERGE
        }
    });
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

function gracefulShutdown(signal) {
    log.info(`${signal} received. Shutting down gracefully...`);
    
    // Kill all active processes
    activeProcesses.forEach((info, id) => {
        if (info.process && !info.process.killed) {
            info.process.kill('SIGTERM');
        }
        if (info.ffmpegProcess && !info.ffmpegProcess.killed) {
            info.ffmpegProcess.kill('SIGTERM');
        }
        if (info.tempDir) {
            cleanupDir(info.tempDir);
        }
    });
    
    // Clear all timeouts
    downloadTimeouts.forEach((timeout) => clearTimeout(timeout));
    progressCleanupTimers.forEach((timer) => clearTimeout(timer));
    
    // Close SSE connections
    sseClients.forEach((clients) => {
        clients.forEach((client) => {
            try { client.end(); } catch {}
        });
    });
    
    log.success('Graceful shutdown completed');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================
// START SERVER
// ============================================================

const server = app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║   � UNIVERSAL MEDIA DOWNLOADER v6.0                              ║
║   ══════════════════════════════════                              ║
║   Multi-Platform Support: YouTube, TikTok, Vimeo, Twitter, etc.   ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║   🌐 Server:      http://localhost:${PORT}                            ║
║   📁 Downloads:   ./downloads                                     ║
║   📋 Queue:       Max ${CONFIG.MAX_CONCURRENT_DOWNLOADS} concurrent (FIFO)                       ║
║   ⏱️  Timeout:     ${CONFIG.DOWNLOAD_TIMEOUT_MS / 60000} menit per download                          ║
║   🔄 Cleanup:     Files >24h, Progress >10min                     ║
║   📊 Playlist:    Max ${CONFIG.MAX_PLAYLIST_MERGE} videos for merge                          ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
    `);
    log.success('UniviDown server started successfully');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        log.error(`Port ${PORT} sudah digunakan. Coba port lain atau hentikan proses yang menggunakan port tersebut.`);
    } else {
        log.error(`Server error: ${err.message}`);
    }
    process.exit(1);
});
