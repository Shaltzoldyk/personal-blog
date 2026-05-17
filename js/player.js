/* player.js — Shaltz audio player */

(function () {
  const STORAGE_KEY = 'shaltz_player_state_v1';
  const PLAYER_ID   = 'shaltz-audio-player';

  const playlist = ['Jump.mp3', 'Long Time.mp3', 'Miss The Rage.mp3'];
  const srcFor = (f) => 'https://pub-<your-hash>.r2.dev/' + f;

  /* ── persistence ── */
  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
  }
  function save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  }

  /* ── build DOM once ── */
  function buildDOM() {
    if (document.getElementById(PLAYER_ID)) return document.getElementById(PLAYER_ID);

    const el = document.createElement('div');
    el.id = PLAYER_ID;
    el.setAttribute('aria-label', 'Audio player');
    el.innerHTML = `
      <div class="sh-track-title" aria-live="polite"></div>
      <div class="sh-controls" role="toolbar" aria-label="Player controls">
        <button class="sh-btn sh-back"  aria-label="Previous">◀◀</button>
        <button class="sh-btn sh-play"  aria-label="Play">▶</button>
        <button class="sh-btn sh-pause hidden" aria-label="Pause">❚❚</button>
        <button class="sh-btn sh-next"  aria-label="Next">▶▶</button>
        <button class="sh-btn sh-mute"  aria-label="Mute">🔈</button>
        <input class="sh-volume" type="range" min="0" max="1" step="0.01" value="0.8" aria-label="Volume">
      </div>
      <audio class="sh-audio" preload="metadata"></audio>
    `;

    const styleId = 'sh-player-styles';
    if (!document.getElementById(styleId)) {
      const s = document.createElement('style');
      s.id = styleId;
      s.textContent = `
        #${PLAYER_ID}{position:fixed;right:18px;bottom:18px;z-index:99999;width:260px;
          font-family:'Courier New',monospace;background:linear-gradient(180deg,#050505,#0a0a0a);
          border:2px solid rgba(182,255,0,.95);color:#b6ff00;padding:8px;border-radius:6px;
          box-shadow:0 6px 12px rgba(0,0,0,.6);user-select:none}
        #${PLAYER_ID} .sh-track-title{font-weight:700;margin-bottom:6px;font-size:13px}
        #${PLAYER_ID} .sh-controls{display:flex;gap:6px;align-items:center;justify-content:center}
        #${PLAYER_ID} .sh-btn{background:transparent;border:1px solid rgba(182,255,0,.12);
          color:#b6ff00;padding:4px 6px;cursor:pointer;font-family:monospace;border-radius:3px}
        #${PLAYER_ID} .sh-volume{width:80px}
        #${PLAYER_ID} .sh-btn.hidden{display:none}
      `;
      document.head.appendChild(s);
    }

    document.body.appendChild(el);
    return el;
  }

  /* ── player ── */
  function init() {
    const dom      = buildDOM();
    const audio    = dom.querySelector('.sh-audio');
    const titleEl  = dom.querySelector('.sh-track-title');
    const btnPlay  = dom.querySelector('.sh-play');
    const btnPause = dom.querySelector('.sh-pause');
    const btnNext  = dom.querySelector('.sh-next');
    const btnBack  = dom.querySelector('.sh-back');
    const btnMute  = dom.querySelector('.sh-mute');
    const vol      = dom.querySelector('.sh-volume');

    let idx = 0, playing = false, muted = false, volume = 0.8, interacted = false;

    const saved = load();
    if (saved) {
      idx     = Math.min(Math.max(0, saved.index  ?? 0), playlist.length - 1);
      volume  = Math.min(1, Math.max(0, saved.volume ?? 0.8));
      muted   = !!saved.muted;
      playing = !!saved.isPlaying;
      if (saved.currentTime > 0) {
        audio.addEventListener('loadedmetadata', () => {
          try { audio.currentTime = Math.min(saved.currentTime, audio.duration); } catch {}
        }, { once: true });
      }
    }

    function persist() {
      save({ index: idx, currentTime: audio.currentTime || 0, isPlaying: playing, volume, muted });
    }

    function syncUI() {
      const active = playing && !audio.paused;
      btnPlay.classList.toggle('hidden',  active);
      btnPause.classList.toggle('hidden', !active);
      btnMute.textContent = (muted || audio.muted) ? '🔇' : volume > 0.6 ? '🔊' : volume > 0.2 ? '🔉' : '🔈';
      vol.value = volume.toFixed(2);
      titleEl.textContent = playlist[idx] || '';
    }

    function applyVolume() {
      audio.volume = volume;
      audio.muted  = muted;
      syncUI();
    }

    function setTrack(i, autoplay = false) {
      idx = (i + playlist.length) % playlist.length;
      audio.src = srcFor(playlist[idx]);
      audio.addEventListener('loadedmetadata', applyVolume, { once: true });
      if (autoplay && interacted) audio.play().catch(() => {});
      syncUI();
      persist();
    }

    /* controls */
    btnPlay.addEventListener('click', () => {
      interacted = true;
      if (!audio.src) setTrack(idx, false);
      audio.play().then(() => { playing = true; syncUI(); persist(); }).catch(() => {});
    });
    btnPause.addEventListener('click', () => {
      audio.pause(); playing = false; syncUI(); persist();
    });
    btnNext.addEventListener('click', () => { setTrack(idx + 1, true); playing = true; syncUI(); persist(); });
    btnBack.addEventListener('click', () => { setTrack(idx - 1, true); playing = true; syncUI(); persist(); });
    btnMute.addEventListener('click', () => { muted = !muted; applyVolume(); persist(); });
    vol.addEventListener('input', (e) => {
      volume = Math.min(1, Math.max(0, parseFloat(e.target.value)));
      if (volume > 0) muted = false;
      applyVolume(); persist();
    });

    audio.addEventListener('ended',  () => { setTrack(idx + 1, true); playing = true; syncUI(); persist(); });
    audio.addEventListener('play',   () => { playing = true;  syncUI(); });
    audio.addEventListener('pause',  () => { playing = false; syncUI(); persist(); });
    dom.addEventListener('pointerdown', () => { interacted = true; });

    /* keyboard */
    dom.addEventListener('keydown', (e) => {
      if (e.key === ' ') { e.preventDefault(); audio.paused ? btnPlay.click() : btnPause.click(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); volume = Math.min(1, volume + 0.05); if (volume > 0) muted = false; applyVolume(); persist(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); volume = Math.max(0, volume - 0.05); if (!volume) muted = true;  applyVolume(); persist(); }
    });

    /* periodic save while playing */
    setInterval(() => { if (!audio.paused) persist(); }, 2000);

    applyVolume();
    setTrack(idx, false);
    if (playing && interacted) audio.play().catch(() => {});

    window.__SHALTZ_PLAYER = {
      audio, play: () => btnPlay.click(), pause: () => btnPause.click(),
      next: () => btnNext.click(), back: () => btnBack.click(),
      setTrack, toggle() { audio.paused ? btnPlay.click() : btnPause.click(); },
      getState: () => ({ index: idx, isPlaying: playing, volume, muted })
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
