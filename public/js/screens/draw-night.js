/**
 * Draw Night: watch tonight's draws in the app.
 *
 *   Before 9 PM   countdown, empty ball slots, your locked-in pick.
 *   After 9 PM    "Drawing now": mystery balls bounce while AJenarator waits for the
 *                 official result (this page asks the server every 20 seconds).
 *   Result in     the six balls drop one by one IN THE ORDER PCSO DREW THEM; any ball that
 *                 matches your pick lights up gold, with a running count.
 *
 * Honest by design: the balls are revealed when the official result arrives (all six at once
 * from PCSO), not ball-by-ball live. The reveal plays once per device; "Replay" shows it again.
 *
 * Filter check: after each result, the server checks the official numbers against YOUR saved
 * filters for that game (as the generator would have that night) and the card says whether
 * your filters allowed it or blocked it, naming the rule.
 */

import { cloneTemplate, createElement, prefersReducedMotion } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { readSetting, writeSetting } from '../core/storage.js';
import { playClick, playChime } from '../core/sound.js';
import { vibrate } from '../core/haptics.js';
import { formatCountdown } from '../lib/draw-schedule.js';
import { formatDayHeading, formatPeso, formatWinners, pad2 } from '../lib/format.js';
import { formatManilaTime } from '../lib/pick-format.js';
import { loadFilters } from '../lib/filters-store.js';

const TICK_MS = 1000;
const POLL_WHILE_DRAWING_MS = 20 * 1000;
const POLL_BEFORE_DRAW_MS = 5 * 60 * 1000;
const REVEAL_STEP_MS = 1100;
const REVEAL_STEP_REDUCED_MS = 150;
const BALL_LANDING_MS = 340; // when the drop animation touches down (balls.css)
const REVEALED_KEY = 'revealedDraws';
const REVEALED_KEEP = 40;

function loadRevealed() {
  try {
    const parsed = JSON.parse(readSetting(REVEALED_KEY, '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function markRevealed(key) {
  const keys = loadRevealed().filter((entry) => entry !== key);
  keys.push(key);
  writeSetting(REVEALED_KEY, JSON.stringify(keys.slice(-REVEALED_KEEP)));
}

export function mountDrawNightScreen(root, { api }) {
  const { fragment, refs } = cloneTemplate('tpl-draw-night');
  root.append(fragment);

  const state = {
    night: null,
    stages: new Map(), // gameCode -> { refs, status, revealing }
    nextFetchAt: 0,
    lastCheckedAt: null,
    tickTimer: null,
    revealTimers: [],
    destroyed: false,
    fetching: false,
    gamesByCode: null, // from GET /games: default filters, needed to read this device's saved filters
  };

  // ---- Filter check: would my filters have allowed tonight's winning numbers? ----

  async function gameDefinitions() {
    if (!state.gamesByCode) {
      const games = await api.fetchGames();
      state.gamesByCode = new Map(games.map((entry) => [entry.code, entry]));
    }
    return state.gamesByCode;
  }

  function showFilterNote(stage, kind, title, detail) {
    const note = stage.refs.filterNote;
    note.hidden = false;
    note.className = `night-stage__filter night-stage__filter--${kind}`;
    stage.refs.filterTitle.textContent = title;
    stage.refs.filterDetail.textContent = detail;
  }

  async function checkFilters(stage, game) {
    const key = `${game.gameCode}|${game.drawDate}`;
    if (stage.filterCheckedFor === key) {
      stage.refs.filterNote.hidden = false;
      return;
    }
    stage.filterCheckedFor = key;
    try {
      const definition = (await gameDefinitions()).get(game.gameCode);
      if (!definition || state.destroyed) {
        return;
      }
      const check = await api.checkDraw(game.gameCode, { filters: loadFilters(definition), drawDate: game.drawDate });
      if (state.destroyed || stage.revealing) {
        stage.filterCheckedFor = null; // show it once the reveal finishes
        return;
      }
      if (check.allowed) {
        showFilterNote(stage, 'allowed', 'Your filters allowed this one', 'This winning combination passes your current filters, so the generator could have picked it.');
      } else {
        const rules = check.blockedBy.map((entry) => entry.label).join(' · ');
        showFilterNote(stage, 'blocked', 'Oh no! Your filters blocked this one', `Blocked by: ${rules}. The generator could not have picked it with your current filters.`);
      }
    } catch {
      stage.filterCheckedFor = null; // quietly try again next time; the result itself is unaffected
    }
  }

  function revealKey(game) {
    return `${game.gameCode}|${game.drawDate}`;
  }

  function setPill(stage, kind, label) {
    stage.refs.pill.className = `status-pill status-pill--${kind}`;
    stage.refs.pillLabel.textContent = label;
  }

  function renderPick(stage, game, matched = new Set()) {
    const { pickRow, pickBalls, pickCta } = stage.refs;
    if (game.pick) {
      pickRow.hidden = false;
      pickCta.hidden = true;
      pickBalls.replaceChildren(...game.pick.numbers.map((number) => {
        const ball = createElement('span', `ball ball--small${matched.has(number) ? ' ball--hit' : ' ball--pending'}`, pad2(number));
        ball.dataset.number = String(number);
        return ball;
      }));
    } else {
      pickRow.hidden = true;
      // Only the owner can lock in picks; visitors just watch.
      pickCta.hidden = !(state.night && state.night.signedIn) || game.status !== 'upcoming';
    }
  }

  function slots(className, label) {
    return Array.from({ length: 6 }, (unused, index) => {
      const slot = createElement('span', `ball night-ball ${className}`, label);
      slot.style.setProperty('--i', String(index));
      slot.setAttribute('aria-hidden', 'true');
      return slot;
    });
  }

  function renderUpcoming(stage, game) {
    setPill(stage, 'tonight', 'Tonight');
    stage.refs.status.textContent = `Draw at ${formatManilaTime(new Date(game.drawAt))}`;
    stage.refs.countdown.hidden = false;
    stage.refs.balls.replaceChildren(...slots('night-ball--empty', ''));
    stage.refs.summary.textContent = '';
    stage.refs.replay.hidden = true;
    renderPick(stage, game);
  }

  function renderDrawing(stage, game) {
    setPill(stage, 'waiting', 'Drawing now');
    const checked = state.lastCheckedAt ? ` · updated ${formatManilaTime(state.lastCheckedAt)}` : '';
    stage.refs.status.textContent = `Waiting for the official result${checked}`;
    stage.refs.countdown.hidden = true;
    if (!stage.refs.balls.querySelector('.night-ball--mystery')) {
      stage.refs.balls.replaceChildren(...slots('night-ball--mystery', '?'));
    }
    stage.refs.summary.textContent = 'Balls appear here the moment the official numbers are in.';
    stage.refs.replay.hidden = true;
    renderPick(stage, game);
  }

  function summaryText(game, matchCount) {
    const prize = game.result.jackpotAmount === null ? '' : `Jackpot ${formatPeso(game.result.jackpotAmount)} · `;
    const winners = formatWinners(game.result.winners);
    if (game.pick) {
      return `${matchCount} of 6 matched · ${prize}${winners}`;
    }
    return `${prize}${winners}`;
  }

  function renderResultStatic(stage, game) {
    setPill(stage, 'result', 'Official result');
    stage.refs.status.textContent = 'In the order PCSO drew them';
    stage.refs.countdown.hidden = true;
    const pickSet = new Set(game.pick ? game.pick.numbers : []);
    const matched = new Set(game.result.order.filter((number) => pickSet.has(number)));
    stage.refs.balls.replaceChildren(...game.result.order.map((number) => createElement(
      'span', `ball night-ball${matched.has(number) ? ' night-ball--match' : ''}`, pad2(number),
    )));
    stage.refs.balls.setAttribute('aria-label', `Winning numbers in draw order: ${game.result.order.join(', ')}`);
    stage.refs.summary.textContent = summaryText(game, matched.size);
    stage.refs.summary.classList.toggle('night-stage__summary--hit', matched.size >= 3);
    stage.refs.replay.hidden = false;
    renderPick(stage, game, matched);
    checkFilters(stage, game);
  }

  function reveal(stage, game) {
    stage.revealing = true;
    setPill(stage, 'result', 'Revealing…');
    stage.refs.status.textContent = 'Official numbers are in!';
    stage.refs.countdown.hidden = true;
    stage.refs.replay.hidden = true;
    stage.refs.filterNote.hidden = true; // revealed again after the last ball
    stage.refs.summary.classList.remove('night-stage__summary--hit');

    const step = prefersReducedMotion() ? REVEAL_STEP_REDUCED_MS : REVEAL_STEP_MS;
    const pickSet = new Set(game.pick ? game.pick.numbers : []);
    const matched = new Set();
    const mystery = slots('night-ball--mystery', '?');
    stage.refs.balls.replaceChildren(...mystery);
    renderPick(stage, game);

    game.result.order.forEach((number, index) => {
      const timer = window.setTimeout(() => {
        if (state.destroyed) {
          return;
        }
        const isMatch = pickSet.has(number);
        const ball = createElement('span', `ball night-ball ball--dropping${isMatch ? ' night-ball--match' : ''}`, pad2(number));
        ball.style.setProperty('--delay', '0ms');
        mystery[index].replaceWith(ball);
        mystery[index] = ball;
        playClick(BALL_LANDING_MS);
        if (isMatch) {
          matched.add(number);
          vibrate(25);
          const chip = stage.refs.pickBalls.querySelector(`[data-number="${number}"]`);
          if (chip) {
            chip.classList.remove('ball--pending');
            chip.classList.add('ball--hit', 'ball--hit-pop');
          }
        }
        stage.refs.summary.textContent = game.pick
          ? `Ball ${index + 1} of 6 · ${matched.size} matched so far`
          : `Ball ${index + 1} of 6`;
      }, step * (index + 1));
      state.revealTimers.push(timer);
    });

    const finish = window.setTimeout(() => {
      if (state.destroyed) {
        return;
      }
      stage.revealing = false;
      markRevealed(revealKey(game));
      renderResultStatic(stage, game);
      playChime();
    }, step * (game.result.order.length + 1));
    state.revealTimers.push(finish);
  }

  function buildStage(game) {
    const { fragment: stageFragment, refs: stageRefs } = cloneTemplate('tpl-night-stage');
    stageRefs.game.textContent = game.gameName;
    const stage = { refs: stageRefs, status: null, revealing: false, game };
    stageRefs.replay.addEventListener('click', () => {
      if (!stage.revealing && stage.game.result) {
        reveal(stage, stage.game);
      }
    });
    return { stage, fragment: stageFragment };
  }

  function applyGame(stage, game) {
    const previous = stage.status;
    stage.game = game;
    stage.status = game.status;
    if (stage.revealing) {
      return;
    }
    if (game.status === 'result') {
      const alreadySeen = loadRevealed().includes(revealKey(game));
      if (!alreadySeen) {
        if (previous && previous !== 'result') {
          showToast(`${game.gameName}: official numbers are in!`);
        }
        reveal(stage, game);
      } else {
        renderResultStatic(stage, game);
      }
    } else if (game.status === 'drawing') {
      renderDrawing(stage, game);
    } else {
      renderUpcoming(stage, game);
    }
  }

  function render(night) {
    state.night = night;
    refs.date.textContent = formatDayHeading(night.nightDate);
    if (night.games.length === 0) {
      refs.stages.replaceChildren(createElement('p', 'empty-state__text', 'No draws tonight.'));
      return;
    }
    const codes = night.games.map((game) => game.gameCode).join('|');
    if (codes !== [...state.stages.keys()].join('|')) {
      state.stages.clear();
      const fragments = night.games.map((game) => {
        const built = buildStage(game);
        state.stages.set(game.gameCode, built.stage);
        return built.fragment;
      });
      refs.stages.replaceChildren(...fragments);
    }
    night.games.forEach((game) => applyGame(state.stages.get(game.gameCode), game));
  }

  function scheduleNextFetch() {
    const games = state.night ? state.night.games : [];
    if (games.some((game) => game.status === 'drawing')) {
      state.nextFetchAt = Date.now() + POLL_WHILE_DRAWING_MS;
    } else if (games.some((game) => game.status === 'upcoming')) {
      state.nextFetchAt = Date.now() + POLL_BEFORE_DRAW_MS;
    } else {
      state.nextFetchAt = Infinity; // everything is in
    }
  }

  async function load() {
    if (state.fetching || state.destroyed) {
      return;
    }
    state.fetching = true;
    try {
      const night = await api.fetchDrawNight();
      state.lastCheckedAt = new Date();
      if (!state.destroyed) {
        render(night);
      }
    } catch (error) {
      if (!state.night) {
        refs.stages.replaceChildren(createElement('p', 'empty-state__text', "Couldn't load tonight's draws. Check your connection."));
      }
    } finally {
      state.fetching = false;
      scheduleNextFetch();
    }
  }

  function tick() {
    const now = Date.now();
    state.stages.forEach((stage) => {
      const { game } = stage;
      if (game && game.status === 'upcoming') {
        const drawAt = new Date(game.drawAt).getTime();
        if (now >= drawAt) {
          game.status = 'drawing'; // 9 PM passed: switch right away, then confirm with the server
          applyGame(stage, game);
          state.nextFetchAt = now;
        } else {
          stage.refs.countdown.textContent = formatCountdown(drawAt - now);
        }
      }
    });
    if (now >= state.nextFetchAt) {
      load();
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      load();
    }
  }

  refs.stages.replaceChildren(cloneTemplate('tpl-skeleton').fragment);
  load();
  state.tickTimer = window.setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    destroy() {
      state.destroyed = true;
      window.clearInterval(state.tickTimer);
      state.revealTimers.forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
