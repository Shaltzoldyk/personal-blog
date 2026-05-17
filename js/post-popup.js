/* post-popup.js — Shaltz post popup */

(function () {
  const POPUP_ID  = 'sh-post-popup';
  const OVERLAY_ID = 'page-dim-overlay';

  let prevURL = null, prevState = null, lastFocus = null;

  /* ── overlay ── */
  function overlay() { return document.getElementById(OVERLAY_ID); }
  function showOverlay() {
    const o = overlay(); if (!o) return;
    o.classList.remove('hidden');
    requestAnimationFrame(() => o.classList.add('visible'));
  }
  function hideOverlay() {
    const o = overlay(); if (!o) return;
    o.classList.remove('visible');
    setTimeout(() => o.classList.add('hidden'), 240);
  }

  /* ── popup DOM (built once, reused) ── */
  function getPopup() {
    let p = document.getElementById(POPUP_ID);
    if (p) return p;

    p = document.createElement('div');
    p.id = POPUP_ID;
    p.className = 'hidden';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-modal', 'true');
    p.setAttribute('aria-hidden', 'true');
    p.innerHTML = `
      <div class="sh-popup-backdrop" data-close></div>
      <div class="sh-popup-outer-frame">
        <div class="sh-popup-window" role="document" tabindex="-1">
          <div class="sh-popup-topbar">
            <button class="sh-popup-close" aria-label="Close" type="button">×</button>
          </div>
          <div class="sh-popup-body"></div>
        </div>
      </div>
    `;
    document.body.appendChild(p);
    return p;
  }

  /* ── open / close ── */
  function open(contentNode, url) {
    const p    = getPopup();
    const body = p.querySelector('.sh-popup-body');
    lastFocus  = document.activeElement;

    const clone = contentNode.cloneNode(true);
    clone.querySelectorAll('script').forEach(s => s.remove());
    body.innerHTML = '';
    body.appendChild(clone);

    p.classList.remove('hidden');
    p.setAttribute('aria-hidden', 'false');
    showOverlay();
    p.querySelector('.sh-popup-window').focus();

    prevURL   = location.href;
    prevState = history.state;
    try { history.pushState({ sh_post_popup: true }, '', url); } catch {}
  }

  function close() {
    const p = document.getElementById(POPUP_ID);
    if (!p || p.classList.contains('hidden')) return;

    p.classList.add('hidden');
    p.setAttribute('aria-hidden', 'true');
    p.querySelector('.sh-popup-body').innerHTML = '';
    hideOverlay();

    try { lastFocus && lastFocus.focus(); } catch {}
    lastFocus = null;

    try {
      if (prevURL) history.replaceState(prevState, '', prevURL);
    } catch {}
    prevURL = prevState = null;
  }

  /* ── link interception ── */
  function isPostLink(a) {
    if (!a?.href) return false;
    if (a.target?.toLowerCase() === '_blank') return false;
    if (a.hasAttribute('download') || a.dataset.noPopup) return false;
    try {
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin) return false;
      return u.pathname.includes('/posts/') || u.pathname.endsWith('.html');
    } catch { return false; }
  }

  function extractContent(doc) {
    for (const sel of ['.post-container', '.blog-post', 'article', '#main-content', 'main']) {
      const el = doc.querySelector(sel);
      if (el) return el;
    }
    return doc.body;
  }

  /* ── init ── */
  function init() {
    const p = getPopup();

    /* close handlers */
    p.addEventListener('click', (e) => {
      if (e.target.matches('.sh-popup-close') || e.target.hasAttribute('data-close')) close();
    });
    overlay()?.addEventListener('click', close);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    window.addEventListener('popstate', (e) => {
      if (!e.state?.sh_post_popup) close();
    });

    /* intercept post clicks */
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;

      let a = e.target;
      while (a && a.tagName !== 'A') a = a.parentElement;
      if (!a || !isPostLink(a)) return;

      const popup = document.getElementById(POPUP_ID);
      if (popup?.contains(a)) return;

      e.preventDefault();

      /* show loading state */
      getPopup().querySelector('.sh-popup-body').innerHTML =
        '<div style="padding:14px;font-family:Courier,monospace">Loading…</div>';
      getPopup().classList.remove('hidden');
      getPopup().setAttribute('aria-hidden', 'false');
      showOverlay();

      fetch(a.href, { credentials: 'same-origin' })
        .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          open(extractContent(doc), a.href);
        })
        .catch(() => { hideOverlay(); location.href = a.href; });
    });

    window.__SHALTZ_POST_POPUP = { close };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
