/** AJenarator front end: wires the shell (theme, sound, greeting) and the screens together. */

import { initThemeToggle } from './core/theme.js';
import { initSoundToggle } from './core/sound.js';
import { createRouter } from './core/router.js';
import { greetingFor } from './lib/ph-time.js';
import * as api from './data/api.js';
import { mountHomeScreen } from './screens/home.js';
import { mountGenerateScreen } from './screens/generate.js';
import { mountStatsScreen } from './screens/stats.js';
import { mountResultsScreen } from './screens/results.js';
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
  defaultRoute: 'home',
  navLinks: [...document.querySelectorAll('.app-nav__item')],
  routes: {
    home: (root) => mountHomeScreen(root, { api }),
    generate: (root) => mountGenerateScreen(root, { api }),
    stats: (root) => mountStatsScreen(root, { api }),
    results: (root) => mountResultsScreen(root, { api }),
    me: (root) => mountComingSoon(root, {
      title: 'Your account arrives with Google sign-in',
      text: 'Saved tickets and filter presets will live here.',
    }),
  },
});
