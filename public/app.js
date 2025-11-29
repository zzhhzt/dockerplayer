document.addEventListener('DOMContentLoaded', () => {
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
