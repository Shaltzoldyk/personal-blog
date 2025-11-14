/**
 * pjax.js
 *  - Simple PJAX implementation to keep audio player persistent across internal navigation.
 *  - Intercepts same-origin internal links (no modifier keys, not target=_blank), fetches the destination,
 *    extracts the main content container, replaces the current page's container, updates title and history,
 *    then dispatches an event so other modules can re-initialize.
 *
 *  - It tries to find '#main-content' in both current page and fetched page. If not found,
 *    it falls back to '.post-container' or '.blog-post' etc.
 *
 * Include with:
 * <script src="pjax.js" defer></script>
 */

(function () {
  const REPLACEMENT_SELECTORS = ['#main-content', 'main', '.post-container', '.blog-post', '.post-article', 'article'];

  function findReplacementElement(doc) {
    for (const sel of REPLACEMENT_SELECTORS) {
      const el = doc.querySelector(sel);
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
    if (a.getAttribute('href') && a.getAttribute('href').startsWith('#')) return false;
    if (a.target && a.target.toLowerCase() === '_blank') return false;
    if (a.hasAttribute('download')) return false;
    if (!isSameOrigin(a.href)) return false;
    // let post-popup handle certain post clicks (we still allow pjax for other links)
    // we will intercept generic internal links; post-popup already intercepts clicks for /posts/ links separately
    return true;
  }

  async function fetchDocument(url) {
    const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
    if (!res.ok) throw new Error('fetch failed');
    const text = await res.text();
    const parser = new DOMParser();
    return parser.parseFromString(text, 'text/html');
  }

  function replaceContent(newDoc) {
    const newMain = findReplacementElement(newDoc);
    const curMain = findReplacementElement(document);
    if (!newMain || !curMain) {
      // can't find a reliable replacement - fallback to full navigation
      return false;
    }

    // replace content
    curMain.innerHTML = newMain.innerHTML;

    // update document title
    const newTitle = newDoc.querySelector('title');
    if (newTitle) document.title = newTitle.textContent;

    // update body classes (so post-page vs homepage styles can change)
    document.body.className = newDoc.body.className;

    // scroll to top
    window.scrollTo(0, 0);

    // dispatch event so other scripts can rebind
    document.dispatchEvent(new CustomEvent('pjax:load', { detail: { url: location.href } }));

    return true;
  }

  function initLinkDelegation() {
    document.addEventListener('click', async (ev) => {
      if (ev.defaultPrevented) return;
      if (ev.button !== 0) return; // left-click only
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return; // allow open-in-new
      let a = ev.target;
      while (a && a.tagName !== 'A') a = a.parentElement;
      if (!a) return;
      if (!shouldHandleLink(a)) return;

      // If post-popup would handle it (e.g., /posts/), allow post-popup to take precedence.
      // We only run PJAX for links that are not handled by post-popup OR where post-popup doesn't preventDefault.
      // To avoid conflicts, if the clicked anchor contains class 'no-pjax', skip pjax.
      if (a.classList.contains('no-pjax')) return;

      ev.preventDefault();
      const href = a.href;

      try {
        const newDoc = await fetchDocument(href);
        const didReplace = replaceContent(newDoc);
        if (!didReplace) {
          // fallback to full navigation
          location.href = href;
          return;
        }
        // push state
        history.pushState({}, '', href);
      } catch (err) {
        console.warn('PJAX failed, falling back to full nav', err);
        location.href = href;
      }
    });

    // Handle back/forward
    window.addEventListener('popstate', async (ev) => {
      const url = location.href;
      try {
        const doc = await fetchDocument(url);
        const ok = replaceContent(doc);
        if (!ok) {
          // full reload fallback
          location.href = url;
        }
      } catch (e) {
        location.href = url;
      }
    });
  }

  function init() {
    // Run on DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initLinkDelegation);
    } else {
      initLinkDelegation();
    }
    document.dispatchEvent(new CustomEvent('pjax:ready'));
  }

  init();
})();
