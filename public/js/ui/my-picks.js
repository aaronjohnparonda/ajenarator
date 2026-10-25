/**
 * My Picks (inside the Me screen when signed in): next draws, personal record, history.
 */

import { cloneTemplate } from './dom.js';
import { showToast, announce } from './toast.js';
import { openPickSheet } from './pick-sheet.js';
import { writeSetting } from '../core/storage.js';
import { formatDrawDate, pad2 } from '../lib/format.js';
import { formatCountdown } from '../lib/draw-schedule.js';
import { pickBalls, pickStatusText, formatManilaTime } from '../lib/pick-format.js';

const HISTORY_PAGE_SIZE = 10;
const TICK_MS = 1000;
const HOUR_MS = 60 * 60 * 1000;

export function mountMyPicks(container, { api }) {
  const { fragment, refs } = cloneTemplate('tpl-my-picks');
  container.replaceChildren(fragment);

  const state = {
    upcoming: [],
    countdowns: [], // { element, locksAt, drawDate }
    historyPage: 0,
    historyTotalPages: 1,
    timer: null,
    destroyed: false,
    reloading: false,
  };

  function renderRecord(record) {
    refs.totalPicks.textContent = String(record.totalPicks);
    refs.settledHint.textContent = record.settled === record.totalPicks
      ? 'all with results'
      : `${record.settled} with results`;
    refs.bestMatch.textContent = record.bestMatch === null ? '—' : String(record.bestMatch);
    refs.threeOrMore.textContent = String(record.threeOrMore);
  }

  function closingText(entry) {
    const locksAt = new Date(entry.locksAt);
    const remaining = locksAt - new Date();
    if (remaining < 6 * HOUR_MS) {
      return `Closes in ${formatCountdown(remaining)} · ${formatManilaTime(locksAt)}`;
    }
    return `${formatDrawDate(entry.drawDate)} · closes ${formatManilaTime(locksAt)}`;
  }

  function buildUpcomingRow(entry) {
    const { fragment: rowFragment, refs: row } = cloneTemplate('tpl-upcoming-row');
    row.game.textContent = entry.gameName;

    if (entry.pick) {
      row.when.textContent = `${formatDrawDate(entry.drawDate)} · draw at ${formatManilaTime(new Date(entry.drawAt))}`;
      row.pill.textContent = 'Locked in';
      row.pill.classList.add('status-pill--result');
      row.balls.replaceChildren(...pickBalls(entry.pick.numbers));
      row.actions.hidden = true;
    } else {
      row.when.textContent = closingText(entry);
      state.countdowns.push({ element: row.when, entry });
      row.pill.textContent = 'Open';
      row.pill.classList.add('status-pill--upcoming');
      row.balls.hidden = true;
      row.choose.addEventListener('click', () => openPickSheet({
        target: entry,
        source: 'manual',
        api,
        opener: row.choose,
        onSaved: (pick) => {
          showToast(`Locked in for ${formatDrawDate(entry.drawDate)}: ${pick.numbers.map(pad2).join(' ')}`);
          announce('Pick locked in.');
          reload();
        },
        onClosedDraw: () => reload(),
      }));
      row.generate.addEventListener('click', () => writeSetting('game', entry.gameCode));
    }
    return rowFragment;
  }

  function buildHistoryRow(pick) {
    const { fragment: rowFragment, refs: row } = cloneTemplate('tpl-history-row');
    row.game.textContent = pick.gameName;
    row.date.textContent = formatDrawDate(pick.drawDate);
    row.balls.replaceChildren(...pickBalls(pick.numbers, pick.result ? pick.result.matched : null));
    row.status.textContent = pickStatusText(pick);
    row.status.classList.toggle('history-row__status--hit', Boolean(pick.result && pick.result.matchCount >= 3));
    row.winning.textContent = pick.result ? `Winning: ${pick.result.numbers.map(pad2).join(' ')}` : '';
    row.winning.hidden = !pick.result;
    return rowFragment;
  }

  function renderUpcoming() {
    state.countdowns = [];
    refs.upcoming.replaceChildren(...state.upcoming.map(buildUpcomingRow));
  }

  async function loadHistoryPage(page) {
    refs.more.disabled = true;
    try {
      const data = await api.fetchPickHistory({ page, limit: HISTORY_PAGE_SIZE });
      if (state.destroyed) {
        return;
      }
      state.historyPage = data.page;
      state.historyTotalPages = data.totalPages;
      const rows = data.picks.map(buildHistoryRow);
      if (page === 1) {
        refs.history.replaceChildren(...rows);
        refs.historyEmpty.hidden = data.total > 0;
      } else {
        refs.history.append(...rows);
      }
      refs.more.hidden = data.page >= data.totalPages;
    } catch (error) {
      showToast(error.isUserFacing ? error.message : "Couldn't load your picks. Try again.");
    } finally {
      refs.more.disabled = false;
    }
  }

  async function reload() {
    if (state.reloading || state.destroyed) {
      return;
    }
    state.reloading = true;
    try {
      const [upcoming, summary] = await Promise.all([api.fetchUpcomingPicks(), api.fetchPickSummary()]);
      if (state.destroyed) {
        return;
      }
      state.upcoming = upcoming;
      renderUpcoming();
      renderRecord(summary.record);
      await loadHistoryPage(1);
      refs.loading.hidden = true;
      refs.content.hidden = false;
    } catch (error) {
      refs.loading.textContent = error.isUserFacing ? error.message : "Couldn't load My Picks. Check your connection and try again.";
    } finally {
      state.reloading = false;
    }
  }

  function tick() {
    let anyClosed = false;
    state.countdowns.forEach(({ element, entry }) => {
      if (new Date(entry.locksAt) <= new Date()) {
        anyClosed = true;
      } else {
        element.textContent = closingText(entry);
      }
    });
    if (anyClosed) {
      reload(); // the draw closed; show the next one
    }
  }

  refs.more.addEventListener('click', () => loadHistoryPage(state.historyPage + 1));
  state.timer = window.setInterval(tick, TICK_MS);
  reload();

  return {
    reload,
    destroy() {
      state.destroyed = true;
      window.clearInterval(state.timer);
    },
  };
}
