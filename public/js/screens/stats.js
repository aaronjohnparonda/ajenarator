/**
 * Stats: hot and cold, a frequency heatmap, longest gaps and pattern distributions for one game.
 * Everything comes from GET /api/v1/games/:slug/stats (real PCSO draws).
 */

import { cloneTemplate, createElement } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { renderGameChips, rememberedGameCode } from '../ui/game-chips.js';
import {
  formatNumber, formatDrawDate, formatDrawDateLong, formatPercent, pad2,
} from '../lib/format.js';

const LONGEST_GAP_COUNT = 6;
const STRONG_HEAT = 0.6;

function ballWithCount(number, count, extraClass) {
  const item = createElement('div', 'hot-cold__item');
  item.append(
    createElement('span', `ball ball--small ${extraClass}`.trim(), pad2(number)),
    createElement('span', 'hot-cold__count', `${count}×`),
  );
  item.setAttribute('aria-label', `${number}: ${count} times`);
  return item;
}

function renderBars(container, rows, total) {
  const shares = rows.map((row) => (total === 0 ? 0 : row.count / total));
  const largest = Math.max(...shares, 0.0001);
  container.replaceChildren(...rows.map((row, index) => {
    const { fragment, refs } = cloneTemplate('tpl-bar-row');
    refs.label.textContent = row.label;
    refs.fill.style.setProperty('--value', String(shares[index] / largest));
    refs.value.textContent = formatPercent(shares[index]);
    return fragment;
  }));
}

function renderStats(container, game, stats) {
  const { fragment, refs } = cloneTemplate('tpl-stats-content');
  const { frequency, hotCold, distributions } = stats;

  refs.totalDraws.textContent = formatNumber(stats.totalDraws);
  refs.since.textContent = stats.firstDrawDate ? `since ${stats.firstDrawDate.slice(0, 4)}` : '';
  refs.windowDraws.textContent = formatNumber(frequency.drawCount);
  refs.averageSum.textContent = distributions.sum.average === null ? '—' : String(distributions.sum.average);
  refs.sumRange.textContent = distributions.sum.lowest === null ? '' : `range ${distributions.sum.lowest}–${distributions.sum.highest}`;

  refs.hotColdCaption.textContent = `Last ${hotCold.drawCount} draws · an average number appears ${hotCold.expectedPerNumber} times`;
  refs.hot.replaceChildren(...hotCold.hot.map((entry) => ballWithCount(entry.number, entry.count, '')));
  refs.cold.replaceChildren(...hotCold.cold.map((entry) => ballWithCount(entry.number, entry.count, 'ball--cold')));

  refs.heatCaption.textContent = `${formatDrawDateLong(frequency.windowStart)} to today · ${formatNumber(frequency.drawCount)} draws · `
    + `average ${frequency.expectedPerNumber} each`;
  const counts = frequency.numbers.map((entry) => entry.count);
  const lowest = Math.min(...counts);
  const spread = Math.max(...counts) - lowest || 1;
  refs.heatmap.replaceChildren(...frequency.numbers.map(({ number, count }) => {
    const heat = (count - lowest) / spread;
    const cell = createElement('span', `heat-cell${heat >= STRONG_HEAT ? ' heat-cell--strong' : ''}`);
    cell.style.setProperty('--heat', heat.toFixed(3));
    cell.title = `${number}: drawn ${count} times`;
    cell.setAttribute('aria-label', `${number}: drawn ${count} times`);
    cell.setAttribute('role', 'img');
    cell.append(createElement('span', 'heat-cell__number', pad2(number)), createElement('span', 'heat-cell__count', String(count)));
    return cell;
  }));
  if (game.maxNumber > 50) {
    refs.heatmap.classList.add('heatmap--large');
  }

  const longestGaps = stats.gaps
    .filter((gap) => gap.drawsSinceLastSeen !== null)
    .sort((a, b) => b.drawsSinceLastSeen - a.drawsSinceLastSeen)
    .slice(0, LONGEST_GAP_COUNT);
  const currentYear = String(new Date().getFullYear());
  refs.gaps.replaceChildren(...longestGaps.map((gap) => {
    const row = createElement('div', 'gap-row');
    const lastSeen = gap.lastSeenDate.startsWith(currentYear) ? formatDrawDate(gap.lastSeenDate) : formatDrawDateLong(gap.lastSeenDate);
    const text = createElement('div', 'gap-row__text');
    text.append(
      createElement('span', 'gap-row__count', `${gap.drawsSinceLastSeen} draws`),
      createElement('span', 'gap-row__date', `last drawn ${lastSeen}`),
    );
    row.append(createElement('span', 'ball ball--small', pad2(gap.number)), text);
    return row;
  }));

  refs.patternCaption.textContent = `Past 3 years · ${formatNumber(distributions.drawCount)} draws`;
  renderBars(refs.oddEven, distributions.oddEven, distributions.drawCount);
  renderBars(refs.lowHigh, distributions.lowHigh, distributions.drawCount);
  refs.pairNote.textContent = distributions.consecutivePairShare === null
    ? ''
    : `${formatPercent(distributions.consecutivePairShare)} of these draws had at least one consecutive pair, like 14-15.`;

  container.replaceChildren(fragment);
}

export function mountStatsScreen(root, { api }) {
  const { fragment, refs } = cloneTemplate('tpl-stats');
  root.append(fragment);
  const state = { games: [], chips: null, requestId: 0 };

  async function selectGame(code) {
    const game = state.games.find((entry) => entry.code === code);
    state.chips.setSelected(code);
    const requestId = ++state.requestId;
    refs.body.replaceChildren(cloneTemplate('tpl-skeleton').fragment);
    try {
      const stats = await api.fetchStats(code);
      if (requestId === state.requestId) {
        renderStats(refs.body, game, stats);
      }
    } catch (error) {
      if (requestId === state.requestId) {
        refs.body.replaceChildren();
        showToast(error.isUserFacing ? error.message : "Couldn't load the statistics. Try again.");
      }
    }
  }

  async function load() {
    refs.body.replaceChildren(cloneTemplate('tpl-skeleton').fragment);
    try {
      state.games = await api.fetchGames();
      const selectedCode = rememberedGameCode(state.games);
      state.chips = renderGameChips(refs.chips, state.games, { selectedCode, onSelect: selectGame });
      selectGame(selectedCode);
    } catch (error) {
      refs.body.replaceChildren();
      showToast("Couldn't load the games. Refresh to try again.");
    }
  }

  load();
  return { destroy() { state.requestId += 1; } };
}
