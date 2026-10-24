/**
 * Where is each game in its draw cycle right now? Used by the Home status board.
 *
 *   result    today's draw is saved
 *   tonight   drawn today, draw time not reached yet (countdown)
 *   waiting   drawn today, draw time passed, result not posted yet
 *   delayed   the most recent scheduled draw before today still has no result
 *             (usually a holiday with no draw, or PCSO posting late)
 *   upcoming  not drawn today; shows the next draw day
 */

import { manilaNow, addDays, isoWeekday } from './ph-time.js';
import { nextDraw, drawDayLabel, formatDrawTime } from './draw-schedule.js';

const LOOKBACK_DAYS = 7;

/** Most recent scheduled draw date strictly before today, or null. */
export function previousScheduledDate(game, today) {
  for (let daysBack = 1; daysBack <= LOOKBACK_DAYS; daysBack += 1) {
    const date = addDays(today, -daysBack);
    if (game.drawDays.includes(isoWeekday(date))) {
      return date;
    }
  }
  return null;
}

/**
 * @param {{ drawDays: number[], drawTime: string, lastDraw: { drawDate: string } | null }} game
 * @returns {{ state: string, label: string, countdownTo: Date | null, missingDate: string | null }}
 */
export function drawStatus(game, now = new Date()) {
  const { date: today } = manilaNow(now);
  const lastDate = game.lastDraw ? game.lastDraw.drawDate : null;
  const time = formatDrawTime(game.drawTime);

  if (game.drawDays.includes(isoWeekday(today))) {
    if (lastDate === today) {
      return { state: 'result', label: 'Result in', countdownTo: null, missingDate: null };
    }
    const drawStartsAt = new Date(`${today}T${game.drawTime}:00+08:00`);
    if (now < drawStartsAt) {
      return { state: 'tonight', label: `Tonight ${time}`, countdownTo: drawStartsAt, missingDate: null };
    }
    return { state: 'waiting', label: 'Waiting for results', countdownTo: null, missingDate: null };
  }

  const previous = previousScheduledDate(game, today);
  if (previous && (!lastDate || lastDate < previous)) {
    const next = nextDraw(game, now);
    return { state: 'delayed', label: 'Result delayed', countdownTo: next ? next.startsAt : null, missingDate: previous };
  }

  const next = nextDraw(game, now);
  return {
    state: 'upcoming',
    label: next ? `${drawDayLabel(next)} ${time}` : 'No draw scheduled',
    countdownTo: next ? next.startsAt : null,
    missingDate: null,
  };
}
