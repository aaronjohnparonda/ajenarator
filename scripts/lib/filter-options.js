'use strict';

/**
 * Shared command-line options for the generate and backtest commands.
 *
 *   --game=6/42          which game (backtest: optional, default all games)
 *   --count=5            how many combinations (generate only, 1-10)
 *   --relaxed            consecutive rule allows 3 in a row (blocks 4+)
 *   --last-digit         turn on "max 2 sharing a last digit"
 *   --anti-birthday      turn on "at least one number above 31"
 *   --no-filters         turn every pattern filter off (to compare)
 *   --include=7,21       numbers that must appear
 *   --exclude=13,40      numbers that must not appear
 */

const NUMBER_LIST_PATTERN = /^\d{1,2}(,\d{1,2})*$/;
const PATTERN_FILTER_KEYS = [
  'oddEvenBalance', 'lowHighBalance', 'consecutive', 'tensGroups',
  'evenlySpaced', 'sumRange', 'lastDigit', 'antiBirthday', 'pastWinners',
];

function parseNumberList(value, name) {
  if (!NUMBER_LIST_PATTERN.test(value)) {
    throw new Error(`--${name} must be numbers separated by commas, e.g. --${name}=7,21`);
  }
  return value.split(',').map(Number);
}

function parseFilterOptions(argv, { allowCount = false } = {}) {
  const options = { gameCode: null, count: 5, filterSettings: {} };
  let disableAll = false;

  for (const argument of argv) {
    const [flag, value] = argument.includes('=') ? argument.split(/=(.*)/s) : [argument, undefined];

    switch (flag) {
      case '--game':
        options.gameCode = value;
        break;
      case '--count':
        if (!allowCount) {
          throw new Error('--count only applies to the generate command.');
        }
        options.count = Number(value);
        break;
      case '--relaxed':
        options.filterSettings.consecutive = { mode: 'relaxed' };
        break;
      case '--last-digit':
        options.filterSettings.lastDigit = { enabled: true };
        break;
      case '--anti-birthday':
        options.filterSettings.antiBirthday = { enabled: true };
        break;
      case '--no-filters':
        disableAll = true;
        break;
      case '--include':
        options.filterSettings.includeNumbers = parseNumberList(value || '', 'include');
        break;
      case '--exclude':
        options.filterSettings.excludeNumbers = parseNumberList(value || '', 'exclude');
        break;
      default:
        throw new Error(`Unknown option "${argument}".`);
    }
  }

  if (disableAll) {
    PATTERN_FILTER_KEYS.forEach((key) => {
      options.filterSettings[key] = { ...(options.filterSettings[key] || {}), enabled: false };
    });
  }
  return options;
}

module.exports = { parseFilterOptions };
