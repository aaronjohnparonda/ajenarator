/**
 * Home: a live status board for all five games.
 *
 * Every second the countdowns and statuses update; every minute (and whenever the app comes
 * back into view) the games are re-fetched, so "Waiting for results" turns into "Result in"
 * without reloading the page. Games needing attention tonight are listed first.
 */

import { cloneTemplate, createElement } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { writeSetting } from '../core/storage.js';
import { manilaNow } from '../lib/ph-time.js';
import { drawStatus } from '../lib/draw-status.js';
import { formatCountdown } from '../lib/draw-schedule.js';
import {
  formatPeso, formatDrawDate, formatDayHeading, formatWinners, pad2,
} from '../lib/format.js';

const TICK_MS = 1000;
const REFRESH_MS = 60000;
const STATUS_ORDER = { waiting: 0, tonight: 1, result: 2, delayed: 3, upcoming: 4 };
const SHORT_WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function statusDetail(status, now) {
  const countdown = status.countdownTo ? formatCountdown(status.countdownTo - now) : '';
  switch (status.state) {
    case 'tonight':
      return `Draw starts in ${countdown}`;
    case 'waiting':
      return 'PCSO posts results from about 10 PM. Checking automatically.';
    case 'result':
      return 'Tonight’s numbers are in.';
    case 'delayed':
      return `No result yet for ${formatDrawDate(status.missingDate)}${countdown ? ` · next draw in ${countdown}` : ''}`;
    default:
      return countdown ? `Next draw in ${countdown}` : '';
  }
}

export function mountHomeScreen(root, { api }) {
  const { fragment, refs } = cloneTemplate('tpl-home');
  root.append(fragment);

  const state = { games: [], cards: [], orderKey: '', tickTimer: null, refreshTimer: null, loaded: false };

  function buildCard(game) {
    const { fragment: cardFragment, refs: cardRefs, root: card } = cloneTemplate('tpl-status-card');
    cardRefs.name.textContent = game.name;
    cardRefs.schedule.textContent = `Draws ${game.drawDays.map((day) => SHORT_WEEKDAYS[day]).join(' · ')}`;
    card.addEventListener('click', () => writeSetting('game', game.code));

    const draw = game.lastDraw;
    if (draw) {
      cardRefs.balls.replaceChildren(...draw.numbers.map((number) => createElement('span', 'ball ball--small', pad2(number))));
      cardRefs.lastMeta.textContent = `${formatDrawDate(draw.drawDate)} · ${formatWinners(draw.winners)}`;
      cardRefs.jackpot.textContent = draw.jackpotAmount === null ? '' : formatPeso(draw.jackpotAmount);
    } else {
      cardRefs.lastMeta.textContent = 'No results saved yet';
    }
    return { game, card, refs: cardRefs, fragment: cardFragment };
  }

  function updateCard(entry, now) {
    const status = drawStatus(entry.game, now);
    entry.refs.pill.className = `status-pill status-pill--${status.state}`;
    entry.refs.pillLabel.textContent = status.label;
    entry.refs.detail.textContent = statusDetail(status, now);
    entry.card.setAttribute('aria-label', `${entry.game.name}: ${status.label}. Open Generate for this game.`);
    return status;
  }

  function sortedGames(now) {
    return [...state.games].sort((a, b) => {
      const statusA = drawStatus(a, now);
      const statusB = drawStatus(b, now);
      const byState = STATUS_ORDER[statusA.state] - STATUS_ORDER[statusB.state];
      if (byState !== 0) {
        return byState;
      }
      return (statusA.countdownTo || 0) - (statusB.countdownTo || 0);
    });
  }

  function renderList() {
    const now = new Date();
    const games = sortedGames(now);
    state.orderKey = games.map((game) => `${game.code}:${drawStatus(game, now).state}`).join('|');
    state.cards = games.map(buildCard);
    state.cards.forEach((entry) => updateCard(entry, now));
    refs.list.replaceChildren(...state.cards.map((entry) => entry.fragment));
  }

  function tick() {
    const now = new Date();
    refs.today.textContent = formatDayHeading(manilaNow(now).date);
    const orderKey = sortedGames(now).map((game) => `${game.code}:${drawStatus(game, now).state}`).join('|');
    if (orderKey !== state.orderKey) {
      renderList(); // a status changed (e.g. 9 PM passed): re-sort the board
      return;
    }
    state.cards.forEach((entry) => updateCard(entry, now));
  }

  async function refresh() {
    try {
      state.games = await api.fetchGames();
      renderList();
      state.loaded = true;
    } catch (error) {
      if (!state.loaded) {
        refs.list.replaceChildren();
        showToast("Couldn't load today’s draws. Refresh to try again.");
      }
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && state.loaded) {
      refresh();
    }
  }

  refs.today.textContent = formatDayHeading(manilaNow().date);
  refs.list.replaceChildren(cloneTemplate('tpl-skeleton').fragment);
  refresh();
  state.tickTimer = window.setInterval(tick, TICK_MS);
  state.refreshTimer = window.setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    destroy() {
      window.clearInterval(state.tickTimer);
      window.clearInterval(state.refreshTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
