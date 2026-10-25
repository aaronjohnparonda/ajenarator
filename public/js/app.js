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
import { mountAccountScreen } from './screens/account.js';
import { mountDrawNightScreen } from './screens/draw-night.js';
import { loadSession, subscribeSession, getSession, firstName } from './core/session.js';
import { fillAvatar } from './ui/avatar.js';
import { showNewResults } from './ui/results-popup.js';

const GREETING_REFRESH_MS = 60000;

/** "Good evening" or, when signed in, "Good evening, Aaron". */
function initGreeting(element) {
  const update = () => {
    const name = firstName(getSession().user);
    element.textContent = name ? `${greetingFor()}, ${name}` : greetingFor();
  };
  update();
  window.setInterval(update, GREETING_REFRESH_MS);
  subscribeSession(update);
}

function initAvatar(button) {
  subscribeSession(({ user }) => {
    fillAvatar(button, user);
    button.setAttribute('aria-label', user ? `Your account: ${user.name || user.email}` : 'Your account: sign in');
  });
}

initThemeToggle(document.getElementById('theme-toggle'));
initSoundToggle(document.getElementById('sound-toggle'));
initGreeting(document.getElementById('greeting'));
initAvatar(document.getElementById('avatar-button'));
loadSession(api);
// When signed in, show any pick results that came in since the last visit.
subscribeSession(({ user }) => {
  if (user) {
    showNewResults({ api, user });
  }
});

createRouter({
  root: document.getElementById('screen-root'),
  defaultRoute: 'home',
  navLinks: [...document.querySelectorAll('.app-nav__item')],
  routes: {
    home: (root) => mountHomeScreen(root, { api }),
    generate: (root) => mountGenerateScreen(root, { api }),
    stats: (root) => mountStatsScreen(root, { api }),
    results: (root) => mountResultsScreen(root, { api }),
    me: (root) => mountAccountScreen(root, { api }),
    live: (root) => mountDrawNightScreen(root, { api }),
  },
});
