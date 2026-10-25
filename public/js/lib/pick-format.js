/** Wording and ball rendering shared by My Picks, the generator and the results pop-up. */

import { createElement } from '../ui/dom.js';
import { pad2, formatDrawDate } from './format.js';

const manilaTime = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });

/** Date -> "8:00 PM" in Philippine time, whatever the device's time zone. */
export function formatManilaTime(date) {
  return manilaTime.format(date);
}

/**
 * Six small balls. With a result, matched numbers stay gold and misses are dimmed.
 * @param {number[]} numbers
 * @param {number[]|null} matched
 */
export function pickBalls(numbers, matched = null) {
  const hits = new Set(matched || []);
  return numbers.map((number) => {
    const isMiss = matched !== null && !hits.has(number);
    const ball = createElement('span', `ball ball--small${isMiss ? ' ball--miss' : ' ball--hit'}`, pad2(number));
    if (matched !== null) {
      ball.setAttribute('aria-label', `${number}${isMiss ? '' : ', matched'}`);
    }
    return ball;
  });
}

/** One line describing where a saved pick stands. */
export function pickStatusText(pick) {
  switch (pick.status) {
    case 'result':
      return `${pick.result.matchCount} of 6 matched`;
    case 'waiting':
      return 'Drawn. Waiting for the official result';
    case 'no_draw':
      return 'No draw was held that day';
    default:
      return `Draws ${formatDrawDate(pick.drawDate)} at 9:00 PM`;
  }
}
