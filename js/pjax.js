/**
 * pjax.js (updated - conservative)
 *  - Simple PJAX implementation to keep audio player persistent across internal navigation.
 *  - Intercepts same-origin internal links (no modifier keys, not target=_blank), fetches the destination,
 *    extracts the main content container, replaces the current page's container, updates title and history,
 *    then dispatches events so other modules can re-initialize.
 *
 * Updates made (non-destructive):
 *  - PRESERVE .mobile-only elements found in the current main container by cloning them into the fetched main
 *    BEFORE replacement. This ensures mobile-only UI (accordions, mobile music bar placeholders) survive PJAX swaps.
 *  - Added extra defensive checks and clearer lifecycle event ordering.
 *
 * Notes:
 *  - Will NOT handle links intended for the post popup:
 *      * anchors with class 'post-link'
 *      * anchors whose pathname contains '/posts/'
 *      * anchors with attribute data-no-pjax or class 'no-pjax'
 *  - Dispatches PJAX lifecycle events used by other scripts:
 *      'pjax:ready', 'pjax:begin', 'pjax:load', 'pjax:complete', 'pjax:loaded', 'pjax:end'
 *
 * Include with:
 * <script src="js/pjax.js" defer></script>
 */

(function () {
  const REPLACEMENT_SELECTORS = ['#main-content', 'main', '.post-container', '.blog-post', '.post-article', 'article'];

  function findReplacementElement(rootDoc) {
    for (const sel of REPLACEMENT_SELECTORS) {
      const el = rootDoc.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function isSameOrigin(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin;
    } catch (e) { return false; }
  }

  function shouldHandleLink(a) {
    if (!a || !a.href) return false;
    // ignore anchors, mailto, tel
    const hrefAttr = a.getAttribute('href') || '';
    if (hrefAttr.startsWith('#')) return false;
    if (hrefAttr.startsWith('mailto:') || hrefAttr.startsWith('tel:')) return false;

    // explicit target blank -> let browser handle
    if (a.target && a.target.toLowerCase() === '_blank') return false;
    // download attribute -> let browser handle
    if (a.hasAttribute('download')) return false;
    // explicit external rel -> let browser handle
    if ((a.rel || '').toLowerCase().split(/\s+/).includes('external')) return false;
    if (!isSameOrigin(a.href)) return false;

    // explicit data-no-pjax or class 'no-pjax' -> skip
    if (a.hasAttribute('data-no-pjax') || a.classList.contains('no-pjax')) return false;

    // important: links intended for the post popup must be ignored by PJAX
    if (a.classList && a.classList.contains('post-link')) return false;
    try {
      const u = new URL(a.href, location.href);
      if (u.pathname && u.pathname.includes('/posts/')) return false;
    } catch (e) {
      // ignore parse errors
    }

    // if anchor is inside the popup, skip
    const popup = document.getElementById('sh-post-popup');
    if (popup && popup.contains(a)) return false;

    return true;
  }

  async function fetchDocument(url) {
    const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    const text = await res.text();
    const parser = new DOMParser();
    return parser.parseFromString(text, 'text/html');
  }

  /**
   * Replace current main content with fetched main while preserving
   * any mobile-only nodes that exist in the current main area.
   *
   * Strategy:
   * 1. Find the replacement container in newDoc (newMain) and in current document (curMain).
   * 2. Clone any .mobile-only nodes from curMain and prepend them into newMain so they persist.
   * 3. Replace curMain.innerHTML with newMain.innerHTML.
   * 4. Update title, body classes, scroll position, and dispatch lifecycle events.
   */
  function replaceContent(newDoc) {
    const newMain = findReplacementElement(newDoc);
    const curMain = findReplacementElement(document);
    if (!newMain || !curMain) {
      // can't find a reliable replacement - fallback to full navigation
      return false;
    }

    try {
      // Preserve mobile-only nodes that are in the current main area.
      // We clone them into the fetched newMain (prepend) so they remain visible after the swap.
      const preserved = Array.from(curMain.querySelectorAll('.mobile-only'));
      if (preserved.length > 0) {
        // find insertion point in newMain: before its first child
        const insertionPoint = newMain.firstElementChild;
        // Clone in reverse order so original visual ordering is preserved when prepending
        for (let i = preserved.length - 1; i >= 0; i--) {
          const clone = preserved[i].cloneNode(true);
          // Remove any id collisions to avoid duplicate ID issues
          if (clone.id) clone.removeAttribute('id');
          newMain.insertBefore(clone, insertionPoint);
        }
      }

      // Replace the current main's innerHTML with the fetched main's innerHTML
      curMain.innerHTML = newMain.innerHTML;

      // update document title
      const newTitle = newDoc.querySelector('title');
      if (newTitle) document.title = newTitle.textContent;

      // update body classes (so post-page vs homepage styles can change)
      document.body.className = newDoc.body.className || '';

      // reset scroll position
      window.scrollTo(0, 0);

      // dispatch event so other scripts can rebind. include url in detail
      document.dispatchEvent(new CustomEvent('pjax:load', { detail: { url: location.href } }));

      return true;
    } catch (err) {
      console.warn('pjax replaceContent error', err);
      return false;
    }
  }

  function initLinkDelegation() {
    document.addEventListener('click', async (ev) => {
      try {
        if (ev.defaultPrevented) return;
        if (ev.button !== 0) return; // left-click only
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return; // allow open-in-new-tab/window

        let a = ev.target;
        while (a && a.tagName !== 'A') a = a.parentElement;
        if (!a) return;

        if (!shouldHandleLink(a)) return;

        // allow explicit opt-out via data attribute/class
        if (a.classList.contains('no-pjax') || a.hasAttribute('data-no-pjax')) return;

        ev.preventDefault();
        const href = a.href;

        // small lifecycle event: begin
        document.dispatchEvent(new CustomEvent('pjax:begin', { detail: { url: href } }));

        try {
          const newDoc = await fetchDocument(href);
          const didReplace = replaceContent(newDoc);
          if (!didReplace) {
            // fallback to full navigation
            location.href = href;
            return;
          }

          // push state with explicit PJAX marker so other listeners can differentiate
          try {
            history.pushState({ sh_pjax: true }, '', href);
          } catch (e) {
            // ignore pushState errors (very old browsers or restricted contexts)
          }

          // notify completion events (multiple names for compatibility)
          document.dispatchEvent(new CustomEvent('pjax:complete', { detail: { url: href } }));
          document.dispatchEvent(new CustomEvent('pjax:loaded', { detail: { url: href } }));
          document.dispatchEvent(new CustomEvent('pjax:end', { detail: { url: href } }));

        } catch (err) {
          console.warn('PJAX failed, falling back to full nav', err);
          location.href = href;
        }
      } catch (e) {
        // defensive catch to avoid breaking other click handlers
        console.error('pjax click handler error', e);
      }
    });

    // Handle back/forward
    window.addEventListener('popstate', async (ev) => {
      try {
        // Ignore popstate events that were pushed by the post-popup (popup uses sh_post_popup)
        // or other non-pjax markers. Only handle popstate if it's not a popup state.
        const state = ev.state || {};
        if (state && state.sh_post_popup) {
          // This popstate was caused by the post popup; ignore PJAX replacement.
          return;
        }

        const url = location.href;
        // lifecycle begin
        document.dispatchEvent(new CustomEvent('pjax:begin', { detail: { url } }));
        try {
          const doc = await fetchDocument(url);
          const ok = replaceContent(doc);
          if (!ok) {
            // full reload fallback
            location.href = url;
            return;
          }

          // completion events for popstate
          document.dispatchEvent(new CustomEvent('pjax:complete', { detail: { url } }));
          document.dispatchEvent(new CustomEvent('pjax:loaded', { detail: { url } }));
          document.dispatchEvent(new CustomEvent('pjax:end', { detail: { url } }));

        } catch (e) {
          // fallback to full navigation if anything fails
          location.href = url;
        }
      } catch (e) {
        console.error('pjax popstate handler error', e);
      }
    });
  }

  function init() {
    // Run on DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        initLinkDelegation();
        document.dispatchEvent(new CustomEvent('pjax:ready'));
      });
    } else {
      initLinkDelegation();
      document.dispatchEvent(new CustomEvent('pjax:ready'));
    }
  }

  init();
})();
