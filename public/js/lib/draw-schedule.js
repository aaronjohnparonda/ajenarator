/** When is a game's next draw, and how do we describe it? */

import { manilaNow, addDays, isoWeekday } from './ph-time.js';

const SHORT_WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * @param {{ drawDays: number[], drawTime: string }} game - drawDays as ISO weekdays, drawTime "HH:MM" (PH time)
 * @returns {{ date: string, startsAt: Date, daysAway: number } | null}
 */
export function nextDraw(game, now = new Date()) {
  const { date: today } = manilaNow(now);
  for (let daysAway = 0; daysAway <= 7; daysAway += 1) {
    const date = addDays(today, daysAway);
    if (game.drawDays.includes(isoWeekday(date))) {
      const startsAt = new Date(`${date}T${game.drawTime}:00+08:00`);
      if (startsAt > now) {
        return { date, startsAt, daysAway };
      }
    }
  }
  return null;
}

/** "Tonight", "Tomorrow" or a short weekday name. */
export function drawDayLabel(draw) {
  if (draw.daysAway === 0) {
    return 'Tonight';
  }
  if (draw.daysAway === 1) {
    return 'Tomorrow';
  }
  return SHORT_WEEKDAYS[isoWeekday(draw.date)];
}

/** "21:00" -> "9:00 PM" */
export function formatDrawTime(drawTime) {
  const [hour, minute] = drawTime.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** Under a day: "05:42:18". A day or more: "1d 04h". */
export function formatCountdown(milliseconds) {
  const remaining = Math.max(0, milliseconds);
  const pad = (value) => String(value).padStart(2, '0');
  if (remaining >= DAY) {
    return `${Math.floor(remaining / DAY)}d ${pad(Math.floor((remaining % DAY) / HOUR))}h`;
  }
  return `${pad(Math.floor(remaining / HOUR))}:${pad(Math.floor((remaining % HOUR) / MINUTE))}:${pad(Math.floor((remaining % MINUTE) / SECOND))}`;
}
