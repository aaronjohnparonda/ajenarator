/**
 * Hash-based screen switching (#/generate, #/stats, ...). Works on any static host and keeps
 * the browser's back button working. Each screen mount function may return { destroy() }
 * to stop its timers when the visitor leaves.
 */

export function createRouter({ root, routes, defaultRoute, navLinks }) {
  let activeScreen = null;
  let isFirstRender = true;

  function routeFromHash() {
    const name = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
    return Object.prototype.hasOwnProperty.call(routes, name) ? name : null;
  }

  function render() {
    let name = routeFromHash();
    if (!name) {
      name = defaultRoute;
      window.history.replaceState(null, '', `#/${name}`);
    }

    if (activeScreen && typeof activeScreen.destroy === 'function') {
      activeScreen.destroy();
    }
    root.replaceChildren();
    activeScreen = routes[name](root) || null;

    navLinks.forEach((link) => {
      if (link.dataset.route === name) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });

    if (!isFirstRender) {
      window.scrollTo({ top: 0 });
      root.focus({ preventScroll: true });
    }
    isFirstRender = false;
  }

  window.addEventListener('hashchange', render);
  render();
}
