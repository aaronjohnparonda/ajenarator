/**
 * "Results are in" pop-up: shown once per visit when picks have new official results.
 * Dismissing it marks those results as seen on the server, so it won't show them again
 * on any device.
 */

import { cloneTemplate } from './dom.js';
import { pickBalls, pickStatusText } from '../lib/pick-format.js';
import { formatDrawDate, pad2 } from '../lib/format.js';
import { playChime } from '../core/sound.js';

let checkedForEmail = null;

function buildRow(pick) {
  const { fragment, refs } = cloneTemplate('tpl-history-row');
  refs.game.textContent = pick.gameName;
  refs.date.textContent = formatDrawDate(pick.drawDate);
  refs.balls.replaceChildren(...pickBalls(pick.numbers, pick.result.matched));
  refs.status.textContent = pickStatusText(pick);
  refs.status.classList.toggle('history-row__status--hit', pick.result.matchCount >= 3);
  refs.winning.textContent = `Winning: ${pick.result.numbers.map(pad2).join(' ')}`;
  return fragment;
}

/**
 * Checks for unseen results and shows them. Runs at most once per signed-in user per visit.
 * Failures are quiet: the results stay unseen and show next time.
 */
export async function showNewResults({ api, user, onDismissed }) {
  if (!user || checkedForEmail === user.email) {
    return;
  }
  checkedForEmail = user.email;

  let summary;
  try {
    summary = await api.fetchPickSummary();
  } catch {
    checkedForEmail = null;
    return;
  }
  const unseen = summary.unseen;
  if (unseen.length === 0) {
    return;
  }

  const { fragment, refs, root: dialog } = cloneTemplate('tpl-results-popup');
  document.body.append(fragment);

  const best = Math.max(...unseen.map((pick) => pick.result.matchCount));
  refs.intro.textContent = unseen.length === 1
    ? `Your pick for ${formatDrawDate(unseen[0].drawDate)} has its official result.`
    : `${unseen.length} of your picks have their official results.`;
  refs.list.replaceChildren(...unseen.map(buildRow));

  async function dismiss() {
    refs.done.disabled = true;
    try {
      await api.markPicksSeen(unseen.map((pick) => pick.id));
    } catch {
      // Not marked: it will simply show again next visit.
    }
    dialog.close();
  }

  refs.done.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (onDismissed) {
      onDismissed();
    }
  });

  dialog.showModal();
  if (best >= 3) {
    playChime(200);
  }
}

/** After sign-out, a later sign-in should check again. */
export function resetResultsCheck() {
  checkedForEmail = null;
}
