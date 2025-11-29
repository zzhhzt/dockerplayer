// HTML escaping function to prevent XSS
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

document.addEventListener('DOMContentLoaded', () => {
    const playlistEl = document.getElementById('playlist');
    const audioPlayer = document.getElementById('audioPlayer');
    const currentTitle = document.getElementById('currentTitle');
    const albumArt = document.getElementById('albumArt');

    // Fetch Settings
    fetch('/api/settings')
        .then(res => {
            if (!res.ok) {
                console.log('Settings fetch failed with status:', res.status);
                return {};
            }
            return res.json();
        })
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
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(files => {
                playlistEl.innerHTML = ''; // Clear loading

                if (files.length === 0) {
                    playlistEl.innerHTML = '<li class="loading">暂无歌曲，请联系管理员上传。</li>';
                    return;
                }

                console.log('Loaded playlist with', files.length, 'files');
                files.forEach((file, index) => {
                    const li = document.createElement('li');
                    li.innerHTML = `<span class="icon">🎵</span> ${escapeHtml(file.name)}`;
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
        // Show loading message
        currentTitle.textContent = '正在加载歌曲...';

        // Verify the song exists and is not hidden
        fetch('/api/playlist')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(files => {
                console.log('Looking for song:', filename, 'in', files.length, 'files');
                const targetFile = files.find(f => f.name === filename);
                if (targetFile) {
                    console.log('Found target file:', targetFile);
                    // Set up the audio player first
                    currentTitle.textContent = targetFile.name;
                    console.log('Setting audio source to:', targetFile.url);
                    audioPlayer.src = targetFile.url;

                    // For mobile, show play overlay with direct play callback
                    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
                        showPlayOverlay(() => {
                            console.log('Mobile play overlay clicked, attempting direct play...');
                            audioPlayer.play().then(() => {
                                console.log('Mobile play successful');
                                loadPlaylist();
                                // Find and highlight the actual list item when playlist loads
                                setTimeout(() => {
                                    const actualLi = Array.from(playlistEl.children).find(li => li.textContent.includes(filename));
                                    if (actualLi) {
                                        actualLi.classList.add('active');
                                    }
                                }, 500);
                            }).catch(error => {
                                console.error('Mobile direct play failed:', error);
                                handlePlayError(error, targetFile);
                            });
                        });
                    } else {
                        // For desktop, try to play directly
                        const playPromise = audioPlayer.play();
                        if (playPromise !== undefined) {
                            playPromise.catch(error => {
                                console.error('Desktop play error:', error);
                                handlePlayError(error, targetFile);
                            });
                        }
                        loadPlaylist();
                    }

                    // Animation
                    if (albumArt) {
                        albumArt.style.animation = 'none';
                        albumArt.offsetHeight; /* trigger reflow */
                        albumArt.style.animation = 'pulse 2s infinite';
                    }
                } else {
                    // Song not found or hidden, load normal playlist
                    console.log('Song not found:', filename);
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
        console.log('Playing track:', file.name, 'URL:', file.url);

        // Set audio source
        audioPlayer.src = file.url;

        // For mobile browsers, we need user interaction to play audio
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (isMobile && !liElement) {
            // Only show overlay for direct mobile plays (not from playlist clicks)
            setTimeout(() => {
                showPlayOverlay(() => {
                    audioPlayer.play().catch(error => {
                        console.error('Mobile audio play error:', error);
                        handlePlayError(error, file);
                    });
                });
            }, 100);
        } else {
            // For desktop or playlist clicks, try to play directly
            const playPromise = audioPlayer.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.error('Audio play error:', error);
                    handlePlayError(error, file);
                });
            }
        }

        // Animation
        if (albumArt) {
            albumArt.style.animation = 'none';
            albumArt.offsetHeight; /* trigger reflow */
            albumArt.style.animation = 'pulse 2s infinite';
        }
    }

    function handlePlayError(error, file) {
        // Try to reload the URL if it's expired
        if (error.name === 'NotSupportedError' || error.message.includes('404') || error.message.includes('403')) {
            console.log('Attempting to get fresh URL for:', file.name);
            currentTitle.textContent = '正在刷新链接...';
            fetch('/api/playlist')
                .then(res => res.json())
                .then(files => {
                    const freshFile = files.find(f => f.name === file.name);
                    if (freshFile) {
                        console.log('Got fresh URL:', freshFile.url);
                        audioPlayer.src = freshFile.url;
                        audioPlayer.play().catch(e => {
                            console.error('Retry failed:', e);
                            showPlayOverlay(() => audioPlayer.play());
                        });
                    } else {
                        currentTitle.textContent = '歌曲不存在或已隐藏';
                    }
                })
                .catch(err => {
                    console.error('Failed to get fresh URL:', err);
                    showPlayOverlay(() => audioPlayer.play());
                });
        } else {
            // Show a "Click to Play" overlay if blocked by browser policy
            console.log('Browser policy blocked autoplay, showing overlay');
            showPlayOverlay(() => audioPlayer.play());
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
                display: flex; flex-direction: column; justify-content: center; align-items: center;
                cursor: pointer;
            `;
            overlay.innerHTML = `
                <div style="font-size: 60px; color: white; margin-bottom: 10px;">▶️</div>
                <div style="color: white; font-size: 16px;">点击播放音乐</div>
            `;
            document.body.appendChild(overlay);

            overlay.addEventListener('click', () => {
                overlay.style.display = 'none';
                console.log('🎵 Play overlay clicked, executing callback...');
                callback();
            });
        } else {
            overlay.style.display = 'flex';
            console.log('🎵 Showed existing play overlay');
        }
    }
});
