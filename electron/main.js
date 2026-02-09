/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║   UNIVIDOWN v1.0.0 - ELECTRON MAIN PROCESS                        ║
 * ║   Desktop wrapper for UniviDown web application                   ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

// ============================================================
// DEBUG LOGGING TO FILE
// ============================================================
const LOG_FILE = path.join(os.homedir(), 'unividown-debug.log');

function debugLog(msg) {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${msg}\n`;
    try {
        fs.appendFileSync(LOG_FILE, logMsg);
    } catch (e) {
        // Ignore write errors
    }
    console.log(msg);
}

// Clear log file on startup
try {
    fs.writeFileSync(LOG_FILE, `=== UniviDown Debug Log ===\nStarted: ${new Date().toISOString()}\n\n`);
} catch (e) {}

// ============================================================
// GLOBAL ERROR HANDLERS
// ============================================================
process.on('uncaughtException', (err) => {
    debugLog(`❌ Uncaught Exception: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
    debugLog(`❌ Unhandled Rejection: ${reason}`);
});

// ============================================================
// REFERENCES
// ============================================================
let serverProcess = null;
let mainWindow = null;
let tray = null;
const serverPort = 3000;

// ============================================================
// PATH RESOLUTION
// ============================================================
const isPackaged = app.isPackaged;
debugLog(`📦 Is Packaged: ${isPackaged}`);
debugLog(`📁 __dirname: ${__dirname}`);
debugLog(`📁 process.resourcesPath: ${process.resourcesPath}`);
debugLog(`📁 app.getAppPath(): ${app.getAppPath()}`);
debugLog(`📁 process.execPath: ${process.execPath}`);

// Get paths based on packaged or dev mode
function getAppPath() {
    if (isPackaged) {
        // When packaged with asar:false, files are in resources/app
        return path.join(process.resourcesPath, 'app');
    }
    return path.join(__dirname, '..');
}

function getBinPath() {
    if (isPackaged) {
        // Binaries are in resources/app/public/bin
        return path.join(process.resourcesPath, 'app', 'public', 'bin');
    }
    return path.join(__dirname, '..', 'public', 'bin');
}

const appPath = getAppPath();
const binPath = getBinPath();
const serverPath = path.join(appPath, 'server.js');
const publicPath = path.join(appPath, 'public');
const iconPath = path.join(publicPath, 'assets', 'logouniversaldown.png');
const icoPath = path.join(publicPath, 'assets', 'logouniversaldown.ico');

debugLog(`📁 App Path: ${appPath}`);
debugLog(`📁 Bin Path: ${binPath}`);
debugLog(`📁 Server Path: ${serverPath}`);
debugLog(`📁 Server exists: ${fs.existsSync(serverPath)}`);

// Check bin files
const ytdlpExePath = path.join(binPath, 'yt-dlp.exe');
const ffmpegExePath = path.join(binPath, 'ffmpeg.exe');
debugLog(`📁 yt-dlp.exe exists: ${fs.existsSync(ytdlpExePath)}`);
debugLog(`📁 ffmpeg.exe exists: ${fs.existsSync(ffmpegExePath)}`);

// ============================================================
// SERVER MANAGEMENT
// ============================================================

/**
 * Wait for server to be ready by polling the port
 */
function waitForServer(port, maxAttempts = 30) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        
        const checkServer = () => {
            attempts++;
            debugLog(`🔄 Checking server (attempt ${attempts}/${maxAttempts})...`);
            
            const req = http.get(`http://localhost:${port}/`, (res) => {
                debugLog(`✅ Server is ready on port ${port}`);
                resolve(port);
            });
            
            req.on('error', (err) => {
                if (attempts >= maxAttempts) {
                    debugLog(`❌ Server not ready after ${maxAttempts} attempts`);
                    reject(new Error('Server failed to start'));
                } else {
                    setTimeout(checkServer, 500);
                }
            });
            
            req.setTimeout(1000, () => {
                req.destroy();
                if (attempts < maxAttempts) {
                    setTimeout(checkServer, 500);
                }
            });
        };
        
        // Start checking after a small delay
        setTimeout(checkServer, 1000);
    });
}

/**
 * Start the Express server using spawn with Node
 */
function startServer() {
    return new Promise((resolve, reject) => {
        debugLog('🚀 Starting UniviDown server...');
        
        // Check if server.js exists
        if (!fs.existsSync(serverPath)) {
            const errMsg = `Server file not found: ${serverPath}`;
            debugLog(`❌ ${errMsg}`);
            reject(new Error(errMsg));
            return;
        }

        // Set environment variables
        const env = {
            ...process.env,
            NODE_ENV: 'production',
            ELECTRON_RUN_AS_NODE: '1',
            UNIVIDOWN_BIN_PATH: binPath,
            UNIVIDOWN_BASE_PATH: appPath,
            PATH: `${binPath}${path.delimiter}${process.env.PATH || ''}`
        };

        debugLog(`🔧 Environment PATH includes: ${binPath}`);

        // Use Electron's bundled Node.js to run the server
        // ELECTRON_RUN_AS_NODE makes electron.exe act as node.exe
        serverProcess = spawn(process.execPath, [serverPath], {
            cwd: appPath,
            env: env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });

        debugLog(`📌 Server PID: ${serverProcess.pid}`);

        serverProcess.stdout.on('data', (data) => {
            const output = data.toString().trim();
            debugLog(`[Server OUT] ${output}`);
        });

        serverProcess.stderr.on('data', (data) => {
            const output = data.toString().trim();
            debugLog(`[Server ERR] ${output}`);
        });

        serverProcess.on('error', (err) => {
            debugLog(`❌ Server spawn error: ${err.message}`);
            reject(err);
        });

        serverProcess.on('exit', (code, signal) => {
            debugLog(`⚠️ Server exited with code ${code}, signal ${signal}`);
            serverProcess = null;
        });

        // Wait for server to be ready
        waitForServer(serverPort)
            .then(resolve)
            .catch(reject);
    });
}

/**
 * Stop the Express server
 */
function stopServer() {
    if (serverProcess) {
        debugLog('🛑 Stopping UniviDown server...');
        
        try {
            if (process.platform === 'win32') {
                // On Windows, use taskkill to ensure all child processes are killed
                spawn('taskkill', ['/pid', serverProcess.pid.toString(), '/f', '/t'], {
                    windowsHide: true
                });
            } else {
                serverProcess.kill('SIGTERM');
            }
        } catch (e) {
            debugLog(`⚠️ Error stopping server: ${e.message}`);
        }
        
        serverProcess = null;
    }
}

// ============================================================
// WINDOW MANAGEMENT
// ============================================================

/**
 * Create the main application window
 */
function createWindow() {
    debugLog('🪟 Creating main window...');
    
    // Get icon for window
    let windowIcon = null;
    try {
        if (fs.existsSync(icoPath)) {
            windowIcon = nativeImage.createFromPath(icoPath);
            debugLog(`✅ Loaded icon: ${icoPath}`);
        } else {
            debugLog(`⚠️ Icon not found: ${icoPath}`);
        }
    } catch (err) {
        debugLog(`⚠️ Could not load window icon: ${err.message}`);
    }

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        icon: windowIcon,
        title: 'UniviDown',
        backgroundColor: '#0a0a0f',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        },
        autoHideMenuBar: true,
        show: false
    });

    const serverUrl = `http://localhost:${serverPort}`;
    debugLog(`🌐 Loading URL: ${serverUrl}`);

    // Load the web app
    mainWindow.loadURL(serverUrl);

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        debugLog('✅ Window ready to show');
        mainWindow.show();
        mainWindow.focus();
    });

    // Handle window close
    mainWindow.on('closed', () => {
        debugLog('🪟 Window closed');
        mainWindow = null;
    });

    // Handle navigation errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        debugLog(`❌ Failed to load: ${errorCode} - ${errorDescription}`);
        // Retry after 2 seconds
        setTimeout(() => {
            if (mainWindow) {
                debugLog('🔄 Retrying to load...');
                mainWindow.loadURL(serverUrl);
            }
        }, 2000);
    });

    mainWindow.webContents.on('did-finish-load', () => {
        debugLog('✅ Page loaded successfully');
    });
}

/**
 * Create system tray
 */
function createTray() {
    debugLog('📌 Creating system tray...');
    
    try {
        let trayIcon = null;
        
        if (fs.existsSync(icoPath)) {
            trayIcon = nativeImage.createFromPath(icoPath);
            trayIcon = trayIcon.resize({ width: 16, height: 16 });
        } else if (fs.existsSync(iconPath)) {
            trayIcon = nativeImage.createFromPath(iconPath);
            trayIcon = trayIcon.resize({ width: 16, height: 16 });
        } else {
            debugLog('⚠️ No tray icon found, skipping tray');
            return;
        }
        
        tray = new Tray(trayIcon);
        
        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'Open UniviDown',
                click: () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    app.quit();
                }
            }
        ]);

        tray.setToolTip('UniviDown - Universal Media Downloader');
        tray.setContextMenu(contextMenu);

        tray.on('double-click', () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
        });
        
        debugLog('✅ Tray created');
    } catch (err) {
        debugLog(`⚠️ Could not create tray: ${err.message}`);
    }
}

// ============================================================
// APP LIFECYCLE
// ============================================================

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    debugLog('⚠️ Another instance is running, quitting...');
    app.quit();
} else {
    app.on('second-instance', () => {
        debugLog('📌 Second instance detected, focusing main window');
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    // App ready
    app.whenReady().then(async () => {
        debugLog('🎉 App ready, starting initialization...');
        
        try {
            // Start server first
            await startServer();
            debugLog('✅ Server started successfully');
            
            // Then create window
            createWindow();
            createTray();
            
            debugLog('✅ Initialization complete');
        } catch (err) {
            debugLog(`❌ Failed to initialize: ${err.message}`);
            
            // Show error dialog
            dialog.showErrorBox('UniviDown Error', 
                `Failed to start the application.\n\nError: ${err.message}\n\nCheck the log file at:\n${LOG_FILE}`
            );
            
            app.quit();
        }

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    // Quit when all windows are closed
    app.on('window-all-closed', () => {
        debugLog('🪟 All windows closed');
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    // Clean up on quit
    app.on('before-quit', () => {
        debugLog('🛑 Before quit, stopping server...');
        stopServer();
    });

    app.on('quit', () => {
        debugLog('👋 App quit');
        stopServer();
    });
}

debugLog('📜 Main process script loaded');
