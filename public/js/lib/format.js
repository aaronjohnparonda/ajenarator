const wholePeso = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
const wholeNumber = new Intl.NumberFormat('en-US');
// Draw dates are calendar dates ("2026-10-23"); format them in UTC so no time zone can shift the day.
const shortDate = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

const longDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const fullWeekdayDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
});

/** "2026-10-23" -> "Fri, Oct 23" */
export function formatDrawDate(isoDate) {
  return shortDate.format(new Date(`${isoDate}T00:00:00Z`));
}

/** "2026-10-23" -> "Fri, Oct 23, 2026" */
export function formatDrawDateLong(isoDate) {
  return longDate.format(new Date(`${isoDate}T00:00:00Z`));
}

/** "2026-10-24" -> "Saturday, October 24" */
export function formatDayHeading(isoDate) {
  return fullWeekdayDate.format(new Date(`${isoDate}T00:00:00Z`));
}

/** 0.5123 -> "51%" */
export function formatPercent(share, decimals = 0) {
  return `${(share * 100).toFixed(decimals)}%`;
}

/** 0 -> "No jackpot winner", 1 -> "1 jackpot winner", 3 -> "3 jackpot winners" */
export function formatWinners(winners) {
  if (winners === null || winners === undefined) {
    return 'Winners not published';
  }
  if (winners === 0) {
    return 'No jackpot winner';
  }
  return `${winners} jackpot ${winners === 1 ? 'winner' : 'winners'}`;
}

/** 430857884.28 -> "₱430,857,884" */
export function formatPeso(amount) {
  return `₱${wholePeso.format(Math.round(Number(amount)))}`;
}

export function formatNumber(value) {
  return wholeNumber.format(value);
}

/** 7 -> "07" */
export function pad2(number) {
  return String(number).padStart(2, '0');
}

/** Exact number of 6-number combinations for numbers 1..maxNumber. */
export function totalCombinations(maxNumber) {
  let result = 1;
  for (let index = 0; index < 6; index += 1) {
    result = (result * (maxNumber - index)) / (index + 1);
  }
  return Math.round(result);
}
