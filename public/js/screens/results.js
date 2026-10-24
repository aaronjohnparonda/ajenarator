/**
 * Results: every saved draw for a game, newest first, 20 at a time, with a "show draws up to"
 * date picker for jumping back in time.
 */

import { cloneTemplate, createElement } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { renderGameChips, rememberedGameCode } from '../ui/game-chips.js';
import { manilaNow } from '../lib/ph-time.js';
import {
  formatNumber, formatPeso, formatDrawDateLong, formatWinners, pad2,
} from '../lib/format.js';

const PAGE_SIZE = 20;

function buildDrawRow(draw) {
  const { fragment, refs } = cloneTemplate('tpl-draw-row');
  refs.date.textContent = formatDrawDateLong(draw.drawDate);
  refs.jackpot.textContent = draw.jackpotAmount === null ? '' : formatPeso(draw.jackpotAmount);
  refs.balls.replaceChildren(...draw.numbers.map((number) => createElement('span', 'ball ball--small', pad2(number))));
  refs.balls.setAttribute('aria-label', `Winning numbers: ${draw.numbers.join(', ')}`);
  refs.winners.textContent = formatWinners(draw.winners);
  refs.order.textContent = `Drawn as ${draw.drawOrder}`;
  return fragment;
}

export function mountResultsScreen(root, { api }) {
  const { fragment, refs } = cloneTemplate('tpl-results');
  root.append(fragment);

  const state = {
    games: [], chips: null, gameCode: null, page: 1, totalPages: 1, toDate: null, requestId: 0,
  };
  refs.date.max = manilaNow().date;
  refs.more.hidden = true;

  function renderSummary(total) {
    const range = state.toDate ? ` up to ${formatDrawDateLong(state.toDate)}` : '';
    refs.summary.textContent = total === 0 ? `No draws found${range}.` : `${formatNumber(total)} draws${range}`;
  }

  async function loadPage({ append }) {
    const requestId = ++state.requestId;
    if (append) {
      refs.more.setAttribute('aria-busy', 'true');
      refs.more.textContent = 'Loading…';
    } else {
      refs.list.replaceChildren(cloneTemplate('tpl-skeleton').fragment);
      refs.more.hidden = true;
    }

    try {
      const result = await api.fetchDraws(state.gameCode, { page: state.page, limit: PAGE_SIZE, toDate: state.toDate });
      if (requestId !== state.requestId) {
        return;
      }
      state.totalPages = result.totalPages;
      renderSummary(result.total);
      const rows = result.draws.map(buildDrawRow);
      if (append) {
        refs.list.append(...rows);
      } else {
        refs.list.replaceChildren(...rows);
      }
      const remaining = result.total - state.page * PAGE_SIZE;
      refs.more.hidden = remaining <= 0;
      refs.more.textContent = `Load ${Math.min(PAGE_SIZE, Math.max(remaining, 0))} more`;
    } catch (error) {
      if (requestId === state.requestId) {
        if (!append) {
          refs.list.replaceChildren();
        }
        showToast(error.isUserFacing ? error.message : "Couldn't load results. Try again.");
      }
    } finally {
      refs.more.removeAttribute('aria-busy');
    }
  }

  function showFirstPage() {
    state.page = 1;
    loadPage({ append: false });
  }

  function selectGame(code) {
    state.gameCode = code;
    state.chips.setSelected(code);
    showFirstPage();
  }

  refs.form.addEventListener('submit', (event) => event.preventDefault());
  refs.date.addEventListener('change', () => {
    state.toDate = refs.date.value || null;
    showFirstPage();
  });
  refs.clear.addEventListener('click', () => {
    refs.date.value = '';
    state.toDate = null;
    showFirstPage();
  });
  refs.more.addEventListener('click', () => {
    if (refs.more.getAttribute('aria-busy') === 'true' || state.page >= state.totalPages) {
      return;
    }
    state.page += 1;
    loadPage({ append: true });
  });

  async function load() {
    refs.list.replaceChildren(cloneTemplate('tpl-skeleton').fragment);
    try {
      state.games = await api.fetchGames();
      const selectedCode = rememberedGameCode(state.games);
      state.chips = renderGameChips(refs.chips, state.games, { selectedCode, onSelect: selectGame });
      selectGame(selectedCode);
    } catch (error) {
      refs.list.replaceChildren();
      showToast("Couldn't load the games. Refresh to try again.");
    }
  }

  load();
  return { destroy() { state.requestId += 1; } };
}
