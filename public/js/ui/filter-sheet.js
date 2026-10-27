/**
 * The filters panel: a native <dialog> (focus stays inside, Esc closes) styled as a bottom
 * sheet on phones and a side panel on desktop. Edits happen on a draft copy; nothing changes
 * until "Apply filters".
 */

import { cloneTemplate, createElement } from './dom.js';
import { defaultFiltersFor } from '../lib/filters-store.js';
import { formatNumber, formatPercent, pad2 } from '../lib/format.js';

const MAX_INCLUDED = 5;
const MIN_POSSIBLE_SUM = 21;
const TOP_REMOVED_RULES = 3;

const CONSECUTIVE_HINTS = {
  strict: 'Strict: no 3 or more in a row, like 7-8-9',
  relaxed: 'Relaxed: allows 3 in a row, blocks 4 or more',
};

const RULE_LABELS = {
  oddEvenBalance: 'All odd or all even',
  lowHighBalance: 'All low or all high',
  consecutive: 'Too many consecutive numbers',
  consecutivePairs: '3 or more consecutive pairs',
  tensGroups: 'Too few tens-groups',
  crowdedDecade: '4 or more in one tens-group',
  sameMultiple: '4 or more multiples of 5, 6 or 7',
  lastDrawRepeat: '4 or more from the previous draw',
  evenlySpaced: '4 evenly spaced numbers',
  sumRange: 'Sum outside the range',
  lastDigit: 'Too many sharing a last digit',
  antiBirthday: 'All numbers 31 or lower',
  pastWinners: 'Repeat of an earlier winner',
  includeNumbers: 'Missing a number you included',
  excludeNumbers: 'Contains a number you excluded',
};

const NUMBER_STATE_WORDS = { include: 'always included', exclude: 'excluded', none: 'not chosen' };

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {object} options
 * @param {object} options.game - from GET /games (with defaultFilters)
 * @param {object} options.settings - current filter settings
 * @param {object} options.api - API client (backtestFilters)
 * @param {HTMLElement} options.opener - focus returns here when the panel closes
 * @param {(settings: object) => void} options.onApply
 */
export function openFilterSheet({ game, settings, api, opener, onApply }) {
  const { fragment, refs, root: dialog } = cloneTemplate('tpl-filter-sheet');
  document.body.append(fragment);

  let draft = copy(settings);
  let backtestRequest = 0;
  const switches = [...dialog.querySelectorAll('input[data-rule]')];
  const modeRadios = [...refs.consecutiveMode.querySelectorAll('input[type="radio"]')];
  const maxPossibleSum = 6 * game.maxNumber - 15;
  const defaultSum = game.defaultFilters.sumRange;

  refs.gameName.textContent = game.name;
  refs.sumHint.textContent = `Typical for ${game.code}: ${defaultSum.min}–${defaultSum.max}, the middle 90% of all combinations`;
  [refs.sumMin, refs.sumMax].forEach((input) => {
    input.min = String(MIN_POSSIBLE_SUM);
    input.max = String(maxPossibleSum);
  });

  // Number picker: one button per number, tapping cycles none -> include -> exclude -> none.
  const numberButtons = [];
  for (let number = 1; number <= game.maxNumber; number += 1) {
    const button = createElement('button', 'number-chip', pad2(number));
    button.type = 'button';
    button.dataset.number = String(number);
    button.addEventListener('click', () => cycleNumber(number));
    numberButtons.push(button);
  }
  refs.numberGrid.replaceChildren(...numberButtons);

  function numberState(number) {
    if (draft.includeNumbers.includes(number)) {
      return 'include';
    }
    return draft.excludeNumbers.includes(number) ? 'exclude' : 'none';
  }

  function renderNumbers(notice = '') {
    numberButtons.forEach((button) => {
      const number = Number(button.dataset.number);
      const state = numberState(number);
      button.dataset.state = state;
      button.setAttribute('aria-label', `${number}: ${NUMBER_STATE_WORDS[state]}`);
    });
    const parts = [];
    if (draft.includeNumbers.length) {
      parts.push(`Always include ${[...draft.includeNumbers].sort((a, b) => a - b).join(', ')}`);
    }
    if (draft.excludeNumbers.length) {
      parts.push(`Exclude ${[...draft.excludeNumbers].sort((a, b) => a - b).join(', ')}`);
    }
    refs.numberSummary.textContent = notice || (parts.length ? parts.join(' · ') : 'No numbers chosen');
  }

  function cycleNumber(number) {
    const state = numberState(number);
    let notice = '';
    if (state === 'none') {
      if (draft.includeNumbers.length < MAX_INCLUDED) {
        draft.includeNumbers.push(number);
      } else {
        draft.excludeNumbers.push(number);
        notice = `You can include up to ${MAX_INCLUDED} numbers, so ${number} was excluded instead.`;
      }
    } else if (state === 'include') {
      draft.includeNumbers = draft.includeNumbers.filter((value) => value !== number);
      draft.excludeNumbers.push(number);
    } else {
      draft.excludeNumbers = draft.excludeNumbers.filter((value) => value !== number);
    }
    renderNumbers(notice);
    settingsChanged();
  }

  function render() {
    switches.forEach((input) => {
      input.checked = draft[input.dataset.rule].enabled;
    });
    modeRadios.forEach((radio) => {
      radio.checked = radio.value === draft.consecutive.mode;
      radio.disabled = !draft.consecutive.enabled;
    });
    refs.consecutiveMode.classList.toggle('segmented--disabled', !draft.consecutive.enabled);
    refs.consecutiveHint.textContent = CONSECUTIVE_HINTS[draft.consecutive.mode];
    refs.sumMin.value = String(draft.sumRange.min);
    refs.sumMax.value = String(draft.sumRange.max);
    refs.sumMin.disabled = !draft.sumRange.enabled;
    refs.sumMax.disabled = !draft.sumRange.enabled;
    refs.sumInputs.classList.toggle('range-inputs--disabled', !draft.sumRange.enabled);
    renderNumbers();
  }

  function showError(message) {
    refs.error.textContent = message;
  }

  /** Any change makes an earlier backtest result out of date. */
  function settingsChanged() {
    backtestRequest += 1;
    refs.backtestResult.replaceChildren();
    showError('');
  }

  function validate() {
    const { min, max } = draft.sumRange;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < MIN_POSSIBLE_SUM || max > maxPossibleSum) {
      return `Sum range must use whole numbers from ${MIN_POSSIBLE_SUM} to ${maxPossibleSum}.`;
    }
    if (min > max) {
      return 'The sum range "From" cannot be higher than "To".';
    }
    if (draft.includeNumbers.length > MAX_INCLUDED) {
      return `You can include up to ${MAX_INCLUDED} numbers.`;
    }
    if (game.maxNumber - draft.excludeNumbers.length < 6) {
      return 'Too many excluded numbers: at least 6 must stay available.';
    }
    return null;
  }

  function renderBacktest(result) {
    const { fragment: resultFragment, refs: resultRefs } = cloneTemplate('tpl-backtest-result');
    resultRefs.winnersValue.textContent = formatPercent(result.keptShareOfWinners, 1);
    resultRefs.allValue.textContent = formatPercent(result.keptShareOfAllCombinations, 1);
    resultRefs.winnersLabel.textContent = `of ${formatNumber(result.totalDraws)} past winners kept`;
    resultRefs.verdict.textContent = result.verdict;

    const removed = Object.entries(result.removedByRule).sort((a, b) => b[1] - a[1]).slice(0, TOP_REMOVED_RULES);
    resultRefs.removed.replaceChildren(...removed.map(([rule, count]) => createElement(
      'li', '', `${RULE_LABELS[rule] || rule}: removed ${formatNumber(count)} past ${count === 1 ? 'winner' : 'winners'}`,
    )));

    refs.backtestResult.replaceChildren(resultFragment);
    // Set the ring values on the next frame so they animate from empty.
    window.requestAnimationFrame(() => {
      resultRefs.winnersRing.style.setProperty('--ring', String(result.keptShareOfWinners));
      resultRefs.allRing.style.setProperty('--ring', String(result.keptShareOfAllCombinations));
    });
  }

  async function runBacktest() {
    const problem = validate();
    if (problem) {
      showError(problem);
      return;
    }
    showError('');
    const requestId = ++backtestRequest;
    refs.runBacktest.setAttribute('aria-busy', 'true');
    refs.runBacktest.textContent = 'Testing…';
    try {
      const result = await api.backtestFilters(game.code, draft);
      if (requestId === backtestRequest) {
        renderBacktest(result);
      }
    } catch (error) {
      if (requestId === backtestRequest) {
        showError(error.isUserFacing ? error.message : "Couldn't run the backtest. Try again.");
      }
    } finally {
      refs.runBacktest.removeAttribute('aria-busy');
      refs.runBacktest.textContent = 'Run backtest';
    }
  }

  switches.forEach((input) => {
    input.addEventListener('change', () => {
      draft[input.dataset.rule].enabled = input.checked;
      render();
      settingsChanged();
    });
  });
  modeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      draft.consecutive.mode = radio.value;
      render();
      settingsChanged();
    });
  });
  [['sumMin', 'min'], ['sumMax', 'max']].forEach(([ref, field]) => {
    refs[ref].addEventListener('input', () => {
      const value = refs[ref].value.trim();
      draft.sumRange[field] = /^\d{1,3}$/.test(value) ? Number(value) : Number.NaN;
      settingsChanged();
    });
  });

  refs.runBacktest.addEventListener('click', runBacktest);
  refs.reset.addEventListener('click', () => {
    draft = defaultFiltersFor(game);
    render();
    settingsChanged();
  });
  refs.close.addEventListener('click', () => dialog.close());
  refs.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      showError(problem);
      return;
    }
    onApply(copy(draft));
    dialog.close();
  });
  // Tapping the dimmed backdrop closes the panel.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    backtestRequest += 1;
    dialog.remove();
    if (opener) {
      opener.focus();
    }
  });

  render();
  dialog.showModal();
}
