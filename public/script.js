// ========================================
// Universal Media Downloader v6.0
// Frontend Script
// ========================================

(() => {
    'use strict';

    // ========== Platform Emoji Mapping ==========
    const platformEmojis = {
        youtube: '🎬',
        tiktok: '🎵',
        vimeo: '🎥',
        facebook: '📘',
        twitter: '🐦',
        twitch: '🎮',
        soundcloud: '☁️',
        instagram: '📸',
        reddit: '🔶',
        dailymotion: '📺',
        bilibili: '📺',
        niconico: '🎌',
        default: '🌐'
    };

    // ========== State Management ==========
    const state = {
        videoInfo: null,
        downloadId: null,
        mode: 'video',
        isPlaylist: false,
        isFetching: false,
        isDownloading: false,
        eventSource: null,
        toastQueue: [],
        maxToasts: 3,
        currentPlatform: 'default'
    };

    // ========== DOM Elements ==========
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const elements = {
        urlInput: $('#urlInput'),
        pasteBtn: $('#pasteBtn'),
        fetchBtn: $('#fetchBtn'),
        downloadBtn: $('#downloadBtn'),
        cancelBtn: $('#cancelBtn'),
        newDownloadBtn: $('#newDownloadBtn'),
        showFilesBtn: $('#showFiles'),
        refreshFilesBtn: $('#refreshFiles'),
        closeModalBtn: $('#closeModal'),
        themeToggle: $('#themeToggle'),
        
        previewSection: $('#previewSection'),
        optionsSection: $('#optionsSection'),
        progressSection: $('#progressSection'),
        resultSection: $('#resultSection'),
        
        skeletonLoader: $('#skeletonLoader'),
        previewContent: $('#previewContent'),
        thumbnail: $('#thumbnail'),
        durationBadge: $('#durationBadge'),
        playlistBadge: $('#playlistBadge'),
        videoCount: $('#videoCount'),
        videoTitle: $('#videoTitle'),
        videoChannel: $('#videoChannel'),
        estimatedSize: $('#estimatedSize'),
        sizeValue: $('#sizeValue'),
        durationWarning: $('#durationWarning'),
        subtitleBadge: $('#subtitleBadge'),
        subtitleOption: $('#subtitleOption'),
        downloadSubtitles: $('#downloadSubtitles'),
        customFilename: $('#customFilename'),
        
        videoOptions: $('#videoOptions'),
        audioOptions: $('#audioOptions'),
        mergeOption: $('#mergeOption'),
        qualityGrid: $('#qualityGrid'),
        qualityWarning: $('#qualityWarning'),
        qualityWarningText: $('#qualityWarningText'),
        
        progressTitle: $('#progressTitle'),
        progressFill: $('#progressFill'),
        progressPercentage: $('#progressPercentage'),
        progressStatus: $('#progressStatus'),
        progressStages: $('#progressStages'),
        
        resultTitle: $('#resultTitle'),
        resultFiles: $('#resultFiles'),
        
        fileModal: $('#fileModal'),
        fileList: $('#fileList'),
        toastContainer: $('#toastContainer'),
        notificationSound: $('#notificationSound')
    };

    // ========== Utility Functions ==========
    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDuration = (seconds) => {
        if (!seconds || isNaN(seconds)) return '--:--';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${m}:${String(s).padStart(2, '0')}`;
    };

    const isValidUrl = (url) => {
        try {
            const urlObj = new URL(url);
            return (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') && url.length <= 1000;
        } catch {
            return false;
        }
    };

    const sanitizeFilename = (name) => {
        return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100);
    };

    // ========== Toast System (Max 3) ==========
    const showToast = (message, type = 'info', duration = 4000) => {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            error: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
            warning: '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
        };
        
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close">&times;</button>
        `;
        
        // Limit max toasts to 3
        const existingToasts = elements.toastContainer.querySelectorAll('.toast');
        if (existingToasts.length >= state.maxToasts) {
            existingToasts[0].remove();
        }
        
        elements.toastContainer.appendChild(toast);
        
        // Close button
        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 300);
        });
        
        // Auto remove
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.add('toast-exit');
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
    };

    // ========== Sound & Vibration Notification ==========
    const playNotificationSound = () => {
        try {
            // Try to play audio file first
            const audio = new Audio('sounds/done.mp3');
            audio.volume = 0.5;
            audio.play().catch(() => {
                // Fallback: Create a simple beep using Web Audio API
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                oscillator.frequency.value = 800;
                oscillator.type = 'sine';
                gainNode.gain.value = 0.3;
                
                oscillator.start();
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
                oscillator.stop(audioContext.currentTime + 0.3);
            });
        } catch (e) {
            console.log('Sound notification not available');
        }
    };

    const triggerVibration = () => {
        if ('vibrate' in navigator) {
            navigator.vibrate([200, 100, 200]);
        }
    };

    // ========== Platform Theme System ==========
    const getPlatformKey = (platform) => {
        if (!platform) return 'default';
        const p = platform.toLowerCase();
        if (p.includes('youtube')) return 'youtube';
        if (p.includes('tiktok')) return 'tiktok';
        if (p.includes('vimeo')) return 'vimeo';
        if (p.includes('facebook') || p.includes('fb')) return 'facebook';
        if (p.includes('twitter') || p.includes('x.com')) return 'twitter';
        if (p.includes('twitch')) return 'twitch';
        if (p.includes('soundcloud')) return 'soundcloud';
        if (p.includes('instagram')) return 'instagram';
        if (p.includes('reddit')) return 'reddit';
        if (p.includes('dailymotion')) return 'dailymotion';
        return 'default';
    };

    const applyPlatformTheme = (platform) => {
        const key = getPlatformKey(platform);
        state.currentPlatform = key;
        
        // Remove all theme classes
        document.body.classList.remove(
            'theme-youtube', 'theme-tiktok', 'theme-vimeo', 
            'theme-facebook', 'theme-twitter', 'theme-twitch',
            'theme-soundcloud', 'theme-instagram', 'theme-reddit',
            'theme-dailymotion', 'theme-default'
        );
        
        // Add new theme class
        document.body.classList.add(`theme-${key}`);
        
        // Update platform badge
        const platformEl = document.getElementById('videoPlatform');
        const iconEl = document.getElementById('platformIcon');
        const nameEl = document.getElementById('platformName');
        
        if (platformEl && iconEl && nameEl) {
            iconEl.textContent = platformEmojis[key] || platformEmojis.default;
            nameEl.textContent = platform || 'Unknown';
            platformEl.style.display = 'inline-flex';
        }
    };

    // ========== URL Input Handling ==========
    const handleUrlInput = () => {
        const url = elements.urlInput.value.trim();
        const isValid = isValidUrl(url);
        elements.fetchBtn.disabled = !isValid || state.isFetching;
        
        if (url && !isValid) {
            elements.urlInput.classList.add('invalid');
        } else {
            elements.urlInput.classList.remove('invalid');
        }
    };

    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            elements.urlInput.value = text;
            handleUrlInput();
            if (isValidUrl(text)) {
                fetchVideoInfo();
            }
        } catch (e) {
            showToast('Tidak dapat mengakses clipboard', 'error');
        }
    };

    // ========== Fetch Video Info ==========
    const fetchVideoInfo = async () => {
        const url = elements.urlInput.value.trim();
        if (!url || state.isFetching) return;
        
        state.isFetching = true;
        elements.fetchBtn.disabled = true;
        elements.fetchBtn.classList.add('loading');
        
        // Show preview section with skeleton
        elements.previewSection.style.display = 'block';
        elements.skeletonLoader.style.display = 'flex';
        elements.previewContent.style.display = 'none';
        elements.optionsSection.style.display = 'none';
        elements.progressSection.style.display = 'none';
        elements.resultSection.style.display = 'none';
        
        try {
            const response = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Gagal mengambil info');
            }
            
            state.videoInfo = data;
            state.isPlaylist = data.isPlaylist;
            displayVideoInfo(data);
            
        } catch (error) {
            showToast(error.message, 'error');
            elements.previewSection.style.display = 'none';
        } finally {
            state.isFetching = false;
            elements.fetchBtn.disabled = false;
            elements.fetchBtn.classList.remove('loading');
        }
    };

    // ========== Display Video Info ==========
    const displayVideoInfo = (info) => {
        elements.skeletonLoader.style.display = 'none';
        elements.previewContent.style.display = 'flex';
        elements.optionsSection.style.display = 'block';
        
        // Apply platform theme
        applyPlatformTheme(info.platform);
        
        elements.thumbnail.src = info.thumbnail || '';
        elements.videoTitle.textContent = info.title || 'Unknown Title';
        elements.videoChannel.textContent = info.channel || 'Unknown Channel';
        
        // Duration
        if (info.isPlaylist) {
            elements.durationBadge.textContent = info.videoCount + ' videos';
            elements.playlistBadge.style.display = 'flex';
            elements.videoCount.textContent = info.videoCount + ' videos';
            elements.mergeOption.style.display = 'block';
        } else {
            elements.durationBadge.textContent = formatDuration(info.duration);
            elements.playlistBadge.style.display = 'none';
            elements.mergeOption.style.display = 'none';
        }
        
        // Estimated size
        if (info.estimatedSize) {
            elements.estimatedSize.style.display = 'flex';
            elements.sizeValue.textContent = '~' + formatBytes(info.estimatedSize);
        } else {
            elements.estimatedSize.style.display = 'none';
        }
        
        // Duration warning (>1 hour)
        if (info.durationWarning) {
            elements.durationWarning.style.display = 'flex';
        } else {
            elements.durationWarning.style.display = 'none';
        }
        
        // Subtitles available
        if (info.hasSubtitles) {
            elements.subtitleBadge.style.display = 'flex';
            elements.subtitleOption.style.display = 'block';
        } else {
            elements.subtitleBadge.style.display = 'none';
            elements.subtitleOption.style.display = 'none';
        }
        
        // Populate quality options dynamically
        populateQualityOptions(info.availableResolutions || [], info.hasVideoFormats);
        
        // Check if file size exceeds limit
        if (info.fileSizeExceeded) {
            showToast('⚠️ File terlalu besar (>5GB), download mungkin gagal', 'warning', 5000);
            elements.downloadBtn.disabled = true;
        } else {
            // Enable download button
            elements.downloadBtn.disabled = false;
        }
    };

    // ========== Dynamic Quality Population ==========
    const populateQualityOptions = (availableResolutions, hasVideoFormats = true) => {
        const grid = elements.qualityGrid;
        if (!grid) return;

        // Standard quality options
        const standardQualities = [
            { value: '360', label: '360p' },
            { value: '480', label: '480p' },
            { value: '720', label: '720p' },
            { value: '1080', label: '1080p' },
            { value: '1440', label: '1440p' },
            { value: '2160', label: '4K' }
        ];

        // Store available resolutions in state
        state.availableResolutions = availableResolutions;

        // If no resolutions detected but has video formats, show Best Only
        if (availableResolutions.length === 0 && hasVideoFormats) {
            grid.innerHTML = `
                <label class="quality-option active best-only">
                    <input type="radio" name="videoQuality" value="best" checked>
                    <span>Best Available</span>
                </label>
            `;
            showToast('📊 Resolusi tidak terdeteksi, menggunakan Best Available', 'info', 3000);
            initQualityOptionHandlers();
            return;
        }

        // If only one resolution available, show Best Only with resolution info
        if (availableResolutions.length === 1) {
            const singleRes = availableResolutions[0];
            grid.innerHTML = `
                <label class="quality-option active best-only">
                    <input type="radio" name="videoQuality" value="best" checked>
                    <span>Best Only (${singleRes}p)</span>
                </label>
            `;
            showToast(`📊 Hanya tersedia satu kualitas: ${singleRes}p`, 'info', 3000);
            initQualityOptionHandlers();
            return;
        }

        // Determine best available resolution
        let bestAvailableQuality = 'best';
        if (availableResolutions.length > 0) {
            // Find highest available resolution that matches standard qualities
            for (const q of standardQualities.slice().reverse()) {
                const height = parseInt(q.value, 10);
                if (availableResolutions.some(r => r >= height)) {
                    bestAvailableQuality = q.value;
                    break;
                }
            }
        }

        // Build quality grid HTML
        let html = '';
        
        standardQualities.forEach(q => {
            const height = parseInt(q.value, 10);
            const isAvailable = availableResolutions.length === 0 || 
                               availableResolutions.some(r => r >= height - 50 && r <= height + 50);
            const isExactMatch = availableResolutions.includes(height);
            const isSelected = q.value === bestAvailableQuality;
            
            html += `
                <label class="quality-option ${isSelected ? 'active' : ''} ${!isAvailable ? 'unavailable' : ''}" data-available="${isAvailable}" data-exact="${isExactMatch}">
                    <input type="radio" name="videoQuality" value="${q.value}" ${isSelected ? 'checked' : ''}>
                    <span>${q.label}</span>
                    ${isExactMatch ? '<span class="quality-badge">✓</span>' : ''}
                </label>
            `;
        });

        // Add "Best Available" option
        html += `
            <label class="quality-option ${bestAvailableQuality === 'best' ? 'active' : ''}">
                <input type="radio" name="videoQuality" value="best" ${bestAvailableQuality === 'best' ? 'checked' : ''}>
                <span>Best</span>
            </label>
        `;

        grid.innerHTML = html;

        // Show available resolutions info
        if (availableResolutions.length > 0) {
            const maxRes = Math.max(...availableResolutions);
            showToast(`📊 Resolusi tersedia: hingga ${maxRes}p`, 'info', 3000);
        }

        // Re-initialize quality option handlers
        initQualityOptionHandlers();
    };

    const initQualityOptionHandlers = () => {
        $$('.quality-option input').forEach(input => {
            input.addEventListener('change', () => {
                $$('.quality-option').forEach(opt => opt.classList.remove('active'));
                input.closest('.quality-option').classList.add('active');
                
                // Check if selected quality is available
                checkQualityAvailability(input.value);
            });
        });
    };

    const checkQualityAvailability = (selectedQuality) => {
        if (!elements.qualityWarning) return;
        
        const height = parseInt(selectedQuality, 10);
        if (isNaN(height) || selectedQuality === 'best') {
            elements.qualityWarning.style.display = 'none';
            return;
        }

        const available = state.availableResolutions || [];
        if (available.length === 0) {
            elements.qualityWarning.style.display = 'none';
            return;
        }

        // Check if exact or close match exists
        const hasMatch = available.some(r => Math.abs(r - height) <= 50);
        
        if (!hasMatch) {
            // Find nearest available resolution
            const nearest = available.reduce((prev, curr) => 
                Math.abs(curr - height) < Math.abs(prev - height) ? curr : prev
            );
            elements.qualityWarningText.textContent = `Resolusi ${height}p tidak tersedia, akan menggunakan ${nearest}p`;
            elements.qualityWarning.style.display = 'flex';
        } else {
            elements.qualityWarning.style.display = 'none';
        }
    };

    // ========== Mode Toggle ==========
    const initModeToggle = () => {
        const modeButtons = $$('.mode-btn');
        modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                modeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                state.mode = btn.dataset.mode;
                
                if (state.mode === 'video') {
                    elements.videoOptions.style.display = 'block';
                    elements.audioOptions.style.display = 'none';
                } else {
                    elements.videoOptions.style.display = 'none';
                    elements.audioOptions.style.display = 'block';
                }
            });
        });
    };

    // ========== Format/Quality Selection ==========
    const initOptionCards = () => {
        // Format cards
        $$('.format-card input').forEach(input => {
            input.addEventListener('change', () => {
                const parent = input.closest('.format-cards');
                parent.querySelectorAll('.format-card').forEach(c => c.classList.remove('active'));
                input.closest('.format-card').classList.add('active');
            });
        });
        
        // Quality options
        $$('.quality-option input').forEach(input => {
            input.addEventListener('change', () => {
                const parent = input.closest('.quality-grid');
                parent.querySelectorAll('.quality-option').forEach(c => c.classList.remove('active'));
                input.closest('.quality-option').classList.add('active');
            });
        });
    };

    // ========== Start Download ==========
    const startDownload = async () => {
        if (!state.videoInfo || state.isDownloading) return;
        
        state.isDownloading = true;
        elements.downloadBtn.disabled = true;
        elements.downloadBtn.classList.add('loading');
        elements.downloadBtn.textContent = 'Starting...';
        
        // Build options - ensure type is 'video' or 'audio', not format
        const options = {
            url: elements.urlInput.value.trim(),
            type: state.mode, // 'video' or 'audio'
            mode: state.mode, // backward compatibility
            customFilename: elements.customFilename.value.trim() || null
        };
        
        if (state.mode === 'video') {
            options.format = document.querySelector('input[name="videoFormat"]:checked').value;
            options.quality = document.querySelector('input[name="videoQuality"]:checked').value;
            options.embedThumbnail = $('#embedThumbnailVideo').checked;
            options.highCompatibility = $('#highCompatibility')?.checked || false;
            options.downloadSubtitles = $('#downloadSubtitles')?.checked || false;
        } else {
            options.format = document.querySelector('input[name="audioFormat"]:checked').value;
            options.embedThumbnail = $('#embedThumbnailAudio').checked;
            options.normalize = $('#normalizeAudio').checked;
            options.merge = state.isPlaylist && $('#mergeAudio').checked;
        }
        
        // Show progress section
        elements.optionsSection.style.display = 'none';
        elements.progressSection.style.display = 'block';
        elements.progressTitle.textContent = 'Starting download...';
        elements.progressPercentage.textContent = '0%';
        elements.progressFill.style.width = '0%';
        elements.progressStatus.textContent = 'Connecting to server...';
        resetProgressStages();
        
        try {
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(options)
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Download failed');
            }
            
            state.downloadId = data.downloadId;
            connectSSE(data.downloadId);
            
        } catch (error) {
            showToast(error.message, 'error');
            resetToOptions();
        }
    };

    // ========== SSE Connection ==========
    const connectSSE = (downloadId) => {
        if (state.eventSource) {
            state.eventSource.close();
        }
        
        state.eventSource = new EventSource(`/api/progress/${downloadId}`);
        
        state.eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                updateProgress(data);
            } catch (e) {
                console.error('SSE parse error:', e);
            }
        };
        
        state.eventSource.onerror = () => {
            if (state.eventSource) {
                state.eventSource.close();
                state.eventSource = null;
            }
        };
    };

    // ========== Update Progress ==========
    const updateProgress = (data) => {
        const { status, progress, message, files, error, queuePosition } = data;
        
        // Update progress bar
        const percent = Math.min(100, Math.max(0, progress || 0));
        elements.progressFill.style.width = percent + '%';
        elements.progressPercentage.textContent = Math.round(percent) + '%';
        
        // Update status message
        if (message) {
            elements.progressStatus.textContent = message;
        }
        
        // Update title based on status
        const statusTitles = {
            queued: `Dalam antrian (posisi ${queuePosition || '?'})`,
            starting: 'Memulai download...',
            downloading_video: 'Downloading video...',
            downloading_audio: 'Downloading audio...',
            postprocessing: 'Processing...',
            converting_audio: 'Converting audio...',
            embedding_metadata: 'Embedding metadata...',
            merging_playlist: 'Merging playlist...',
            finalizing: 'Finalizing...',
            finished: 'Download complete!',
            error: 'Download failed',
            cancelled: 'Download cancelled'
        };
        
        elements.progressTitle.textContent = statusTitles[status] || 'Processing...';
        
        // Update progress stages
        updateProgressStages(status);
        
        // Handle completion
        if (status === 'finished') {
            closeSSE();
            showResult(files);
            playNotificationSound();
            triggerVibration();
            // Auto-refresh file list after download completes
            loadFileList();
        } else if (status === 'error') {
            closeSSE();
            showToast(error || 'Download failed', 'error');
            resetToOptions();
        } else if (status === 'cancelled') {
            closeSSE();
            showToast('Download dibatalkan', 'warning');
            resetToOptions();
        }
    };

    // ========== Progress Stages ==========
    const resetProgressStages = () => {
        $$('.stage').forEach(stage => {
            stage.classList.remove('active', 'completed');
        });
    };

    const updateProgressStages = (status) => {
        const stageMap = {
            queued: 'queued',
            starting: 'queued',
            downloading_video: 'downloading',
            downloading_audio: 'downloading',
            postprocessing: 'processing',
            converting_audio: 'processing',
            embedding_metadata: 'processing',
            merging_playlist: 'processing',
            finalizing: 'processing',
            finished: 'finished'
        };
        
        const currentStage = stageMap[status];
        const stages = ['queued', 'downloading', 'processing', 'finished'];
        const currentIndex = stages.indexOf(currentStage);
        
        stages.forEach((stage, index) => {
            const el = $(`.stage[data-stage="${stage}"]`);
            if (el) {
                if (index < currentIndex) {
                    el.classList.remove('active');
                    el.classList.add('completed');
                } else if (index === currentIndex) {
                    el.classList.add('active');
                    el.classList.remove('completed');
                } else {
                    el.classList.remove('active', 'completed');
                }
            }
        });
    };

    // ========== Show Result ==========
    const showResult = (files) => {
        state.isDownloading = false;
        elements.progressSection.style.display = 'none';
        elements.resultSection.style.display = 'block';
        
        elements.resultFiles.innerHTML = '';
        
        if (files && files.length > 0) {
            files.forEach(file => {
                const fileItem = document.createElement('a');
                fileItem.href = `/downloads/${encodeURIComponent(file.name)}`;
                fileItem.className = 'result-file';
                fileItem.download = file.name;
                
                const iconSvg = file.name.endsWith('.mp4') || file.name.endsWith('.webm') 
                    ? '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>'
                    : '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
                
                fileItem.innerHTML = `
                    <span class="file-icon">${iconSvg}</span>
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${formatBytes(file.size)}</span>
                `;
                
                elements.resultFiles.appendChild(fileItem);
            });
        }
        
        showToast('Download selesai!', 'success');
    };

    // ========== Cancel Download ==========
    const cancelDownload = async () => {
        if (!state.downloadId) return;
        
        try {
            await fetch(`/api/cancel/${state.downloadId}`, { method: 'POST' });
            closeSSE();
            resetToOptions();
            showToast('Download dibatalkan', 'warning');
        } catch (e) {
            showToast('Gagal membatalkan download', 'error');
        }
    };

    // ========== Utilities ==========
    const closeSSE = () => {
        if (state.eventSource) {
            state.eventSource.close();
            state.eventSource = null;
        }
    };

    const resetToOptions = () => {
        state.isDownloading = false;
        state.downloadId = null;
        elements.downloadBtn.disabled = false;
        elements.downloadBtn.classList.remove('loading');
        elements.downloadBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Download</span>';
        elements.progressSection.style.display = 'none';
        elements.optionsSection.style.display = 'block';
    };

    const resetAll = () => {
        state.videoInfo = null;
        state.downloadId = null;
        state.isPlaylist = false;
        state.isFetching = false;
        state.isDownloading = false;
        closeSSE();
        
        elements.urlInput.value = '';
        elements.customFilename.value = '';
        elements.previewSection.style.display = 'none';
        elements.optionsSection.style.display = 'none';
        elements.progressSection.style.display = 'none';
        elements.resultSection.style.display = 'none';
        elements.downloadBtn.disabled = true;
        elements.fetchBtn.disabled = true;
    };

    // ========== File Manager ==========
    const loadFileList = async () => {
        try {
            const response = await fetch('/api/files');
            const files = await response.json();
            
            if (files.length === 0) {
                elements.fileList.innerHTML = `
                    <div class="empty-state">
                        <svg class="icon-lg" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                        <p>Tidak ada file</p>
                    </div>
                `;
                return;
            }
            
            elements.fileList.innerHTML = files.map(file => `
                <div class="file-item">
                    <div class="file-info">
                        <span class="file-name">${file.name}</span>
                        <span class="file-meta">${formatBytes(file.size)} • ${new Date(file.createdAt).toLocaleDateString('id-ID')}</span>
                    </div>
                    <div class="file-actions">
                        <a href="/downloads/${encodeURIComponent(file.name)}" download class="btn-sm btn-download-file" title="Download">
                            <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </a>
                        <button class="btn-sm btn-delete-file" data-name="${file.name}" title="Delete">
                            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `).join('');
            
            // Delete handlers
            $$('.btn-delete-file').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const name = btn.dataset.name;
                    if (confirm(`Hapus "${name}"?`)) {
                        try {
                            await fetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
                            loadFileList();
                            showToast('File dihapus', 'success');
                        } catch (e) {
                            showToast('Gagal menghapus file', 'error');
                        }
                    }
                });
            });
            
        } catch (e) {
            showToast('Gagal memuat daftar file', 'error');
        }
    };

    const openFileModal = () => {
        loadFileList();
        elements.fileModal.classList.add('active');
    };

    const closeFileModal = () => {
        elements.fileModal.classList.remove('active');
    };

    // ========== Theme Toggle ==========
    const initTheme = () => {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.body.dataset.theme = savedTheme;
    };

    const toggleTheme = () => {
        const current = document.body.dataset.theme || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        document.body.dataset.theme = next;
        localStorage.setItem('theme', next);
    };

    // ========== Event Listeners ==========
    const initEventListeners = () => {
        // URL input
        elements.urlInput.addEventListener('input', handleUrlInput);
        elements.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !elements.fetchBtn.disabled) {
                fetchVideoInfo();
            }
        });
        
        // Buttons
        elements.pasteBtn.addEventListener('click', handlePaste);
        elements.fetchBtn.addEventListener('click', fetchVideoInfo);
        elements.downloadBtn.addEventListener('click', startDownload);
        elements.cancelBtn.addEventListener('click', cancelDownload);
        elements.newDownloadBtn.addEventListener('click', resetAll);
        
        // File manager
        elements.showFilesBtn.addEventListener('click', openFileModal);
        elements.refreshFilesBtn.addEventListener('click', loadFileList);
        elements.closeModalBtn.addEventListener('click', closeFileModal);
        elements.fileModal.querySelector('.modal-overlay').addEventListener('click', closeFileModal);
        
        // Theme
        elements.themeToggle.addEventListener('click', toggleTheme);
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeFileModal();
            }
        });
    };

    // ========== Initialize ==========
    const init = () => {
        initTheme();
        initModeToggle();
        initOptionCards();
        initEventListeners();
        loadFileList(); // Load file list on page load
        console.log('🌐 UniviDown v1.0.0 initialized');
    };

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
