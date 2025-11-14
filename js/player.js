/**
 * player.js (updated)
 *  - Adds a volume slider and mute/unmute button to the 90s pixel player.
 *  - Persists volume & mute state in localStorage.
 *
 * Include with: <script src="js/player.js" defer></script>
 */

(function () {
  const STORAGE_KEY = 'shaltz_player_state_v1';
  const PLAYER_ID = 'shaltz-audio-player';

  // --- Configure your playlist filenames (exact names inside /music/) ---
  const playlist = [
    'Jump.mp3',
    'Long Time.mp3',
    'Miss The Rage.mp3'
  ];

  const srcFor = (filename) => encodeURI('music/' + filename);

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // ignore
    }
  }

  function createPlayerDOM() {
    if (document.getElementById(PLAYER_ID)) return document.getElementById(PLAYER_ID);

    const container = document.createElement('div');
    container.id = PLAYER_ID;
    container.className = 'sh-player';
    container.setAttribute('aria-label', 'Audio player');
    container.innerHTML = `
      <div class="sh-player-inner" role="region" aria-label="Music player">
        <div class="sh-track-title" aria-live="polite"></div>
        <div class="sh-controls" role="toolbar" aria-label="Player controls">
          <button class="sh-btn sh-back" title="Previous track" aria-label="Previous track">◀◀</button>
          <button class="sh-btn sh-play" title="Play" aria-label="Play">▶</button>
          <button class="sh-btn sh-pause hidden" title="Pause" aria-label="Pause">❚❚</button>
          <button class="sh-btn sh-next" title="Next track" aria-label="Next track">▶▶</button>
          <button class="sh-btn sh-mute" title="Mute" aria-label="Mute">🔈</button>
          <input class="sh-volume" type="range" min="0" max="1" step="0.01" value="0.8" aria-label="Volume" />
        </div>
      </div>
      <audio class="sh-audio" preload="metadata"></audio>
    `;

    // Add inline fallback styles if not present (styles.css also contains rules)
    const styleId = 'sh-player-inline-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
      /* small fallback styling (primary styles live in styles.css) */
      #${PLAYER_ID} { position: fixed; right: 18px; bottom: 18px; z-index: 99999; font-family: 'Courier New', monospace; background: linear-gradient(180deg, #050505, #0a0a0a); border: 2px solid rgba(0,255,102,0.95); color: #00ff66; padding: 8px; border-radius: 6px; box-shadow: 0 6px 12px rgba(0,0,0,0.6); width: 260px; user-select: none; }
      #${PLAYER_ID} .sh-controls { display:flex; gap:6px; align-items:center; justify-content:center; flex-wrap:nowrap; }
      #${PLAYER_ID} .sh-btn { background:transparent; border:1px solid rgba(0,255,102,0.2); color: #00ff66; padding:4px 6px; cursor:pointer; font-family: monospace; border-radius:3px; }
      #${PLAYER_ID} .sh-volume { width:80px; }
      #${PLAYER_ID} .sh-btn.hidden { display:none; }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(container);
    return container;
  }

  function Player() {
    const dom = createPlayerDOM();
    const audio = dom.querySelector('.sh-audio');
    const titleEl = dom.querySelector('.sh-track-title');
    const btnPlay = dom.querySelector('.sh-play');
    const btnPause = dom.querySelector('.sh-pause');
    const btnNext = dom.querySelector('.sh-next');
    const btnBack = dom.querySelector('.sh-back');
    const btnMute = dom.querySelector('.sh-mute');
    const volSlider = dom.querySelector('.sh-volume');

    let currentIndex = 0;
    let isPlaying = false;
    let userInteracted = false;
    let isMuted = false;
    let currentVolume = 0.8;

    const saved = loadState();
    if (saved) {
      if (typeof saved.index === 'number') currentIndex = Math.min(Math.max(0, saved.index), playlist.length - 1);
      if (typeof saved.currentTime === 'number') {
        audio.addEventListener('loadedmetadata', () => {
          try { audio.currentTime = Math.min(saved.currentTime, audio.duration || saved.currentTime); } catch (e) {}
        }, { once: true });
      }
      isPlaying = !!saved.isPlaying;
      if (typeof saved.volume === 'number') currentVolume = Math.min(1, Math.max(0, saved.volume));
      if (typeof saved.muted === 'boolean') isMuted = !!saved.muted;
    }

    function persist() {
      saveState({
        index: currentIndex,
        currentTime: audio.currentTime || 0,
        isPlaying,
        volume: currentVolume,
        muted: isMuted
      });
    }

    function setTrack(index, autoPlay = false) {
      index = (index + playlist.length) % playlist.length;
      currentIndex = index;
      const filename = playlist[currentIndex];
      audio.src = srcFor(filename);
      titleEl.textContent = filename;
      // set volume/mute when source loads
      audio.addEventListener('loadedmetadata', () => {
        applyVolume();
      }, { once: true });
      if (autoPlay && userInteracted) {
        audio.play().catch(()=>{});
      }
      updateButtons();
      persist();
    }

    function updateButtons() {
      if (isPlaying && !audio.paused) {
        btnPlay.classList.add('hidden');
        btnPause.classList.remove('hidden');
      } else {
        btnPlay.classList.remove('hidden');
        btnPause.classList.add('hidden');
      }
      btnMute.textContent = isMuted || audio.muted ? '🔇' : (currentVolume > 0.6 ? '🔊' : (currentVolume > 0.2 ? '🔉' : '🔈'));
      volSlider.value = String(currentVolume.toFixed(2));
    }

    function applyVolume() {
      audio.volume = currentVolume;
      audio.muted = !!isMuted;
      updateButtons();
    }

    // Control handlers
    btnPlay.addEventListener('click', () => {
      userInteracted = true;
      if (!audio.src) setTrack(currentIndex, false);
      audio.play().then(() => {
        isPlaying = true;
        updateButtons();
        persist();
      }).catch(()=>{});
    });

    btnPause.addEventListener('click', () => {
      audio.pause();
      isPlaying = false;
      updateButtons();
      persist();
    });

    btnNext.addEventListener('click', () => {
      const next = (currentIndex + 1) % playlist.length;
      setTrack(next, true);
      isPlaying = true;
      updateButtons();
      persist();
    });

    btnBack.addEventListener('click', () => {
      const prev = (currentIndex - 1 + playlist.length) % playlist.length;
      setTrack(prev, true);
      isPlaying = true;
      updateButtons();
      persist();
    });

    // Mute toggle
    btnMute.addEventListener('click', () => {
      isMuted = !isMuted;
      applyVolume();
      persist();
    });

    // Volume slider
    volSlider.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) {
        currentVolume = Math.min(1, Math.max(0, v));
        // if volume > 0 and muted, unmute
        if (currentVolume > 0 && isMuted) isMuted = false;
        applyVolume();
        persist();
      }
    });

    audio.addEventListener('ended', () => {
      const next = (currentIndex + 1) % playlist.length;
      setTrack(next, true);
      isPlaying = true;
      updateButtons();
      persist();
    });

    // Persist currentTime periodically
    let persistTimer = null;
    audio.addEventListener('play', () => {
      isPlaying = true;
      updateButtons();
      if (persistTimer) clearInterval(persistTimer);
      persistTimer = setInterval(() => {
        saveState({ index: currentIndex, currentTime: audio.currentTime || 0, isPlaying, volume: currentVolume, muted: isMuted });
      }, 2000);
    });
    audio.addEventListener('pause', () => {
      isPlaying = false;
      updateButtons();
      if (persistTimer) { clearInterval(persistTimer); persistTimer = null; }
      persist();
    });

    audio.addEventListener('loadedmetadata', () => {
      if (isPlaying && userInteracted) {
        audio.play().catch(()=>{});
      }
      updateButtons();
    });

    // Keyboard support
    dom.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (audio.paused) btnPlay.click(); else btnPause.click();
      }
      // arrow up/down adjust volume
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        currentVolume = Math.min(1, currentVolume + 0.05);
        if (currentVolume > 0 && isMuted) isMuted = false;
        applyVolume(); persist();
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        currentVolume = Math.max(0, currentVolume - 0.05);
        if (currentVolume === 0) isMuted = true;
        applyVolume(); persist();
      }
    });

    dom.addEventListener('pointerdown', () => { userInteracted = true; });

    // initialize volume/muted
    volSlider.value = String(currentVolume.toFixed(2));
    applyVolume();

    // initialize track
    setTrack(currentIndex, false);

    // If saved playing state was true and user has already interacted in this session, start
    if (isPlaying && userInteracted) {
      audio.play().catch(()=>{});
    }

    return {
      el: dom,
      audio,
      play: () => btnPlay.click(),
      pause: () => btnPause.click(),
      next: () => btnNext.click(),
      back: () => btnBack.click(),
      setVolume: (v) => { currentVolume = Math.min(1, Math.max(0, v)); applyVolume(); persist(); },
      toggleMute: () => { isMuted = !isMuted; applyVolume(); persist(); },
      getState: () => ({ index: currentIndex, isPlaying, currentTime: audio.currentTime || 0, volume: currentVolume, muted: isMuted })
    };
  }

  window.__SHALTZ_PLAYER = Player();
  document.dispatchEvent(new CustomEvent('sh:player-ready', { detail: { player: window.__SHALTZ_PLAYER } }));

})();
