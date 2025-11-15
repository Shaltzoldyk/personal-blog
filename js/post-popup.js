/**
 * post-popup.js
 *  - Intercepts clicks on internal post links and opens them in a large overlay popup.
 *  - Uses fetch to retrieve the post HTML, extracts a sensible content container,
 *    injects into the popup, and pushes state via history.pushState().
 *  - Respects modifier keys and target="_blank" (won't intercept those).
 *
 * Updated behavior:
 *  - Avoids calling history.back() when closing the popup to prevent PJAX/popstate races.
 *  - Restores the previous URL/state using history.replaceState() (no popstate event).
 *  - Saves the previous history state before opening so it can be restored cleanly.
 *  - Integrates with page dim overlay (#page-dim-overlay) if present:
 *      * Shows overlay when popup opens and hides when it closes.
 *      * Clicking the overlay will close the popup (mirrors typical modal behavior).
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

  /* ---------------------------
     Overlay helper functions
     - These toggle the #page-dim-overlay element if present.
     - Uses the same "hidden" + "visible" class pattern as styles.css/index.html
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
    // Ensure transition runs (add visible on next frame)
    requestAnimationFrame(() => overlay.classList.add('visible'));
    overlay.setAttribute('aria-hidden', 'false');
  }

  function hideOverlay() {
    const overlay = getOverlay();
    if (!overlay) return;
    overlay.classList.remove('visible');
    // wait for transition, then hide completely
    const t = setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      clearTimeout(t);
    }, 240);
  }

  /* ---------------------------
     Popup DOM creation & utilities
     --------------------------- */
  function createPopupDOM() {
    let popup = document.getElementById(POPUP_ID);
    if (popup) return popup;

    popup = document.createElement('div');
    popup.id = POPUP_ID;
    popup.className = 'hidden';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-hidden', 'true');
    popup.setAttribute('aria-modal', 'true');
    popup.innerHTML = `
      <div class="sh-popup-backdrop" data-popup-close></div>
      <div class="sh-popup-window" role="document" tabindex="-1">
        <div class="sh-popup-topbar">
          <button class="sh-popup-close" aria-label="Close post" type="button">×</button>
        </div>
        <div class="sh-popup-body"></div>
      </div>
    `;

    // Minimal inline CSS only if it's not already present (keeps visual even without styles.css)
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

    // Append to body (outside #main-content so PJAX won't remove it)
    document.body.appendChild(popup);

    // If overlay exists, wire it to close the popup when clicked (mirror modal behavior).
    // This is defensive: other scripts may also bind overlay; this handler is idempotent.
    const overlay = getOverlay();
    if (overlay && !overlay.dataset.__shOverlayBound) {
      overlay.dataset.__shOverlayBound = '1';
      overlay.addEventListener('click', () => {
        // Attempt to close the popup in the same way close handlers do
        closePopup(true);
      });
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
    // explicit target blank -> let browser handle
    if (a.target && a.target.toLowerCase() === '_blank') return false;
    // explicit download attribute -> let browser handle
    if (a.hasAttribute('download')) return false;
    // explicit external rel -> don't intercept
    if (String(a.rel || '').toLowerCase().split(/\s+/).includes('external')) return false;
    if (!isSameOrigin(a.href)) return false;

    // If the author explicitly opts out with data-no-popup or class 'no-popup', don't intercept
    if (a.hasAttribute('data-no-popup') || a.classList.contains('no-popup')) return false;

    // If link has explicit class 'post-link', treat it as intended for popup
    if (a.classList.contains('post-link')) return true;

    // Otherwise, check path heuristics
    try {
      const u = new URL(a.href, location.href);
      const path = u.pathname || '';
      if (path.includes('/posts/') || path.endsWith('.html')) return true;
    } catch (e) {
      // ignore
    }
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
    // fallback to body clone
    return doc.body.cloneNode(true);
  }

  /* ---------------------------
     Show / close logic
     - Integrates overlay toggling for improved readability.
     --------------------------- */
  function showPopupWithContent(htmlNode, url) {
    const popup = createPopupDOM();
    const bodyEl = popup.querySelector('.sh-popup-body');

    // store previously focused element to restore focus on close
    try { _lastActiveElement = document.activeElement; } catch (e) { _lastActiveElement = null; }

    bodyEl.innerHTML = '';
    // move node into popup (clone to avoid removing from source doc if necessary)
    const toInsert = htmlNode.cloneNode(true);
    // remove scripts from inserted content for safety
    toInsert.querySelectorAll && toInsert.querySelectorAll('script').forEach(s => s.remove());
    bodyEl.appendChild(toInsert);

    popup.classList.remove('hidden');
    popup.setAttribute('aria-hidden', 'false');

    // also show the global page-dim overlay if present
    showOverlay();

    // focus management: focus the window for screen readers
    const win = popup.querySelector('.sh-popup-window');
    try { win.focus(); } catch (e) {}

    // Save the previous URL and state BEFORE pushing the popup state.
    try {
      _previousURL = location.href;
      _previousState = history.state;
    } catch (e) {
      _previousURL = null;
      _previousState = null;
    }

    // push history state so back button closes popup
    try {
      history.pushState({ sh_post_popup: true }, '', url);
    } catch (e) {
      // ignore on older browsers or if blocked
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

    // hide overlay as we close
    hideOverlay();

    // restore focus
    try {
      if (_lastActiveElement && typeof _lastActiveElement.focus === 'function') {
        _lastActiveElement.focus();
      } else {
        // fallback focus to body
        document.body.focus && document.body.focus();
      }
    } catch (e) { /* ignore */ }
    _lastActiveElement = null;

    // If requested, restore previous URL/state WITHOUT triggering popstate.
    if (useHistoryRestore === true) {
      try {
        if (_previousURL !== null) {
          // Replace current history entry (post URL) with the previous one,
          // restoring the previous state object. This avoids firing popstate.
          history.replaceState(_previousState, '', _previousURL);
        } else {
          // if we don't have previous URL/state, fallback to a gentle no-op;
          // avoid calling history.back() to prevent PJAX/popstate races.
        }
      } catch (e) {
        console.warn('history.replaceState failed', e);
      } finally {
        // clear saved values
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

    // If it's not a left button click, allow default (middle-click opens new tab, right-click shows context menu)
    // ev.button: 0 = left, 1 = middle, 2 = right
    if (ev.button !== 0) return;

    // Respect modifier keys — if user used ctrl/cmd/shift/alt, let browser handle (open new tab/window)
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

    // find anchor
    let el = ev.target;
    while (el && el.nodeType === 1 && el.tagName !== 'A') el = el.parentElement;
    if (!el || el.tagName !== 'A') return;

    // if clicked inside the popup, ignore (let popup handlers manage)
    const popup = document.getElementById(POPUP_ID);
    if (popup && popup.contains(el)) return;

    if (!shouldInterceptLink(el)) return;

    ev.preventDefault();
    const href = el.href;

    // Show a loader quickly
    const created = createPopupDOM();
    const bodyEl = created.querySelector('.sh-popup-body');
    bodyEl.innerHTML = '<div style="padding:14px;font-family:Courier,monospace;">Loading…</div>';
    created.classList.remove('hidden');
    created.setAttribute('aria-hidden', 'false');

    // Also show overlay while loading to give immediate feedback
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

        // clone and sanitize (remove script tags)
        const clone = contentEl.cloneNode(true);
        clone.querySelectorAll && clone.querySelectorAll('script').forEach(s => s.remove());

        showPopupWithContent(clone, href);
        document.dispatchEvent(new CustomEvent('sh:popup-loaded', { detail: { url: href } }));
      })
      .catch(err => {
        console.warn('Post popup failed, falling back to navigation', err);
        // hide overlay (we showed it earlier)
        hideOverlay();
        // fallback to full navigation
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
    // ensure we only attach one global handler
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
        // restore history/state without triggering popstate handling in PJAX
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
          // hide overlay when popstate closes the popup
          hideOverlay();
          document.dispatchEvent(new CustomEvent('sh:popup-close'));
          // restore focus when closing via popstate
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
        // Optionally re-open or keep open — no-op
      }
    });
  }

  // Public init
  function init() {
    if (_inited) return;
    createPopupDOM();
    initLinkHandlers();
    initPopupCloseHandlers();

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

  // Also listen for a PJAX/replace event to ensure the popup DOM exists and handlers are still in place.
  // Common custom events: 'pjax:complete', 'pjax:load', but we'll listen generically for 'pjax:complete' and 'pjax:loaded'
  ['pjax:complete', 'pjax:loaded', 'pjax:end'].forEach(evName => {
    document.addEventListener(evName, () => {
      // ensure popup DOM exists after PJAX swap
      createPopupDOM();
      // handlers are delegated, so no need to rebind click listener
    });
  });

})();
