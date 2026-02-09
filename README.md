# UniviDown

<p align="center">
  <img src="public/assets/logo.png" alt="UniviDown Logo" width="120">
</p>

<p align="center">
  <strong>UniviDown</strong> — Universal Media Downloader
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D14.0.0-green.svg" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="License">
</p>

---

**UniviDown** is a personal universal media downloader that supports multiple platforms using yt-dlp and FFmpeg. Download videos and audio from YouTube, TikTok, Vimeo, Twitter, Facebook, and many more platforms with a beautiful, modern web interface.

## ✨ Features

- 🌐 **Multi-platform Support** — Download from YouTube, TikTok, Vimeo, Twitter, Facebook, Twitch, SoundCloud, and more
- 🎬 **High Quality Video** — Smart resolution detection with quality selection up to 4K
- 🎵 **High Quality Audio** — Support for FLAC, WAV, MP3, M4A, and Opus formats
- 📊 **Smart Resolution Detection** — Automatically detects available resolutions before download
- 🎨 **Dynamic UI Themes** — Platform-based theme colors with animated glow effects
- 📋 **Playlist Support** — Download entire playlists with optional FLAC merge
- ⚡ **Real-time Progress** — Live progress tracking via Server-Sent Events (SSE)
- 🔄 **Queue System** — FIFO queue with concurrent download management
- 🖥️ **High Compatibility Mode** — Optional re-encoding to H.264/AAC for universal playback
- 🌙 **Dark/Light Theme** — Toggle between dark and light modes
- 📱 **Responsive Design** — Works on desktop and mobile browsers

## 🛠️ Tech Stack

- **Backend:** Node.js + Express
- **Download Engine:** yt-dlp
- **Audio/Video Processing:** FFmpeg
- **Frontend:** Vanilla JavaScript, CSS3 with Glassmorphism
- **Real-time Updates:** Server-Sent Events (SSE)

## 📦 Installation

### Prerequisites

1. **Node.js** (v14.0.0 or higher)
   - Download from [nodejs.org](https://nodejs.org/)

2. **FFmpeg**
   - Windows: Download from [ffmpeg.org](https://ffmpeg.org/download.html) or use `winget install ffmpeg`
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`

3. **yt-dlp**
   - Windows: `winget install yt-dlp` or download from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases)
   - macOS: `brew install yt-dlp`
   - Linux: `sudo apt install yt-dlp` or `pip install yt-dlp`

### Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/unividown.git
cd unividown

# Install dependencies
npm install

# Start the server
node server.js
```

The application will be available at `http://localhost:3000`

## 🚀 Usage

1. Open your browser and navigate to `http://localhost:3000`
2. Paste a video URL from any supported platform
3. Click "Fetch Info" to retrieve video details
4. Select your preferred quality and format
5. Click "Download" and wait for completion
6. Access your downloaded files from the "Files" panel

## ⚙️ Configuration

The server can be configured by modifying the `CONFIG` object in `server.js`:

| Option | Default | Description |
|--------|---------|-------------|
| `MAX_CONCURRENT_DOWNLOADS` | 2 | Maximum simultaneous downloads |
| `DOWNLOAD_TIMEOUT_MS` | 30 min | Download timeout duration |
| `MAX_PLAYLIST_MERGE` | 50 | Maximum videos for playlist merge |
| `FILE_MAX_AGE_MS` | 24 hours | Auto-cleanup downloaded files |

## 📁 Project Structure

```
unividown/
├── public/
│   ├── assets/
│   │   ├── logo.png
│   │   └── favicon.ico
│   ├── sounds/
│   │   └── done.mp3
│   ├── index.html
│   ├── style.css
│   └── script.js
├── downloads/          # Downloaded files
├── temp/               # Temporary processing files
├── server.js           # Main server application
├── package.json
├── .gitignore
└── README.md
```

## 🎨 Supported Platforms

UniviDown supports all platforms that yt-dlp supports, including:

- YouTube (videos, shorts, playlists, music)
- TikTok
- Vimeo
- Twitter/X
- Facebook (videos, reels)
- Instagram (posts, reels)
- Twitch (clips, VODs)
- SoundCloud
- Reddit
- Dailymotion
- And many more...

## ⚠️ Disclaimer

**UniviDown is for personal use only.** 

- Only download content that you have the rights to access
- Respect copyright laws and terms of service of each platform
- The developers are not responsible for any misuse of this software

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🏷️ Version

**v1.0.0** — Initial Release

---

<p align="center">
  Made with ❤️ for personal media archiving
</p>
