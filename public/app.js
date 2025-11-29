document.addEventListener('DOMContentLoaded', () => {
    const playlistEl = document.getElementById('playlist');
    const audioPlayer = document.getElementById('audioPlayer');
    const currentTitle = document.getElementById('currentTitle');
    const albumArt = document.getElementById('albumArt');

    // Fetch Settings
    fetch('/api/settings')
        .then(res => res.json())
        .then(settings => {
            if (settings.siteTitle) {
                document.title = settings.siteTitle;
                const headerTitle = document.querySelector('header h1');
                if (headerTitle) headerTitle.textContent = settings.siteTitle;
            }
        })
        .catch(err => console.log('Settings fetch error:', err));

    // Check for direct QR code play first
    const urlParams = new URLSearchParams(window.location.search);
    const songToPlay = urlParams.get('song');

    if (songToPlay) {
        // Try to play the specific song directly
        playDirectSong(songToPlay);
    } else {
        // Load playlist for normal browsing
        loadPlaylist();
    }

    function loadPlaylist() {
        fetch('/api/playlist')
            .then(response => response.json())
            .then(files => {
                playlistEl.innerHTML = ''; // Clear loading

                if (files.length === 0) {
                    playlistEl.innerHTML = '<li class="loading">暂无歌曲，请联系管理员上传。</li>';
                    return;
                }

                files.forEach((file, index) => {
                    const li = document.createElement('li');
                    li.innerHTML = `<span class="icon">🎵</span> ${file.name}`;
                    li.addEventListener('click', () => {
                        playTrack(file, li);
                    });
                    playlistEl.appendChild(li);
                });
            })
            .catch(err => {
                console.error('Error fetching playlist:', err);
                playlistEl.innerHTML = '<li class="loading">加载失败，请刷新重试。</li>';
            });
    }

    function playDirectSong(filename) {
        // Verify the song exists and is not hidden
        fetch('/api/playlist')
            .then(response => response.json())
            .then(files => {
                const targetFile = files.find(f => f.name === filename);
                if (targetFile) {
                    // Create a temporary list item for the active state
                    const tempLi = document.createElement('li');
                    playTrack(targetFile, tempLi);

                    // Show playlist in background
                    loadPlaylist();

                    // Find and highlight the actual list item when playlist loads
                    setTimeout(() => {
                        const actualLi = Array.from(playlistEl.children).find(li => li.textContent.includes(filename));
                        if (actualLi) {
                            actualLi.classList.add('active');
                        }
                    }, 100);
                } else {
                    // Song not found or hidden, load normal playlist
                    currentTitle.textContent = '指定的歌曲不存在或已隐藏';
                    loadPlaylist();
                }
            })
            .catch(err => {
                console.error('Error verifying song:', err);
                currentTitle.textContent = '加载歌曲失败';
                loadPlaylist();
            });
    }

    function playTrack(file, liElement) {
        // Update Active State
        document.querySelectorAll('.playlist li').forEach(el => el.classList.remove('active'));
        if (liElement) liElement.classList.add('active');

        // Update Player
        currentTitle.textContent = file.name;
        audioPlayer.src = file.url;

        const playPromise = audioPlayer.play();

        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.log('Auto-play prevented:', error);
                // Show a "Click to Play" overlay if blocked
                showPlayOverlay(() => audioPlayer.play());
            });
        }

        // Animation
        if (albumArt) {
            albumArt.style.animation = 'none';
            albumArt.offsetHeight; /* trigger reflow */
            albumArt.style.animation = 'pulse 2s infinite';
        }
    }

    function showPlayOverlay(callback) {
        let overlay = document.getElementById('playOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'playOverlay';
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.7); z-index: 9999;
                display: flex; justify-content: center; align-items: center;
                cursor: pointer;
            `;
            overlay.innerHTML = '<div style="font-size: 80px; color: white;">▶️</div>';
            document.body.appendChild(overlay);

            overlay.addEventListener('click', () => {
                overlay.style.display = 'none';
                callback();
            });
        } else {
            overlay.style.display = 'flex';
        }
    }
});
