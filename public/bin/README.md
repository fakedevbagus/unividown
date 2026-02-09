# Binary Dependencies

Folder ini berisi executable yang diperlukan untuk UniviDown desktop app.

## Required Files

1. **yt-dlp.exe** - Download dari https://github.com/yt-dlp/yt-dlp/releases
2. **ffmpeg.exe** - Download dari https://ffmpeg.org/download.html (pilih Windows build)

## Setup

1. Download `yt-dlp.exe` dari release terbaru
2. Download `ffmpeg.exe` (static build untuk Windows)
3. Letakkan kedua file di folder `/bin` ini:

```
bin/
├── yt-dlp.exe
├── ffmpeg.exe
└── README.md
```

## Notes

- Untuk development, jika yt-dlp dan ffmpeg sudah ada di system PATH, folder ini bisa kosong
- Untuk build production (.exe), kedua file HARUS ada di folder ini
- Pastikan download versi 64-bit untuk Windows x64
