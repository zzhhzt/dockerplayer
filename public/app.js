document.addEventListener('DOMContentLoaded', () => {
    const playlistEl = document.getElementById('playlist');
    const audioPlayer = document.getElementById('audioPlayer');
    const currentTitle = document.getElementById('currentTitle');
    const albumArt = document.getElementById('albumArt');

    // Fetch playlist
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

                // Check for URL param
                const urlParams = new URLSearchParams(window.location.search);
                const songParam = urlParams.get('song');
                if (songParam && file.name === songParam) {
                    playTrack(file, li);
                }
            });
        })
        .catch(err => {
            console.error('Error fetching playlist:', err);
            playlistEl.innerHTML = '<li class="loading">加载失败，请刷新重试。</li>';
        });

    function playTrack(file, liElement) {
        // Update Active State
        document.querySelectorAll('.playlist li').forEach(el => el.classList.remove('active'));
        liElement.classList.add('active');

        // Update Player
        currentTitle.textContent = file.name;
        audioPlayer.src = file.url;

        // Auto play (might be blocked by browser policy if no interaction, but okay for this use case)
        const playPromise = audioPlayer.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.log("Auto-play was prevented:", error);
                // Optional: Show a "Click to Play" button overlay
            });
        }

        // Simple animation reset
        albumArt.style.animation = 'none';
        albumArt.offsetHeight; /* trigger reflow */
        albumArt.style.animation = 'pulse 2s infinite';
    }
});
