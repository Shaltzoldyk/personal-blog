/**
 * player.js (mobile sync update)
 *  - Keeps original player behavior (playlist, volume, persistence).
 *  - Wires mobile bar UI (mm-play button and mm-title) so they reflect real player state.
 *  - Defensive: works if mobile controls are absent; re-wires after PJAX events.
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

    function updateTitleUI() {
      // update desktop title element
      try { titleEl.textContent = playlist[currentIndex] || ''; } catch (e) {}
      // update mobile title (if present)
      const mmTitle = document.querySelector('.mobile-music-bar .mm-title');
      if (mmTitle) {
        mmTitle.textContent = playlist[currentIndex] || 'Music';
      }
    }

    function updateMobileButton(stateIsPlaying) {
      const mmPlay = document.getElementById('mm-play');
      if (!mmPlay) return;
      try {
        mmPlay.textContent = stateIsPlaying ? '❚❚' : '▶';
        mmPlay.setAttribute('aria-pressed', stateIsPlaying ? 'true' : 'false');
        // toggle a small active class for styling if exists
        mmPlay.classList.toggle('mm-playing', !!stateIsPlaying);
      } catch (e) {}
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

      // update mobile play/pause UI as well
      updateMobileButton(isPlaying && !audio.paused);
      updateTitleUI();
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
      updateTitleUI();
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

    function setTrack(index, autoPlay = false) {
      index = (index + playlist.length) % playlist.length;
      currentIndex = index;
      const filename = playlist[currentIndex];
      audio.src = srcFor(filename);
      // update immediate UI feedback
      try { titleEl.textContent = filename; } catch (e) {}
      updateTitleUI();
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

    // initialize track
    setTrack(currentIndex, false);

    // If saved playing state was true and user has already interacted in this session, start
    if (isPlaying && userInteracted) {
      audio.play().catch(()=>{});
    }

    // Provide a safe toggle method for play/pause (used by mobile UI)
    function _togglePlay() {
      try {
        if (!audio.src) {
          setTrack(currentIndex, false);
        }
        if (audio.paused) {
          userInteracted = true;
          audio.play().then(() => {
            isPlaying = true;
            updateButtons();
            persist();
          }).catch(()=>{});
        } else {
          audio.pause();
          isPlaying = false;
          updateButtons();
          persist();
        }
      } catch (e) { /* defensive */ }
    }

    // Expose and return the player API
    return {
      el: dom,
      audio,
      play: () => btnPlay.click(),
      pause: () => btnPause.click(),
      next: () => btnNext.click(),
      back: () => btnBack.click(),
      setVolume: (v) => { currentVolume = Math.min(1, Math.max(0, v)); applyVolume(); persist(); },
      toggleMute: () => { isMuted = !isMuted; applyVolume(); persist(); },
      getState: () => ({ index: currentIndex, isPlaying, currentTime: audio.currentTime || 0, volume: currentVolume, muted: isMuted }),
      // new compatibility method
      toggle: _togglePlay,
      // internal helpers (exposed for defensive external listeners)
      _updateButtons: updateButtons,
      _updateTitleUI: updateTitleUI
    };
  }

  // Initialize player immediately (conservative - existing behavior preserved)
  try {
    window.__SHALTZ_PLAYER = Player();
    // Alias for older/inconsistent references (index.html used window.ShaltzPlayer)
    if (!window.ShaltzPlayer) window.ShaltzPlayer = window.__SHALTZ_PLAYER;
    document.dispatchEvent(new CustomEvent('sh:player-ready', { detail: { player: window.__SHALTZ_PLAYER } }));
  } catch (e) {
    console.warn('Player initialization failed', e);
  }

  // MOBILE SYNC: wire mobile mm-play and mm-title to reflect player state
  function wireMobileUI() {
    try {
      const mm = document.getElementById('mm-play');
      const mmTitle = document.querySelector('.mobile-music-bar .mm-title');

      // If mobile elements are absent, nothing to wire
      if (!mm && !mmTitle) return;

      const player = window.__SHALTZ_PLAYER;
      if (!player) return;

      // helper to sync (safe)
      function syncUI() {
        try {
          const st = player.getState();
          // mm title
          if (mmTitle) mmTitle.textContent = playlist[st.index] || 'Music — tap to open';
          // mm play icon
          if (mm) mm.textContent = st.isPlaying ? '❚❚' : '▶';
          if (mm) mm.setAttribute('aria-pressed', st.isPlaying ? 'true' : 'false');
          if (mm) mm.classList.toggle('mm-playing', !!st.isPlaying);
        } catch (e) { /* ignore sync errors */ }
      }

      // Wire click to toggle playback (keeps fallback behavior from earlier code)
      if (mm && !mm.dataset.__shWire) {
        mm.dataset.__shWire = '1';
        mm.addEventListener('click', (ev) => {
          ev.preventDefault();
          try {
            if (window.__SHALTZ_PLAYER && typeof window.__SHALTZ_PLAYER.toggle === 'function') {
              window.__SHALTZ_PLAYER.toggle();
            } else {
              window.open('https://open.spotify.com/user/shalvin.rautela', '_blank', 'noopener');
            }
          } catch (err) {
            // fallback: open spotify
            window.open('https://open.spotify.com/user/shalvin.rautela', '_blank', 'noopener');
          } finally {
            // schedule a sync shortly after click (player state may change)
            setTimeout(syncUI, 220);
          }
        });
      }

      // initial sync
      setTimeout(syncUI, 60);

      // react to player events: play, pause, track change
      try {
        const audio = player.audio;
        if (audio) {
          audio.addEventListener('play', syncUI);
          audio.addEventListener('pause', syncUI);
          audio.addEventListener('loadedmetadata', syncUI);
          audio.addEventListener('ended', syncUI);
        }
      } catch (e) { /* ignore */ }

      // also listen to custom ready event (in case player created after)
      document.addEventListener('sh:player-ready', syncUI);

    } catch (e) {
      // don't break page if mobile wiring fails
      console.warn('mobile UI wire failed', e);
    }
  }

  // Run wiring on DOM ready and after PJAX events (defensive)
  function initMobileWire() {
    try { wireMobileUI(); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileWire);
  } else {
    initMobileWire();
  }

  ['pjax:loaded', 'pjax:complete', 'pjax:end'].forEach(ev => {
    document.addEventListener(ev, initMobileWire);
  });

})();
