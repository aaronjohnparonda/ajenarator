/** Dark/light theme toggle. The first paint is handled by theme-init.js. */

import { writeSetting } from './storage.js';

const BROWSER_BAR_COLORS = { dark: '#0B0F1A', light: '#F4EEE2' };

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function applyTheme(theme, button) {
  document.documentElement.dataset.theme = theme;
  button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', BROWSER_BAR_COLORS[theme]);
  }
}

export function initThemeToggle(button) {
  applyTheme(currentTheme(), button);
  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next, button);
    writeSetting('theme', next);
  });
}
