/*
 * Runs before the page paints (loaded without "defer") so the saved theme applies
 * immediately - no flash of the wrong theme. Dark is the default.
 */
(function applySavedTheme() {
  var theme = 'dark';
  try {
    var saved = window.localStorage.getItem('ajenarator.theme');
    if (saved === 'light' || saved === 'dark') {
      theme = saved;
    }
  } catch (error) {
    // Storage blocked (private mode, strict settings): keep the default.
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
