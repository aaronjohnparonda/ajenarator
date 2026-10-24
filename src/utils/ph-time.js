'use strict';

/**
 * Philippine-time date helpers.
 *
 * All draw dates are calendar dates in Philippine time, handled as "YYYY-MM-DD" strings.
 * Date math is done in UTC on those strings so the result never depends on the
 * time zone of the machine running the code (laptop, Render, or GitHub Actions).
 * The Philippines has no daylight saving time, so +08:00 is constant.
 */

const MANILA_TIME_ZONE = 'Asia/Manila';
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const manilaFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: MANILA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Current Philippine date ("2026-10-24") and time ("21:35"). */
function nowInManila(now = new Date()) {
  const parts = Object.fromEntries(manilaFormatter.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function toUtcMilliseconds(isoDate) {
  const match = ISO_DATE_PATTERN.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid date "${isoDate}". Expected YYYY-MM-DD.`);
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fromUtcMilliseconds(milliseconds) {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

/** True only for real calendar dates (rejects 2025-02-30). */
function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  return fromUtcMilliseconds(toUtcMilliseconds(value)) === value;
}

function addDays(isoDate, days) {
  return fromUtcMilliseconds(toUtcMilliseconds(isoDate) + days * MILLISECONDS_PER_DAY);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday (matches game_schedules.day_of_week). */
function isoWeekday(isoDate) {
  const weekday = new Date(toUtcMilliseconds(isoDate)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Every date from startDate to endDate, inclusive. */
function eachDate(startDate, endDate) {
  const dates = [];
  for (let current = startDate; current <= endDate; current = addDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

function yearOf(isoDate) {
  return Number(isoDate.slice(0, 4));
}

module.exports = {
  MANILA_TIME_ZONE,
  nowInManila,
  isValidIsoDate,
  addDays,
  isoWeekday,
  eachDate,
  yearOf,
};
