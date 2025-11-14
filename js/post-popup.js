/**
 * post-popup.js
 *  - Intercepts clicks on internal post links and opens them in a large overlay popup.
 *  - Uses fetch to retrieve the post HTML, extracts a sensible content container,
 *    injects into the popup, and pushes state via history.pushState().
 *  - Respects modifier keys and target="_blank" (won't intercept those).
 *
 * Include with:
 * <script src="post-popup.js" defer></script>
 */

(function () {
  const POPUP_ID = 'sh-post-popup';

  function createPopupDOM() {
    let popup = document.getElementById(POPUP_ID);
    if (popup) return popup;

    popup = document.createElement('div');
    popup.id = POPUP_ID;
    popup.className = 'sh-post-popup hidden';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-hidden', 'true');
    popup.innerHTML = `
      <div class="sh-popup-backdrop" data-popup-close></div>
      <div class="sh-popup-window" role="document" tabindex="-1">
        <div class="sh-popup-topbar">
          <button class="sh-popup-close" aria-label="Close post">×</button>
        </div>
        <div class="sh-popup-body"></div>
      </div>
    `;
    // Minimal styling to make it usable immediately
    const styleId = 'sh-post-popup-inline-style';
    if (!document.getElementById(styleId)) {
      const s = document.createElement('style');
      s.id = styleId;
      s.textContent = `
      #${POPUP_ID} { position: fixed; inset: 0; z-index: 99998; display:flex; align-items:center; justify-content:center; }
      #${POPUP_ID}.hidden { display:none; }
      #${POPUP_ID} .sh-popup-backdrop { position:absolute; inset:0; background: rgba(0,0,0,0.6); backdrop-filter: blur(2px); }
      #${POPUP_ID} .sh-popup-window { position:relative; width:min(92vw, 900px); max-height:90vh; overflow:auto; background:linear-gradient(180deg,#050505,#0b0b0b); border:2px solid rgba(0,255,102,0.9); box-shadow:0 8px 40px rgba(0,0,0,0.6); padding: 18px; border-radius:6px; color:#e6ffe6; }
      #${POPUP_ID} .sh-popup-topbar { display:flex; justify-content:flex-end; }
      #${POPUP_ID} .sh-popup-close { background:transparent; border:none; color:#00ff66; font-size:20px; cursor:pointer; }
      #${POPUP_ID} .sh-popup-body { margin-top:8px; }
      `;
      document.head.appendChild(s);
    }

    document.body.appendChild(popup);
    return popup;
  }

  function isSameOrigin(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin;
    } catch (e) { return false; }
  }

  function shouldInterceptLink(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target.toLowerCase() === '_blank') return false;
    // If modifier keys used, don't intercept (let user open in new tab)
    // (event handler will check modifiers, but extra safety here)
    // Intercept only same-origin and likely post URLs: either contain "/posts/" or endWith ".html"
    if (!isSameOrigin(a.href)) return false;
    const u = new URL(a.href, location.href);
    const path = u.pathname;
    if (path.includes('/posts/') || path.endsWith('.html')) return true;
    return false;
  }

  // Extract the main post content from fetched document
  function extractPostContent(doc) {
    // Prioritize common selectors
    const selectors = [
      '#main-content',
      '.post-container',
      '.blog-post',
      'article',
      '.post-article',
      '.post'
    ];
    for (const s of selectors) {
      const el = doc.querySelector(s);
      if (el) return el;
    }
    // Fallback: return body content
    return doc.body.cloneNode(true);
  }

  function showPopupWithContent(htmlContent, url) {
    const popup = createPopupDOM();
    const body = popup.querySelector('.sh-popup-body');
    body.innerHTML = ''; // clear
    body.appendChild(htmlContent);

    // aria + visible
    popup.classList.remove('hidden');
    popup.setAttribute('aria-hidden', 'false');

    // focus management
    const win = popup.querySelector('.sh-popup-window');
    win.focus();

    // pushState so URL reflects opened post
    try {
      history.pushState({ sh_post_popup: true }, '', url);
    } catch (e) {}

    // dispatch event
    document.dispatchEvent(new CustomEvent('sh:popup-open', { detail: { url } }));
  }

  function closePopup(replaceUrl) {
    const popup = document.getElementById(POPUP_ID);
    if (!popup) return;
    popup.classList.add('hidden');
    popup.setAttribute('aria-hidden', 'true');
    // clear content
    const body = popup.querySelector('.sh-popup-body');
    body.innerHTML = '';

    // If replaceUrl provided, manipulate history to restore previous URL
    if (replaceUrl === true) {
      // go back in history (popstate will fire)
      history.back();
    } else if (typeof replaceUrl === 'string') {
      history.replaceState(null, '', replaceUrl);
    }

    document.dispatchEvent(new CustomEvent('sh:popup-close'));
  }

  function initLinkHandlers() {
    // Delegate clicks on document
    document.addEventListener('click', async (ev) => {
      // Only handle left-clicks without modifier keys
      if (ev.defaultPrevented) return;
      if (ev.button !== 0) return; // not left click
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return; // let user open in new tab
      let anchor = ev.target;
      while (anchor && anchor.tagName !== 'A') anchor = anchor.parentElement;
      if (!anchor) return;
      if (!shouldInterceptLink(anchor)) return;

      // At this point we will intercept and open popup (unless it's a plain listing link you want full nav for)
      ev.preventDefault();

      const href = anchor.href;
      try {
        // show a temporary loader - simply an empty popup with "loading"
        const popup = createPopupDOM();
        const body = popup.querySelector('.sh-popup-body');
        body.innerHTML = '<div style="padding:12px;font-family:Courier,monospace;">Loading…</div>';
        popup.classList.remove('hidden');
        popup.setAttribute('aria-hidden', 'false');

        const res = await fetch(href, { method: 'GET', credentials: 'same-origin' });
        if (!res.ok) throw new Error('fetch-fail');

        const text = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        const contentEl = extractPostContent(doc);
        if (!contentEl) throw new Error('no-content');

        // clone node so we can insert safely
        const clone = contentEl.cloneNode(true);
        // sanitize: remove script tags inside cloned content (scripts will not run)
        clone.querySelectorAll && clone.querySelectorAll('script').forEach(s => s.remove());

        showPopupWithContent(clone, href);
        // notify other scripts that a post was loaded into popup
        document.dispatchEvent(new CustomEvent('sh:popup-loaded', { detail: { url: href } }));
      } catch (err) {
        // on error fallback to normal navigation
        console.warn('Post popup failed, navigating normally', err);
        location.href = href;
      }
    });
  }

  function initPopupCloseHandlers() {
    const popup = createPopupDOM();

    // close button
    popup.addEventListener('click', (ev) => {
      if (ev.target.matches('.sh-popup-close') || ev.target.hasAttribute('data-popup-close')) {
        ev.preventDefault();
        closePopup(true);
      }
    });

    // Escape key closes popup
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        const p = document.getElementById(POPUP_ID);
        if (p && !p.classList.contains('hidden')) {
          closePopup(true);
        }
      }
    });

    // Handle popstate: if history indicates we are returning to a previous state, close popup
    window.addEventListener('popstate', (ev) => {
      // if state is not our popup state, ensure popup is closed
      const p = document.getElementById(POPUP_ID);
      if (!ev.state || !ev.state.sh_post_popup) {
        if (p && !p.classList.contains('hidden')) {
          // close without modifying history (we're handling popstate)
          p.classList.add('hidden');
          p.setAttribute('aria-hidden', 'true');
          p.querySelector('.sh-popup-body').innerHTML = '';
          document.dispatchEvent(new CustomEvent('sh:popup-close'));
        }
      } else {
        // if state says it's our popup, leave it open (or handle re-open)
      }
    });
  }

  // Init routine
  function init() {
    createPopupDOM();
    initLinkHandlers();
    initPopupCloseHandlers();
    // Expose small API
    window.__SHALTZ_POST_POPUP = {
      openWithHTMLNode: (node, url) => showPopupWithContent(node, url),
      close: () => closePopup(true)
    };
    document.dispatchEvent(new CustomEvent('sh:post-popup-ready'));
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
