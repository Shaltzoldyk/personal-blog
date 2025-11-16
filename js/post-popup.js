/**
 * post-popup.js
 *  - Intercepts clicks on internal post links and opens them in a large overlay popup.
 *  - Uses fetch to retrieve the post HTML, extracts a sensible content container,
 *    injects into the popup, and pushes state via history.pushState().
 *  - Respects modifier keys and target="_blank" (won't intercept those).
 *
 * Updated behavior (conservative + mobile enhancements):
 *  - Reuses existing #sh-post-popup container when present (non-destructive).
 *  - Adds mobile-only `.mobile-fullscreen` toggling via matchMedia.
 *  - Adds a lightweight swipe-down-to-close gesture when mobile-fullscreen is active.
 *  - Keeps history handling: pushState on open, replaceState on close (no popstate storms).
 *  - Integrates with page-dim-overlay if present.
 *
 * Include with:
 * <script src="js/post-popup.js" defer></script>
 */

(function () {
  const POPUP_ID = 'sh-post-popup';
  const STYLE_ID = 'sh-post-popup-inline-style';
  const OVERLAY_ID = 'page-dim-overlay';
  let _inited = false;
  let _clickHandler = null;
  let _lastActiveElement = null;

  // Saved history info so we can restore without triggering popstate
  let _previousURL = null;
  let _previousState = null;

  // Mobile swipe state
  let _touchStartY = null;
  let _touchCurrentY = null;
  let _touchStarted = false;
  let _swipeHandlerAttached = false;

  /* ---------------------------
     Overlay helper functions
     --------------------------- */
  function getOverlay() {
    try {
      return document.getElementById(OVERLAY_ID);
    } catch (e) {
      return null;
    }
  }

  function showOverlay() {
    const overlay = getOverlay();
    if (!overlay) return;
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => overlay.classList.add('visible'));
    overlay.setAttribute('aria-hidden', 'false');
  }

  function hideOverlay() {
    const overlay = getOverlay();
    if (!overlay) return;
    overlay.classList.remove('visible');
    const t = setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      clearTimeout(t);
    }, 240);
  }

  /* ---------------------------
     Popup DOM creation & utilities (conservative)
     - If an element with POPUP_ID exists in the page (e.g., your index.html),
       reuse it and *do not* overwrite its content. Only create elements that
       are missing to keep this non-destructive.
     --------------------------- */
  function createPopupDOM() {
    // If page already has the canonical popup node, reuse it.
    let popup = document.getElementById(POPUP_ID);
    if (popup) {
      // Ensure required structure exists inside the provided popup.
      // We expect: .sh-popup-backdrop (or an element to click on to close),
      // .sh-popup-window, .sh-popup-body, .sh-popup-close
      let backdrop = popup.querySelector('.sh-popup-backdrop');
      let win = popup.querySelector('.sh-popup-window');
      let body = popup.querySelector('.sh-popup-body');
      let closeBtn = popup.querySelector('.sh-popup-close');

      // If any piece is missing, create minimal ones without altering existing siblings.
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'sh-popup-backdrop';
        backdrop.setAttribute('data-popup-close', '');
        popup.insertBefore(backdrop, popup.firstChild);
      }
      if (!win) {
        win = document.createElement('div');
        win.className = 'sh-popup-window';
        win.setAttribute('role', 'document');
        win.tabIndex = -1;
        popup.appendChild(win);
      }
      if (!body) {
        body = document.createElement('div');
        body.className = 'sh-popup-body';
        win.appendChild(body);
      }
      if (!closeBtn) {
        const topbar = popup.querySelector('.sh-popup-topbar') || document.createElement('div');
        topbar.className = 'sh-popup-topbar';
        closeBtn = document.createElement('button');
        closeBtn.className = 'sh-popup-close';
        closeBtn.setAttribute('aria-label', 'Close post');
        closeBtn.type = 'button';
        closeBtn.innerHTML = '×';
        topbar.appendChild(closeBtn);
        // ensure topbar lives before the body
        if (!popup.querySelector('.sh-popup-topbar')) {
          popup.insertBefore(topbar, win);
        }
      }

      // Ensure essential attributes for accessibility
      popup.setAttribute('role', 'dialog');
      popup.setAttribute('aria-modal', 'true');
      if (!popup.hasAttribute('aria-hidden')) popup.setAttribute('aria-hidden', 'true');

      // Attach overlay click to close if overlay exists (idempotent; mark bound)
      const overlay = getOverlay();
      if (overlay && !overlay.dataset.__shOverlayBound) {
        overlay.dataset.__shOverlayBound = '1';
        overlay.addEventListener('click', () => closePopup(true));
      }

      return popup;
    }

    // If no existing popup element, create a self-contained popup that mirrors expected structure.
    popup = document.createElement('div');
    popup.id = POPUP_ID;
    popup.className = 'hidden';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-hidden', 'true');
    popup.setAttribute('aria-modal', 'true');

    popup.innerHTML = `
      <div class="sh-popup-backdrop" data-popup-close></div>
      <div class="sh-popup-outer-frame">
        <div class="sh-popup-window" role="document" tabindex="-1">
          <div class="sh-popup-topbar">
            <button class="sh-popup-close" aria-label="Close post" type="button">×</button>
          </div>
          <div class="sh-popup-body"></div>
        </div>
      </div>
    `;

    // Minimal inline CSS fallback only if not present in document (keeps appearance if CSS missing)
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = `
      #${POPUP_ID} { position: fixed; inset: 0; z-index: 99998; display:flex; align-items:center; justify-content:center; }
      #${POPUP_ID}.hidden { display:none; }
      #${POPUP_ID} .sh-popup-backdrop { position:absolute; inset:0; background: rgba(0,0,0,0.72); backdrop-filter: blur(2px); }
      #${POPUP_ID} .sh-popup-window { position:relative; width:min(92vw, 900px); max-height:90vh; overflow:auto; background:linear-gradient(180deg,#050505,#0b0b0b); border:2px solid rgba(0,255,102,0.9); box-shadow:0 8px 40px rgba(0,0,0,0.6); padding: 18px; border-radius:6px; color:#e6ffe6; }
      #${POPUP_ID} .sh-popup-topbar { display:flex; justify-content:flex-end; }
      #${POPUP_ID} .sh-popup-close { background:transparent; border:none; color:#00ff66; font-size:20px; cursor:pointer; }
      #${POPUP_ID} .sh-popup-body { margin-top:8px; color: #ffffff; }
      `;
      document.head.appendChild(s);
    }

    document.body.appendChild(popup);

    // If overlay exists, wire it to close the popup when clicked (defensive)
    const overlay = getOverlay();
    if (overlay && !overlay.dataset.__shOverlayBound) {
      overlay.dataset.__shOverlayBound = '1';
      overlay.addEventListener('click', () => closePopup(true));
    }

    return popup;
  }

  function isSameOrigin(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin;
    } catch (e) { return false; }
  }

  // Only intercept links that are clearly posts: either class "post-link", path contains '/posts/', or endsWith '.html'
  function shouldInterceptLink(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target.toLowerCase() === '_blank') return false;
    if (a.hasAttribute('download')) return false;
    if (String(a.rel || '').toLowerCase().split(/\s+/).includes('external')) return false;
    if (!isSameOrigin(a.href)) return false;
    if (a.hasAttribute('data-no-popup') || a.classList.contains('no-popup')) return false;
    if (a.classList.contains('post-link')) return true;
    try {
      const u = new URL(a.href, location.href);
      const path = u.pathname || '';
      if (path.includes('/posts/') || path.endsWith('.html')) return true;
    } catch (e) {}
    return false;
  }

  // Extract the main post content from fetched document
  function extractPostContent(doc) {
    const selectors = [
      '#main-content',
      '.post-container',
      '.blog-post',
      'article',
      '.post-article',
      '.post',
      '.entry-content',
      '#content'
    ];
    for (const s of selectors) {
      const el = doc.querySelector(s);
      if (el) return el;
    }
    return doc.body.cloneNode(true);
  }

  /* ---------------------------
     Mobile enhancements (conservative)
     - Toggle .mobile-fullscreen class on popup when viewport <= 768px.
     - Attach a simple swipe-to-close on the popup window when mobile-fullscreen is active.
     --------------------------- */
  const MQ = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 768px)') : null;

  function enableMobileFullscreenIfNeeded() {
    const popup = document.getElementById(POPUP_ID);
    if (!popup) return;
    if (MQ && MQ.matches) {
      popup.classList.add('mobile-fullscreen');
      maybeAttachSwipeHandler();
    } else {
      popup.classList.remove('mobile-fullscreen');
      maybeDetachSwipeHandler();
    }
  }

  function maybeAttachSwipeHandler() {
    if (_swipeHandlerAttached) return;
    const popup = document.getElementById(POPUP_ID);
    if (!popup) return;
    const win = popup.querySelector('.sh-popup-window');
    if (!win) return;

    function onTouchStart(e) {
      if (!MQ || !MQ.matches) return;
      if (e.touches && e.touches.length === 1) {
        _touchStarted = true;
        _touchStartY = e.touches[0].clientY;
        _touchCurrentY = _touchStartY;
      }
    }
    function onTouchMove(e) {
      if (!_touchStarted) return;
      if (e.touches && e.touches.length === 1) {
        _touchCurrentY = e.touches[0].clientY;
        const delta = _touchCurrentY - _touchStartY;
        // if dragging down, apply a gentle translate for feedback (non-destructive, removed on end)
        if (delta > 0 && delta < 300) {
          win.style.transform = `translateY(${delta}px)`;
          win.style.transition = 'transform 0s';
        }
      }
    }
    function onTouchEnd(e) {
      if (!_touchStarted) return;
      const delta = (_touchCurrentY || 0) - (_touchStartY || 0);
      // Reset transform
      win.style.transition = 'transform 180ms ease';
      win.style.transform = '';
      _touchStarted = false;
      _touchStartY = null;
      _touchCurrentY = null;
      // If swipe-down beyond threshold, close popup (mobile UX)
      if (delta > 120) {
        closePopup(true);
      }
    }

    // Attach handlers
    win.addEventListener('touchstart', onTouchStart, { passive: true });
    win.addEventListener('touchmove', onTouchMove, { passive: true });
    win.addEventListener('touchend', onTouchEnd, { passive: true });

    // Store so we can remove later
    win.__shaltz_swipe_handlers = { onTouchStart, onTouchMove, onTouchEnd };
    _swipeHandlerAttached = true;
  }

  function maybeDetachSwipeHandler() {
    if (!_swipeHandlerAttached) return;
    const popup = document.getElementById(POPUP_ID);
    if (!popup) return;
    const win = popup.querySelector('.sh-popup-window');
    if (!win || !win.__shaltz_swipe_handlers) return;
    const h = win.__shaltz_swipe_handlers;
    win.removeEventListener('touchstart', h.onTouchStart);
    win.removeEventListener('touchmove', h.onTouchMove);
    win.removeEventListener('touchend', h.onTouchEnd);
    delete win.__shaltz_swipe_handlers;
    _swipeHandlerAttached = false;
  }

  if (MQ && MQ.addListener) {
    // listen to viewport changes and toggle mobile fullscreen class accordingly
    MQ.addListener(enableMobileFullscreenIfNeeded);
  }

  /* ---------------------------
     Show / close logic
     --------------------------- */
  function showPopupWithContent(htmlNode, url) {
    const popup = createPopupDOM();
    const bodyEl = popup.querySelector('.sh-popup-body');

    try { _lastActiveElement = document.activeElement; } catch (e) { _lastActiveElement = null; }

    bodyEl.innerHTML = '';

    // clone and sanitize
    const toInsert = htmlNode.cloneNode(true);
    toInsert.querySelectorAll && toInsert.querySelectorAll('script').forEach(s => s.remove());
    bodyEl.appendChild(toInsert);

    // set visible
    popup.classList.remove('hidden');
    popup.setAttribute('aria-hidden', 'false');

    // show overlay
    showOverlay();

    // focus the window for screen readers
    const win = popup.querySelector('.sh-popup-window');
    try { win && win.focus(); } catch (e) {}

    // Mobile fullscreen toggling (if MQ matches)
    enableMobileFullscreenIfNeeded();

    // Save previous URL/state BEFORE pushing
    try {
      _previousURL = location.href;
      _previousState = history.state;
    } catch (e) {
      _previousURL = null;
      _previousState = null;
    }

    // push history state
    try {
      history.pushState({ sh_post_popup: true }, '', url);
    } catch (e) {
      console.warn('history.pushState failed', e);
    }

    document.dispatchEvent(new CustomEvent('sh:popup-open', { detail: { url } }));
  }

  function closePopup(useHistoryRestore) {
    const popup = document.getElementById(POPUP_ID);
    if (!popup) return;
    popup.classList.add('hidden');
    popup.setAttribute('aria-hidden', 'true');

    const bodyEl = popup.querySelector('.sh-popup-body');
    if (bodyEl) bodyEl.innerHTML = '';

    // hide overlay
    hideOverlay();

    // detach swipe handlers if any (defensive)
    maybeDetachSwipeHandler();

    // restore focus
    try {
      if (_lastActiveElement && typeof _lastActiveElement.focus === 'function') {
        _lastActiveElement.focus();
      } else {
        document.body.focus && document.body.focus();
      }
    } catch (e) {}
    _lastActiveElement = null;

    // restore history/state without triggering popstate
    if (useHistoryRestore === true) {
      try {
        if (_previousURL !== null) {
          history.replaceState(_previousState, '', _previousURL);
        } else {
          // nothing to do
        }
      } catch (e) {
        console.warn('history.replaceState failed', e);
      } finally {
        _previousURL = null;
        _previousState = null;
      }
    }

    document.dispatchEvent(new CustomEvent('sh:popup-close'));
  }

  /* ---------------------------
     Delegated click handler for document-level interception
     --------------------------- */
  function _documentClickHandler(ev) {
    if (ev.defaultPrevented) return;

    if (ev.button !== 0) return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

    // find anchor
    let el = ev.target;
    while (el && el.nodeType === 1 && el.tagName !== 'A') el = el.parentElement;
    if (!el || el.tagName !== 'A') return;

    // don't intercept clicks that originate from inside open popup
    const popup = document.getElementById(POPUP_ID);
    if (popup && popup.contains(el)) return;

    if (!shouldInterceptLink(el)) return;

    ev.preventDefault();
    const href = el.href;

    // Show a loader quickly in the existing popup (or created one)
    const created = createPopupDOM();
    const bodyEl = created.querySelector('.sh-popup-body');
    bodyEl.innerHTML = '<div style="padding:14px;font-family:Courier,monospace;">Loading…</div>';
    created.classList.remove('hidden');
    created.setAttribute('aria-hidden', 'false');

    // show overlay while loading
    showOverlay();

    // Fetch and extract content
    fetch(href, { method: 'GET', credentials: 'same-origin' })
      .then(res => {
        if (!res.ok) throw new Error('fetch-fail');
        return res.text();
      })
      .then(text => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        const contentEl = extractPostContent(doc);
        if (!contentEl) throw new Error('no-content');

        const clone = contentEl.cloneNode(true);
        clone.querySelectorAll && clone.querySelectorAll('script').forEach(s => s.remove());

        showPopupWithContent(clone, href);
        document.dispatchEvent(new CustomEvent('sh:popup-loaded', { detail: { url: href } }));
      })
      .catch(err => {
        console.warn('Post popup failed, falling back to navigation', err);
        hideOverlay();
        try {
          window.location.href = href;
        } catch (e) {
          console.error('Navigation fallback failed', e);
        }
      });
  }

  /* ---------------------------
     Handlers initialization
     --------------------------- */
  function initLinkHandlers() {
    if (_inited && _clickHandler) return;
    _clickHandler = _documentClickHandler;
    document.addEventListener('click', _clickHandler);
  }

  function initPopupCloseHandlers() {
    const popup = createPopupDOM();

    // close on close-button or backdrop
    popup.addEventListener('click', (ev) => {
      const target = ev.target;
      if (!target) return;
      // matches close button or backdrop attribute
      if (target.matches('.sh-popup-close') || target.hasAttribute('data-popup-close') || target.closest('.sh-popup-backdrop')) {
        ev.preventDefault();
        closePopup(true);
      }
    });

    // ESC to close
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        const p = document.getElementById(POPUP_ID);
        if (p && !p.classList.contains('hidden')) {
          closePopup(true);
        }
      }
    });

    // popstate: if state does not indicate the popup, close it
    window.addEventListener('popstate', (ev) => {
      const state = ev.state || {};
      const p = document.getElementById(POPUP_ID);
      if (!state.sh_post_popup) {
        if (p && !p.classList.contains('hidden')) {
          // close without changing history (we're reacting to popstate)
          p.classList.add('hidden');
          p.setAttribute('aria-hidden', 'true');
          const bodyEl = p.querySelector('.sh-popup-body');
          if (bodyEl) bodyEl.innerHTML = '';
          hideOverlay();
          document.dispatchEvent(new CustomEvent('sh:popup-close'));
          try {
            if (_lastActiveElement && typeof _lastActiveElement.focus === 'function') {
              _lastActiveElement.focus();
            } else {
              document.body.focus && document.body.focus();
            }
          } catch (e) {}
          _lastActiveElement = null;
        }
      } else {
        // state indicates popup — no action (we already handle opening)
      }
    });
  }

  // Public init
  function init() {
    if (_inited) return;
    createPopupDOM();
    initLinkHandlers();
    initPopupCloseHandlers();

    // Trigger initial mobile class state
    enableMobileFullscreenIfNeeded();

    // small API for other scripts
    window.__SHALTZ_POST_POPUP = {
      openWithHTMLNode: (node, url) => showPopupWithContent(node, url),
      close: () => closePopup(true)
    };

    _inited = true;
    document.dispatchEvent(new CustomEvent('sh:post-popup-ready'));
  }

  // initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Ensure popup DOM exists and handlers are in place after PJAX swaps
  ['pjax:complete', 'pjax:loaded', 'pjax:end'].forEach(evName => {
    document.addEventListener(evName, () => {
      createPopupDOM();
      // re-apply mobile class if needed (in case viewport didn't change)
      enableMobileFullscreenIfNeeded();
    });
  });

})();
