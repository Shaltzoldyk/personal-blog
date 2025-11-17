/**
 * player.js
 * Shaltz site audio player (updated)
 *
 * Goals / changes in this update:
 *  - Keep original desktop player behaviour (playlist, persistence).
 *  - Improve mobile wiring: mm-play (floating button) reliably toggles the central player,
 *    falls back gracefully to native #mobileAudio when central player is not available,
 *    and keeps UI text/classes in sync.
 *  - Expose setTrack API so other scripts can request a particular track.
 *  - Defensive re-bind after PJAX / DOM changes.
 *  - Minimise duplication of audio playback (ensure only one audio plays).
 *
 * Include with: <script src="js/player.js" defer></script>
 */

(function () {
  const STORAGE_KEY = 'shaltz_player_state_v1';
  const PLAYER_ID = 'shaltz-audio-player';

  // playlist files inside /music/
  const playlist = [
    'Jump.mp3',
    'Long Time.mp3',
    'Miss The Rage.mp3'
  ];

  const srcFor = (filename) => 'music/' + filename;

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
    } catch (e) { /* ignore */ }
  }

  function createPlayerDOM() {
    // return existing if present
    if (document.getElementById(PLAYER_ID)) return document.getElementById(PLAYER_ID);

    const container = document.createElement('div');
    container.id = PLAYER_ID;
    container.className = 'sh-player';
    container.setAttribute('aria-label', 'Audio player');

    container.innerHTML = `
      <div class="sh-player-inner" role="region" aria-label="Music player">
        <div class="sh-track-title" aria-live="polite" style="font-family: monospace; font-weight:700; color: #b6ff00; margin-bottom:6px;"></div>
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

    // small inline fallback styles (primary styles live in CSS)
    const styleId = 'sh-player-inline-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #${PLAYER_ID} { position: fixed; right: 18px; bottom: 18px; z-index: 99999; font-family: 'Courier New', monospace; background: linear-gradient(180deg, #050505, #0a0a0a); border: 2px solid rgba(182,255,0,0.95); color: #b6ff00; padding: 8px; border-radius: 6px; box-shadow: 0 6px 12px rgba(0,0,0,0.6); width: 260px; user-select: none; }
        #${PLAYER_ID} .sh-controls { display:flex; gap:6px; align-items:center; justify-content:center; flex-wrap:nowrap; }
        #${PLAYER_ID} .sh-btn { background:transparent; border:1px solid rgba(182,255,0,0.12); color: #b6ff00; padding:4px 6px; cursor:pointer; font-family: monospace; border-radius:3px; }
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
    let userInteracted = false; // whether a user gesture occurred this session
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
      try { titleEl.textContent = playlist[currentIndex] || ''; } catch (e) {}
      // sync mobile UI titles (if present)
      const panelTitle = document.querySelector('.mobile-player-panel .mp-title');
      if (panelTitle) panelTitle.textContent = playlist[currentIndex] || 'Music';
      const mmTitle = document.querySelector('.mobile-music-bar .mm-title');
      if (mmTitle) mmTitle.textContent = playlist[currentIndex] || 'Music';
    }

    function updateMobileButton(stateIsPlaying) {
      const mmPlay = document.getElementById('mm-play');
      if (!mmPlay) return;
      try {
        // toggle visual state and accessible pressed attribute
        mmPlay.textContent = stateIsPlaying ? '❚❚' : '▶';
        mmPlay.setAttribute('aria-pressed', stateIsPlaying ? 'true' : 'false');
        mmPlay.classList.toggle('playing', !!stateIsPlaying); // CSS listens to .playing
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

      updateMobileButton(isPlaying && !audio.paused);
      updateTitleUI();
    }

    function applyVolume() {
      audio.volume = currentVolume;
      audio.muted = !!isMuted;
      updateButtons();
    }

    // Controls
    btnPlay.addEventListener('click', () => {
      userInteracted = true;
      if (!audio.src) setTrack(currentIndex, false);
      audio.play().then(() => {
        isPlaying = true;
        updateButtons();
        persist();
      }).catch(()=>{ /* ignore play errors */ });
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

    btnMute.addEventListener('click', () => {
      isMuted = !isMuted;
      applyVolume();
      persist();
    });

    volSlider.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) {
        currentVolume = Math.min(1, Math.max(0, v));
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

    // Persist periodically while playing
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
      // When metadata loads, if we expected to be playing and user already interacted, try to play
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

    // setTrack MUST be exposed so mobile UI or other code can request a track
    function setTrack(index, autoPlay = false) {
      index = (index + playlist.length) % playlist.length;
      currentIndex = index;
      const filename = playlist[currentIndex];
      audio.src = srcFor(filename);
      try { titleEl.textContent = filename; } catch (e) {}
      audio.addEventListener('loadedmetadata', () => {
        applyVolume();
      }, { once: true });
      // autoPlay only if we have a user gesture (helps avoid mobile autoplay blocks)
      if (autoPlay && userInteracted) {
        audio.play().catch(()=>{});
      }
      updateButtons();
      persist();
    }

    // convenience toggle for external callers
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

    // Expose public API
    const API = {
      el: dom,
      audio,
      play: () => btnPlay.click(),
      pause: () => btnPause.click(),
      next: () => btnNext.click(),
      back: () => btnBack.click(),
      setVolume: (v) => { currentVolume = Math.min(1, Math.max(0, v)); applyVolume(); persist(); },
      toggleMute: () => { isMuted = !isMuted; applyVolume(); persist(); },
      getState: () => ({ index: currentIndex, isPlaying, currentTime: audio.currentTime || 0, volume: currentVolume, muted: isMuted }),
      toggle: _togglePlay,
      _updateButtons: updateButtons,
      _updateTitleUI: updateTitleUI,
      setTrack // expose setTrack
    };

    // init first track (don't autoplay)
    setTrack(currentIndex, false);

    // If saved playing state was true AND the user has interacted earlier in the session,
    // attempt to resume playback (many mobile browsers block autoplay without user gesture)
    if (isPlaying && userInteracted) {
      audio.play().catch(()=>{});
    }

    return API;
  }

  // Initialize player and expose globally
  try {
    window.__SHALTZ_PLAYER = Player();
    if (!window.ShaltzPlayer) window.ShaltzPlayer = window.__SHALTZ_PLAYER;
    document.dispatchEvent(new CustomEvent('sh:player-ready', { detail: { player: window.__SHALTZ_PLAYER } }));
  } catch (e) {
    console.warn('Player initialization failed', e);
  }

  /**
   * MOBILE SYNC & WIRING
   *
   * - Ensure the floating mm-play button controls the central player when available.
   * - If central player isn't present, fallback to a native #mobileAudio element if present.
   * - Keep UI in sync (button glyph + .playing class + panel title).
   * - Defensive: re-bind after PJAX and when DOM changes.
   */
  function wireMobileUI() {
    try {
      const mm = document.getElementById('mm-play'); // floating circle button
      // prefer panel title; mobile-music-bar mm-title is legacy
      const panelTitle = document.querySelector('.mobile-player-panel .mp-title');
      const mmTitleLegacy = document.querySelector('.mobile-music-bar .mm-title');
      const mpPanel = document.getElementById('mobilePlayerPanel');
      const mpClose = document.getElementById('mpClose');
      const mobileAudioEl = document.getElementById('mobileAudio'); // fallback native audio in markup

      // if nothing mobile exists, nothing to do
      if (!mm && !mpPanel && !mobileAudioEl) return;

      const player = window.__SHALTZ_PLAYER;
      const useCentral = !!player && !!player.audio;

      // small helper to stop any other audio to avoid double playback
      function silenceOtherAudio() {
        try {
          if (mobileAudioEl && !mobileAudioEl.paused) {
            mobileAudioEl.pause();
          }
        } catch (e) {}
      }

      // Sync visual state from whichever audio source is used
      function syncUI() {
        try {
          if (useCentral) {
            const st = player.getState();
            const trackName = playlist[st.index] || '';
            if (panelTitle) panelTitle.textContent = trackName;
            if (mmTitleLegacy) mmTitleLegacy.textContent = trackName;
            if (mm) {
              mm.textContent = st.isPlaying ? '❚❚' : '▶';
              mm.setAttribute('aria-pressed', st.isPlaying ? 'true' : 'false');
              mm.classList.toggle('playing', !!st.isPlaying);
            }
          } else {
            // fallback to native mobile audio element
            if (mobileAudioEl) {
              const s = mobileAudioEl.querySelector('source') ? mobileAudioEl.querySelector('source').src : mobileAudioEl.src;
              const name = s ? s.split('/').pop() : 'Music';
              if (panelTitle) panelTitle.textContent = name;
              if (mmTitleLegacy) mmTitleLegacy.textContent = name;
              if (mm) {
                mm.textContent = !mobileAudioEl.paused ? '❚❚' : '▶';
                mm.setAttribute('aria-pressed', !mobileAudioEl.paused ? 'true' : 'false');
                mm.classList.toggle('playing', !mobileAudioEl.paused);
              }
            }
          }
        } catch (e) { /* ignore sync errors */ }
      }

      // mm click handler: opens panel and toggles playback
      if (mm && !mm.dataset.__shWire) {
        mm.dataset.__shWire = '1';
        mm.addEventListener('click', (ev) => {
          ev.preventDefault();

          if (mpPanel) {
            const isOpen = mpPanel.classList.contains('open');
            if (!isOpen) {
              mpPanel.classList.add('open');
              mpPanel.setAttribute('aria-hidden', 'false');

              // open and attempt to play central player (preferred)
              if (useCentral) {
                silenceOtherAudio();
                // try to play central player via its toggle
                try {
                  // If central player exists and supports toggle
                  if (player && typeof player.toggle === 'function') {
                    // If currently paused, toggle() will play; if playing, toggle() will pause - but here user just opened panel,
                    // so we normally want to start playing if not already playing.
                    // We'll request play directly for reliability (user gesture present).
                    player.audio && player.audio.src ? player.audio.play().catch(()=>{}) : (player.setTrack && player.setTrack(0, false), player.audio && player.audio.play && player.audio.play().catch(()=>{}));
                  } else {
                    // fallback: click play button in player DOM if present
                    try { document.querySelector('#' + PLAYER_ID + ' .sh-play').click(); } catch (e) {}
                  }
                } catch (e) {}
              } else {
                // fallback: play native mobile audio element if present
                if (mobileAudioEl) {
                  try {
                    silenceOtherAudio();
                    mobileAudioEl.load();
                    mobileAudioEl.play().catch(()=>{});
                  } catch (e) {}
                } else {
                  // last resort: navigate to Spotify or an external player
                  window.open('https://open.spotify.com/user/shalvin.rautela', '_blank', 'noopener');
                }
              }
            } else {
              // panel was open — close it and pause audio
              mpPanel.classList.remove('open');
              mpPanel.setAttribute('aria-hidden', 'true');

              if (useCentral && player && typeof player.pause === 'function') {
                try { player.pause(); } catch (e) {}
              } else if (mobileAudioEl && !mobileAudioEl.paused) {
                try { mobileAudioEl.pause(); } catch (e) {}
              }
            }
          } else {
            // no panel markup — toggle central or fallback
            if (useCentral && player && typeof player.toggle === 'function') {
              try { player.toggle(); } catch (e) {}
            } else if (mobileAudioEl) {
              try {
                if (mobileAudioEl.paused) {
                  mobileAudioEl.play().catch(()=>{});
                } else {
                  mobileAudioEl.pause();
                }
              } catch (e) {}
            } else {
              window.open('https://open.spotify.com/user/shalvin.rautela', '_blank', 'noopener');
            }
          }

          // update UI slightly after user gesture
          setTimeout(syncUI, 160);
        });
      }

      // close button inside panel
      if (mpClose && !mpClose.dataset.__shWire) {
        mpClose.dataset.__shWire = '1';
        mpClose.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (mpPanel) {
            mpPanel.classList.remove('open');
            mpPanel.setAttribute('aria-hidden', 'true');
          }
          if (useCentral && player && typeof player.pause === 'function') {
            try { player.pause(); } catch (e) {}
          } else if (mobileAudioEl) {
            try { mobileAudioEl.pause(); } catch (e) {}
          }
          setTimeout(syncUI, 80);
        });
      }

      // keep mobile UI in sync with central player events
      if (useCentral) {
        try {
          const audioEl = player.audio;
          if (audioEl && !audioEl._shaltz_monkeypatched) {
            audioEl._shaltz_monkeypatched = true;
            audioEl.addEventListener('play', syncUI);
            audioEl.addEventListener('pause', syncUI);
            audioEl.addEventListener('loadedmetadata', syncUI);
            audioEl.addEventListener('ended', syncUI);
            audioEl.addEventListener('timeupdate', syncUI);
            // initial sync
            setTimeout(syncUI, 40);
          }
        } catch (e) { /* ignore */ }
      } else {
        // fallback: wire native mobileAudio events
        if (mobileAudioEl && !mobileAudioEl._shaltz_monkeypatched) {
          mobileAudioEl._shaltz_monkeypatched = true;
          mobileAudioEl.addEventListener('play', syncUI);
          mobileAudioEl.addEventListener('pause', syncUI);
          mobileAudioEl.addEventListener('loadedmetadata', syncUI);
          mobileAudioEl.addEventListener('ended', syncUI);
          setTimeout(syncUI, 40);
        }
      }

      // expose a convenient global toggle for other code (defensive)
      window.ShaltzMobileToggle = function () {
        try {
          if (useCentral && window.ShaltzPlayer && typeof window.ShaltzPlayer.toggle === 'function') {
            window.ShaltzPlayer.toggle();
          } else if (mobileAudioEl) {
            if (mobileAudioEl.paused) mobileAudioEl.play().catch(()=>{}); else mobileAudioEl.pause();
          }
          setTimeout(syncUI, 120);
        } catch (e) {}
      };

      // ensure panel is closed when switching to desktop sizes to avoid leftover UI
      const mq = window.matchMedia && window.matchMedia('(min-width: 769px)');
      function closePanelOnDesktop() {
        if (mq && mq.matches && mpPanel && mpPanel.classList.contains('open')) {
          mpPanel.classList.remove('open');
          mpPanel.setAttribute('aria-hidden', 'true');
          if (useCentral && player && typeof player.pause === 'function') {
            try { player.pause(); } catch (e) {}
          } else if (mobileAudioEl) {
            try { mobileAudioEl.pause(); } catch (e) {}
          }
        }
      }
      if (mq) {
        try {
          mq.addListener && mq.addListener(closePanelOnDesktop);
        } catch (e) {}
        window.addEventListener('resize', debounce(closePanelOnDesktop, 140));
      }

    } catch (e) {
      console.warn('mobile UI wire failed', e);
    }
  }

  // Initialization wiring (run on DOM ready and after PJAX)
  function initMobileWire() {
    try { wireMobileUI(); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileWire);
  } else {
    initMobileWire();
  }

  ['pjax:loaded', 'pjax:complete', 'pjax:end', 'DOMContentLoaded'].forEach(ev => {
    document.addEventListener(ev, initMobileWire);
  });

  // tiny debounce helper
  function debounce(fn, ms) {
    let t = null;
    return function () {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, arguments), ms);
    };
  }

})();
