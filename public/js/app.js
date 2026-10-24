/** AJenarator front end: wires the shell (theme, sound, greeting) and the screens together. */

import { initThemeToggle } from './core/theme.js';
import { initSoundToggle } from './core/sound.js';
import { createRouter } from './core/router.js';
import { greetingFor } from './lib/ph-time.js';
import * as api from './data/api.js';
import { mountGenerateScreen } from './screens/generate.js';
import { mountComingSoon } from './screens/coming-soon.js';

const GREETING_REFRESH_MS = 60000;

function initGreeting(element) {
  const update = () => {
    element.textContent = greetingFor();
  };
  update();
  window.setInterval(update, GREETING_REFRESH_MS);
}

initThemeToggle(document.getElementById('theme-toggle'));
initSoundToggle(document.getElementById('sound-toggle'));
initGreeting(document.getElementById('greeting'));

createRouter({
  root: document.getElementById('screen-root'),
  // Generate opens first until the Home screen is built.
  defaultRoute: 'generate',
  navLinks: [...document.querySelectorAll('.app-nav__item')],
  routes: {
    home: (root) => mountComingSoon(root, {
      title: 'Home is being built next',
      text: 'Today’s draws, countdowns and the latest results will appear here.',
    }),
    generate: (root) => mountGenerateScreen(root, { api }),
    stats: (root) => mountComingSoon(root, {
      title: 'Stats are being built next',
      text: 'Hot and cold numbers, frequency, gaps and patterns from real PCSO draws.',
    }),
    results: (root) => mountComingSoon(root, {
      title: 'Results are being built next',
      text: 'Every draw since 2016, searchable by game and date.',
    }),
    me: (root) => mountComingSoon(root, {
      title: 'Your account arrives with Google sign-in',
      text: 'Saved tickets and filter presets will live here.',
    }),
  },
});
