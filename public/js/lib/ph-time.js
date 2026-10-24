/**
 * Philippine-time helpers for the browser. Draw times are in Philippine time no matter where
 * the visitor's device is set, so everything here converts explicitly (no DST in the PH).
 */

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const MILLISECONDS_PER_DAY = 86400000;

/** { date: "YYYY-MM-DD", hour, minute, second } in Philippine time. */
export function manilaNow(now = new Date()) {
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function toUtcMilliseconds(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function addDays(isoDate, days) {
  return new Date(toUtcMilliseconds(isoDate) + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/** 1 = Monday ... 7 = Sunday */
export function isoWeekday(isoDate) {
  const weekday = new Date(toUtcMilliseconds(isoDate)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function greetingFor(now = new Date()) {
  const { hour } = manilaNow(now);
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 18) {
    return 'Good afternoon';
  }
  return 'Good evening';
}
