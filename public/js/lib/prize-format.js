/**
 * Prize wording shared by Results, Draw Night, My Picks and the results pop-up.
 * Amounts arrive as strings like "37500.00" (exact DECIMAL values from the server).
 */

import { createElement } from '../ui/dom.js';
import { formatNumber } from './format.js';

const pesoWhole = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
const pesoCents = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "37500.00" -> "₱37,500"; "487.63" -> "₱487.63" (centavos only when there are any). */
export function formatPrizeAmount(amount) {
  const value = Number(amount);
  return `₱${Number.isInteger(value) ? pesoWhole.format(value) : pesoCents.format(value)}`;
}

function winnersText(winners) {
  if (winners === 0) {
    return 'No winner';
  }
  return `${formatNumber(winners)} ${winners === 1 ? 'winner' : 'winners'}`;
}

/**
 * The 5/4/3-number breakdown as a small list.
 * @param {Array<{ matchCount, winners, prizeEach }>} prizes
 * @param {{ highlight?: number|null }} [options] - mark the tier the user's pick landed on
 * @returns {HTMLUListElement}
 */
export function prizeBreakdownList(prizes, { highlight = null } = {}) {
  const list = createElement('ul', 'prize-list');
  list.setAttribute('aria-label', 'Lower prizes');
  prizes.forEach((tier) => {
    const isYours = tier.matchCount === highlight;
    const item = createElement('li', `prize-list__row${isYours ? ' prize-list__row--yours' : ''}`);
    item.append(
      createElement('span', 'prize-list__tier', `${tier.matchCount} numbers${isYours ? ' (yours)' : ''}`),
      createElement('span', 'prize-list__winners', winnersText(tier.winners)),
      createElement('span', 'prize-list__amount', tier.prizeEach === null ? '—' : `${formatPrizeAmount(tier.prizeEach)} each`),
    );
    list.append(item);
  });
  return list;
}

/**
 * What a settled pick won, for one status line; '' when nothing (fewer than 3 matched).
 * @param {{ status: string, amount: string|null, winners: number|null } | null} prize
 */
export function prizeText(prize) {
  if (!prize) {
    return '';
  }
  switch (prize.status) {
    case 'jackpot':
      return 'JACKPOT';
    case 'pending':
      return 'prize amount not posted yet';
    case 'won':
      return prize.winners === null
        ? `won ${formatPrizeAmount(prize.amount)}`
        : `won ${formatPrizeAmount(prize.amount)} (${winnersText(prize.winners).toLowerCase()})`;
    default:
      return '';
  }
}
