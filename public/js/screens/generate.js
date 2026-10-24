/**
 * Generate screen: pick a game, choose how many picks, tap Generate, watch the golden balls drop.
 *
 * Choreography: picks start PICK_STAGGER_MS apart and, within a pick, balls drop
 * BALL_STAGGER_MS apart. Each ball's click sound is scheduled for the moment it lands,
 * then badges fade in and a gold ring sparkles around the finished pick.
 */

import { cloneTemplate, createElement, prefersReducedMotion } from '../ui/dom.js';
import { countUp } from '../ui/count-up.js';
import { showToast, announce } from '../ui/toast.js';
import { readSetting, writeSetting } from '../core/storage.js';
import { renderGameChips, rememberedGameCode } from '../ui/game-chips.js';
import { openFilterSheet } from '../ui/filter-sheet.js';
import { loadFilters, saveFilters, countChanges } from '../lib/filters-store.js';
import { playClick, playChime } from '../core/sound.js';
import { vibrate } from '../core/haptics.js';
import { nextDraw, drawDayLabel, formatDrawTime, formatCountdown } from '../lib/draw-schedule.js';
import {
  formatPeso, formatNumber, pad2, totalCombinations, formatDrawDate, formatWinners,
} from '../lib/format.js';

const COUNT_MIN = 1;
const COUNT_MAX = 10;
const COUNT_DEFAULT = 3;

const BALL_DROP_MS = 620; // matches the ball-drop animation in balls.css
const LANDING_POINT = 0.55; // the moment in the drop when the ball touches down
const BALL_STAGGER_MS = 90;
const PICK_STAGGER_MS = 260;
const REDUCED_MOTION_STAGGER_MS = 30;
const COUNTDOWN_TICK_MS = 1000;

function clampCount(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number)) {
    return COUNT_DEFAULT;
  }
  return Math.min(COUNT_MAX, Math.max(COUNT_MIN, number));
}

export function mountGenerateScreen(root, { api }) {
  const { fragment, refs } = cloneTemplate('tpl-generate');
  root.append(fragment);

  const state = {
    games: [],
    game: null,
    count: clampCount(readSetting('pickCount', COUNT_DEFAULT)),
    busy: false,
    chips: null,
    filters: null,
    coverageShare: null,
    countdownTimer: null,
    finishTimer: null,
  };

  function showEmptyPicks() {
    refs.picks.replaceChildren(cloneTemplate('tpl-empty-picks').fragment);
  }

  function renderCount() {
    refs.countValue.textContent = `${state.count} ${state.count === 1 ? 'pick' : 'picks'}`;
    refs.countDown.disabled = state.count <= COUNT_MIN;
    refs.countUp.disabled = state.count >= COUNT_MAX;
  }

  function renderCountdown() {
    if (!state.game) {
      return;
    }
    const draw = nextDraw(state.game);
    if (!draw) {
      refs.drawDay.textContent = 'No draw scheduled';
      refs.drawMeta.textContent = '';
      return;
    }
    const time = formatDrawTime(state.game.drawTime);
    let when = `${drawDayLabel(draw)} at ${time}`;
    if (draw.daysAway === 0) {
      when = `at ${time}`;
    } else if (draw.daysAway === 1) {
      when = `tomorrow at ${time}`;
    }
    refs.drawDay.textContent = drawDayLabel(draw);
    refs.drawMeta.textContent = `Next draw ${when} · in ${formatCountdown(draw.startsAt - new Date())}`;
  }

  function renderLastDraw(game) {
    const draw = game.lastDraw;
    if (!draw) {
      refs.lastBalls.replaceChildren();
      refs.jackpotAmount.textContent = '₱—';
      refs.jackpotAmount.dataset.value = '0';
      refs.lastDrawMeta.textContent = 'No results saved yet';
      return;
    }

    refs.lastBalls.replaceChildren(...draw.numbers.map((number) => createElement('span', 'ball ball--small', pad2(number))));
    refs.lastBalls.setAttribute('aria-label', `Last winning numbers: ${draw.numbers.join(', ')}`);

    if (draw.jackpotAmount === null) {
      refs.jackpotAmount.textContent = '₱—';
      refs.jackpotAmount.dataset.value = '0';
    } else {
      countUp(refs.jackpotAmount, Number(draw.jackpotAmount), { format: formatPeso });
    }

    const rollsOver = draw.winners === 0 ? ' (jackpot rolls over)' : '';
    refs.lastDrawMeta.textContent = `${formatDrawDate(draw.drawDate)} · ${formatWinners(draw.winners)}${rollsOver}`;
  }

  function renderFiltersSummary() {
    const changes = countChanges(state.game, state.filters);
    refs.filtersLabel.textContent = changes === 0
      ? 'Default filters'
      : `Custom filters · ${changes} ${changes === 1 ? 'change' : 'changes'}`;
    refs.filtersButton.classList.toggle('filters-button--custom', changes > 0);

    const total = formatNumber(totalCombinations(state.game.maxNumber));
    if (changes === 0) {
      refs.coverage.textContent = `Default filters keep ${Math.round(state.game.defaultCoverageShare * 100)}% of all ${total} combinations`;
    } else if (state.coverageShare === null) {
      refs.coverage.textContent = 'Generate to see how much of the combination space your filters keep';
    } else {
      refs.coverage.textContent = `Your filters keep ${(state.coverageShare * 100).toFixed(state.coverageShare < 0.1 ? 1 : 0)}% of all ${total} combinations`;
    }
  }

  function openFilters() {
    if (state.busy || !state.game) {
      return;
    }
    const game = state.game;
    openFilterSheet({
      game,
      settings: state.filters,
      api,
      opener: refs.filtersButton,
      onApply(settings) {
        state.filters = settings;
        state.coverageShare = null;
        saveFilters(game, settings);
        renderFiltersSummary();
        showEmptyPicks();
        showToast('Filters applied');
      },
    });
  }

  function renderChips(selectedCode) {
    state.chips = renderGameChips(refs.chips, state.games, { selectedCode, onSelect: selectGame });
  }

  function selectGame(code) {
    if (state.busy) {
      return;
    }
    const game = state.games.find((entry) => entry.code === code) || state.games[0];
    const changed = !state.game || state.game.code !== game.code;
    state.game = game;
    state.chips.setSelected(game.code);
    refs.jackpotLabel.textContent = `${game.name} · Last draw`;
    renderLastDraw(game);
    if (changed) {
      state.filters = loadFilters(game);
      state.coverageShare = null;
    }
    renderFiltersSummary();
    renderCountdown();

    if (changed) {
      showEmptyPicks();
    }
  }

  function buildPickCard(pick, pickIndex, staggers) {
    const { fragment, refs: cardRefs, root: card } = cloneTemplate('tpl-pick-card');
    const pickStart = pickIndex * staggers.pick;

    pick.numbers.forEach((number, ballIndex) => {
      const delay = pickStart + ballIndex * staggers.ball;
      const ball = createElement('span', 'ball ball--dropping', pad2(number));
      ball.style.setProperty('--delay', `${delay}ms`);
      cardRefs.balls.append(ball);
      playClick(delay + BALL_DROP_MS * LANDING_POINT);
    });

    const lastLanding = pickStart + (pick.numbers.length - 1) * staggers.ball + BALL_DROP_MS * LANDING_POINT;
    const { sum, oddCount, lowCount } = pick.pattern;
    const badges = [
      [`${lowCount} low · ${6 - lowCount} high`, false],
      [`${oddCount} odd · ${6 - oddCount} even`, false],
      [`Sum ${sum}`, false],
      ['Passes your filters', true],
    ];
    badges.forEach(([label, gold], badgeIndex) => {
      const badge = createElement('span', `badge badge--appear${gold ? ' badge--gold' : ''}`, label);
      badge.style.setProperty('--delay', `${Math.round(lastLanding + badgeIndex * 60)}ms`);
      cardRefs.badges.append(badge);
    });

    card.classList.add('pick-card--sparkle');
    card.style.setProperty('--sparkle-delay', `${Math.round(lastLanding + 120)}ms`);
    card.setAttribute('aria-label', `Pick ${pickIndex + 1}: ${pick.numbers.join(', ')}`);
    return { fragment, finishesAt: lastLanding + BALL_DROP_MS };
  }

  function renderPicks(picks) {
    const staggers = prefersReducedMotion()
      ? { pick: REDUCED_MOTION_STAGGER_MS * 6, ball: REDUCED_MOTION_STAGGER_MS }
      : { pick: PICK_STAGGER_MS, ball: BALL_STAGGER_MS };

    let finishesAt = 0;
    const cards = picks.map((pick, index) => {
      const built = buildPickCard(pick, index, staggers);
      finishesAt = Math.max(finishesAt, built.finishesAt);
      return built.fragment;
    });
    refs.picks.replaceChildren(...cards);
    playChime(finishesAt);
    return finishesAt;
  }

  function setBusy(busy) {
    state.busy = busy;
    refs.generateButton.setAttribute('aria-busy', String(busy));
    refs.generateLabel.textContent = busy ? 'Generating…' : 'Generate picks';
  }

  async function generate() {
    if (state.busy || !state.game) {
      return;
    }
    setBusy(true);
    vibrate(12);

    try {
      const result = await api.generatePicks({ gameCode: state.game.code, count: state.count, filters: state.filters });
      state.coverageShare = result.coverageShare;
      renderFiltersSummary();
      const finishesAt = renderPicks(result.picks);
      announce(`${result.picks.length} picks for ${state.game.name}: `
        + result.picks.map((pick) => pick.numbers.join(', ')).join('; '));
      state.finishTimer = window.setTimeout(() => setBusy(false), finishesAt);
    } catch (error) {
      showToast(error.isUserFacing ? error.message : "Couldn't generate picks. Check your connection and try again.");
      setBusy(false);
    }
  }

  refs.countDown.addEventListener('click', () => {
    state.count = clampCount(state.count - 1);
    writeSetting('pickCount', state.count);
    renderCount();
  });
  refs.countUp.addEventListener('click', () => {
    state.count = clampCount(state.count + 1);
    writeSetting('pickCount', state.count);
    renderCount();
  });
  refs.generateButton.addEventListener('click', generate);
  refs.filtersButton.addEventListener('click', openFilters);

  async function load() {
    refs.jackpotLabel.textContent = 'Loading games…';
    refs.jackpotAmount.textContent = '₱—';
    renderCount();
    showEmptyPicks();
    try {
      state.games = await api.fetchGames();
      const selectedCode = rememberedGameCode(state.games);
      renderChips(selectedCode);
      selectGame(selectedCode);
      state.countdownTimer = window.setInterval(renderCountdown, COUNTDOWN_TICK_MS);
    } catch (error) {
      refs.jackpotLabel.textContent = 'Games unavailable';
      showToast("Couldn't load the games. Refresh to try again.");
    }
  }

  load();

  return {
    destroy() {
      window.clearInterval(state.countdownTimer);
      window.clearTimeout(state.finishTimer);
    },
  };
}
