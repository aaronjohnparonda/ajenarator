/**
 * "Lock in your pick" panel (native <dialog>, same sheet style as Filters).
 *
 *   - From the generator: opens on the confirm step with the generated numbers.
 *   - Manual: opens on a number grid; choose exactly 6, then review and confirm.
 *
 * Picks are final, so saving always goes through an explicit confirm step.
 * The server re-checks every rule (draw still open, one pick per draw, valid numbers).
 */

import { cloneTemplate, createElement } from './dom.js';
import { pad2, formatDrawDate } from '../lib/format.js';
import { formatManilaTime } from '../lib/pick-format.js';
import { playChime } from '../core/sound.js';
import { vibrate } from '../core/haptics.js';

const PICK_SIZE = 6;

/**
 * @param {object} options
 * @param {object} options.target - an entry from GET /picks/upcoming
 * @param {number[]} [options.numbers] - preset numbers (generator); omit for manual
 * @param {'generator'|'manual'} options.source
 * @param {object} options.api
 * @param {HTMLElement} [options.opener] - focus returns here
 * @param {(pick: object) => void} options.onSaved
 * @param {(error: Error) => void} [options.onClosedDraw] - draw closed meanwhile (refresh upcoming)
 */
export function openPickSheet({ target, numbers, source, api, opener, onSaved, onClosedDraw }) {
  const { fragment, refs, root: dialog } = cloneTemplate('tpl-pick-sheet');
  document.body.append(fragment);

  const isManual = source === 'manual';
  const chosen = new Set(isManual ? [] : numbers);
  let step = isManual ? 'choose' : 'confirm';
  let saving = false;

  refs.subtitle.textContent = `${target.gameName} · ${formatDrawDate(target.drawDate)} draw`;
  refs.drawText.textContent = `For the ${target.gameCode} draw on ${formatDrawDate(target.drawDate)} at ${formatManilaTime(new Date(target.drawAt))}`;
  refs.lockText.textContent = `Picks for this draw close at ${formatManilaTime(new Date(target.locksAt))}.`;

  const buttons = [];
  if (isManual) {
    for (let number = 1; number <= target.maxNumber; number += 1) {
      const button = createElement('button', 'number-chip', pad2(number));
      button.type = 'button';
      button.dataset.number = String(number);
      button.addEventListener('click', () => toggle(number));
      buttons.push(button);
    }
    refs.grid.replaceChildren(...buttons);
  }

  function sortedChoice() {
    return [...chosen].sort((a, b) => a - b);
  }

  function showError(message) {
    refs.error.textContent = message;
  }

  function toggle(number) {
    if (chosen.has(number)) {
      chosen.delete(number);
    } else if (chosen.size < PICK_SIZE) {
      chosen.add(number);
    } else {
      showError(`You already have ${PICK_SIZE}. Tap a gold number to remove it first.`);
      return;
    }
    showError('');
    render();
  }

  function render() {
    refs.chooseStep.hidden = step !== 'choose';
    refs.confirmStep.hidden = step !== 'confirm';

    if (step === 'choose') {
      buttons.forEach((button) => {
        const selected = chosen.has(Number(button.dataset.number));
        button.dataset.state = selected ? 'include' : 'none';
        button.setAttribute('aria-pressed', String(selected));
      });
      const remaining = PICK_SIZE - chosen.size;
      refs.count.textContent = remaining === 0
        ? 'All 6 chosen. Review your pick when ready.'
        : `${chosen.size} of 6 chosen. Pick ${remaining} more.`;
      refs.primary.textContent = 'Review pick';
      refs.primary.disabled = chosen.size !== PICK_SIZE;
      refs.back.textContent = 'Cancel';
    } else {
      refs.balls.replaceChildren(...sortedChoice().map((number) => createElement('span', 'ball', pad2(number))));
      refs.balls.setAttribute('aria-label', `Your pick: ${sortedChoice().join(', ')}`);
      refs.primary.textContent = saving ? 'Locking in…' : 'Lock in pick';
      refs.primary.disabled = saving;
      refs.back.textContent = isManual ? 'Back' : 'Cancel';
    }
    refs.primary.setAttribute('aria-busy', String(saving));
  }

  async function save() {
    if (saving) {
      return;
    }
    saving = true;
    showError('');
    render();
    try {
      const pick = await api.savePick({ gameCode: target.gameCode, drawDate: target.drawDate, numbers: sortedChoice(), source });
      playChime();
      vibrate(20);
      onSaved(pick);
      dialog.close();
    } catch (error) {
      saving = false;
      render();
      showError(error.isUserFacing ? error.message : "Couldn't save your pick. Check your connection and try again.");
      if (error.code === 'PICK_CLOSED' || error.code === 'PICK_EXISTS') {
        refs.primary.disabled = true;
        if (onClosedDraw) {
          onClosedDraw(error);
        }
      }
    }
  }

  refs.primary.addEventListener('click', () => {
    if (step === 'choose') {
      if (chosen.size === PICK_SIZE) {
        showError('');
        step = 'confirm';
        render();
        refs.primary.focus();
      }
      return;
    }
    save();
  });

  refs.back.addEventListener('click', () => {
    if (step === 'confirm' && isManual && !saving) {
      step = 'choose';
      showError('');
      render();
      return;
    }
    dialog.close();
  });

  refs.close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && !saving) {
      dialog.close();
    }
  });
  dialog.addEventListener('cancel', (event) => {
    if (saving) {
      event.preventDefault(); // don't close mid-save with Esc
    }
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener && opener.isConnected) {
      opener.focus();
    }
  });

  render();
  dialog.showModal();
}
