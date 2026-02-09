/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║   UNIVIDOWN v1.0.0 - ELECTRON MAIN PROCESS                        ║
 * ║   Desktop wrapper for UniviDown web application                   ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn, fork } = require('child_process');

// Server process reference
let serverProcess = null;
let mainWindow = null;
let tray = null;

// Detect if running in packaged app
const isPackaged = app.isPackaged;

// Get base path (different for dev vs production)
function getBasePath() {
    if (isPackaged) {
        // In packaged app, resources are in app.asar or unpacked
        return path.join(process.resourcesPath, 'app');
    }
    return path.join(__dirname, '..');
}

// Paths
const basePath = getBasePath();
const serverPath = path.join(basePath, 'server.js');
const publicPath = path.join(basePath, 'public');
const iconPath = path.join(publicPath, 'assets', 'logouniversaldown.png');
const icoPath = path.join(publicPath, 'assets', 'logouniversaldown.ico');

// Bin paths for ffmpeg and yt-dlp
function getBinPath() {
    if (isPackaged) {
        return path.join(process.resourcesPath, 'bin');
    }
    return path.join(__dirname, '..', 'bin');
}

// Server URL
const SERVER_URL = 'http://localhost:3000';

/**
 * Start the Express server
 */
function startServer() {
    return new Promise((resolve, reject) => {
        console.log('🚀 Starting UniviDown server...');
        console.log('📁 Base path:', basePath);
        console.log('📁 Server path:', serverPath);
        console.log('📁 Bin path:', getBinPath());
        
        // Set environment variables for bin paths
        const binPath = getBinPath();
        const env = {
            ...process.env,
            UNIVIDOWN_BIN_PATH: binPath,
            UNIVIDOWN_BASE_PATH: basePath,
            PATH: `${binPath}${path.delimiter}${process.env.PATH}`
        };

        // Use fork instead of spawn for Node.js scripts
        // This uses the embedded Node.js in Electron
        serverProcess = fork(serverPath, [], {
            cwd: basePath,
            env: env,
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            execPath: process.execPath,
            execArgv: []
        });

        serverProcess.stdout.on('data', (data) => {
            console.log(`[Server] ${data.toString().trim()}`);
            // Check if server is ready
            if (data.toString().includes('UniviDown server started')) {
                resolve();
            }
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(`[Server Error] ${data.toString().trim()}`);
        });

        serverProcess.on('error', (err) => {
            console.error('Failed to start server:', err);
            reject(err);
        });

        serverProcess.on('close', (code) => {
            console.log(`Server process exited with code ${code}`);
            serverProcess = null;
        });

        // Timeout fallback - resolve after 3 seconds if server doesn't emit ready message
        setTimeout(() => resolve(), 3000);
    });
}

/**
 * Stop the Express server
 */
function stopServer() {
    if (serverProcess) {
        console.log('🛑 Stopping UniviDown server...');
        
        // Send SIGINT for graceful shutdown
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t']);
        } else {
            serverProcess.kill('SIGINT');
        }
        
        serverProcess = null;
    }
}

/**
 * Create the main application window
 */
function createWindow() {
    // Get icon for window
    let windowIcon = null;
    try {
        if (process.platform === 'win32') {
            windowIcon = nativeImage.createFromPath(icoPath);
        } else {
            windowIcon = nativeImage.createFromPath(iconPath);
        }
    } catch (err) {
        console.warn('Could not load window icon:', err.message);
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

    // Load the web app
    mainWindow.loadURL(SERVER_URL);

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // Handle window close
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Handle navigation errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error(`Failed to load: ${errorDescription}`);
        // Retry after 2 seconds
        setTimeout(() => {
            if (mainWindow) {
                mainWindow.loadURL(SERVER_URL);
            }
        }, 2000);
    });
}

/**
 * Create system tray
 */
function createTray() {
    try {
        let trayIcon = null;
        if (process.platform === 'win32') {
            trayIcon = nativeImage.createFromPath(icoPath);
        } else {
            trayIcon = nativeImage.createFromPath(iconPath);
        }
        
        // Resize for tray (16x16 on Windows)
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
        
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
    } catch (err) {
        console.warn('Could not create tray:', err.message);
    }
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // Someone tried to run a second instance, focus our window
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    // App ready
    app.whenReady().then(async () => {
        console.log('🎉 UniviDown Desktop starting...');
        
        // Start server first
        await startServer();
        
        // Then create window
        createWindow();
        createTray();

        app.on('activate', () => {
            // On macOS, re-create window when dock icon is clicked
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    // Quit when all windows are closed
    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    // Clean up on quit
    app.on('before-quit', () => {
        stopServer();
    });

    app.on('quit', () => {
        stopServer();
    });
}
