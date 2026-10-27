'use strict';

/**
 * Filter settings and checks. Pure functions: no database, no network.
 *
 * Defaults agreed in Phase 2 (backed by exact counts and 8,015 real draws):
 *   ON : no all-odd/all-even, no all-low/all-high, no 3+ consecutive (strict),
 *        at least 3 tens-groups, no 4 evenly spaced, sum inside the game's middle 90%,
 *        no repeat of a past winning combination
 *   OFF: max 2 sharing a last digit, anti-birthday (at least one number above 31)
 *   ON (added later): no 3 or more consecutive pairs, like 1-2-33-34-41-42
 *     (exact share of all combinations: 1.55% for 6/42 down to 0.60% for 6/58)
 *   NEVER: one or two consecutive pairs are fine (about half of all winners have one)
 *   ADDED (Oct 2026, measured on 1M random tickets per game):
 *     ON : no 4+ multiples of the same 5, 6 or 7 (e.g. 5-15-25-35)   ~1.4% of 6/42 tickets
 *     ON : no 4+ numbers repeated from the game's previous draw       ~0.18% of 6/42 tickets
 *     OFF: no 4+ numbers in one tens-group (e.g. 30-33-35-38)          ~7.8% of 6/42 tickets
 *   Rejected after measuring: 3 evenly spaced (50% of all tickets!), 2+ consecutive pairs (14%),
 *     all/no primes (9%), big gaps (7%), mirror pairs (0.1%), near-copies of past winners.
 * Plus user controls: numbers that must be included / must be excluded.
 */

const { describeCombination, sharedCount } = require('./patterns');
const { getGameDefaults, possibleSumRange, tensGroupCount } = require('./game-defaults');

const BIRTHDAY_MAX = 31;
const MAX_INCLUDED_NUMBERS = 5;
const CONSECUTIVE_LIMITS = Object.freeze({ strict: 2, relaxed: 3 }); // longest run allowed
const MAX_CONSECUTIVE_PAIRS = 2; // 3 or more pairs (e.g. 1-2-33-34-41-42) is removed
const MAX_SAME_MULTIPLE = 3; // 4+ multiples of the same 5, 6 or 7 is removed
const MAX_FROM_LAST_DRAW = 3; // 4+ numbers repeated from the previous draw is removed
const MAX_IN_ONE_DECADE = 3; // 4+ in one tens-group is removed (optional rule)

class FilterValidationError extends Error {
  constructor(problems) {
    super(`Invalid filter settings:\n  - ${problems.join('\n  - ')}`);
    this.name = 'FilterValidationError';
    this.problems = problems;
  }
}

/** Rule order here is the order failures are reported in. */
const RULES = Object.freeze([
  { key: 'oddEvenBalance', label: 'All odd or all even' },
  { key: 'lowHighBalance', label: 'All low or all high' },
  { key: 'consecutive', label: 'Too many consecutive numbers' },
  { key: 'consecutivePairs', label: '3 or more consecutive pairs' },
  { key: 'tensGroups', label: 'Too few tens-groups' },
  { key: 'crowdedDecade', label: '4 or more in one tens-group' },
  { key: 'sameMultiple', label: '4 or more multiples of 5, 6 or 7' },
  { key: 'lastDrawRepeat', label: '4 or more from the previous draw' },
  { key: 'evenlySpaced', label: '4 evenly spaced numbers' },
  { key: 'sumRange', label: 'Sum outside the chosen range' },
  { key: 'lastDigit', label: 'Too many sharing a last digit' },
  { key: 'antiBirthday', label: 'All numbers 31 or lower' },
  { key: 'pastWinners', label: 'Repeat of a past winning combination' },
  { key: 'includeNumbers', label: 'Missing a must-include number' },
  { key: 'excludeNumbers', label: 'Contains an excluded number' },
]);

function defaultFilters(game) {
  const { sumRange } = getGameDefaults(game.code);
  return {
    oddEvenBalance: { enabled: true },
    lowHighBalance: { enabled: true },
    consecutive: { enabled: true, mode: 'strict' },
    consecutivePairs: { enabled: true },
    tensGroups: { enabled: true, min: 3 },
    crowdedDecade: { enabled: false },
    sameMultiple: { enabled: true },
    lastDrawRepeat: { enabled: true },
    evenlySpaced: { enabled: true },
    sumRange: { enabled: true, min: sumRange.min, max: sumRange.max },
    lastDigit: { enabled: false, max: 2 },
    antiBirthday: { enabled: false },
    pastWinners: { enabled: true },
    includeNumbers: [],
    excludeNumbers: [],
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkInteger(value, label, min, max, problems) {
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${label} must be a whole number from ${min} to ${max}.`);
    return false;
  }
  return true;
}

function checkNumberList(list, label, game, problems) {
  if (!Array.isArray(list)) {
    problems.push(`${label} must be a list of numbers.`);
    return [];
  }
  const invalid = list.filter((number) => !Number.isInteger(number) || number < 1 || number > game.maxNumber);
  if (invalid.length > 0) {
    problems.push(`${label} must only contain whole numbers from 1 to ${game.maxNumber}.`);
    return [];
  }
  if (new Set(list).size !== list.length) {
    problems.push(`${label} contains a number more than once.`);
  }
  return [...new Set(list)].sort((a, b) => a - b);
}

/**
 * Merges user settings over the game's defaults and validates the result.
 * Unknown settings are rejected (no silent typos).
 * @returns {object} complete, validated filter settings
 * @throws {FilterValidationError}
 */
function resolveFilters(game, userSettings = {}) {
  if (!isPlainObject(userSettings)) {
    throw new FilterValidationError(['Filter settings must be an object.']);
  }

  const defaults = defaultFilters(game);
  const problems = [];
  const resolved = {};

  Object.keys(userSettings).forEach((key) => {
    if (!(key in defaults)) {
      problems.push(`Unknown filter "${key}".`);
    }
  });

  for (const [key, defaultValue] of Object.entries(defaults)) {
    const userValue = userSettings[key];
    if (Array.isArray(defaultValue)) {
      resolved[key] = userValue === undefined ? [] : checkNumberList(userValue, key, game, problems);
      continue;
    }
    if (userValue !== undefined && !isPlainObject(userValue)) {
      problems.push(`${key} must be an object like { "enabled": true }.`);
      resolved[key] = { ...defaultValue };
      continue;
    }
    const merged = { ...defaultValue, ...(userValue || {}) };
    const unknownFields = Object.keys(userValue || {}).filter((field) => !(field in defaultValue));
    unknownFields.forEach((field) => problems.push(`Unknown setting "${key}.${field}".`));
    if (typeof merged.enabled !== 'boolean') {
      problems.push(`${key}.enabled must be true or false.`);
    }
    resolved[key] = merged;
  }

  if (!(resolved.consecutive.mode in CONSECUTIVE_LIMITS)) {
    problems.push('consecutive.mode must be "strict" (no 3 in a row) or "relaxed" (no 4 in a row).');
  }
  checkInteger(resolved.tensGroups.min, 'tensGroups.min', 1, Math.min(6, tensGroupCount(game.maxNumber)), problems);
  checkInteger(resolved.lastDigit.max, 'lastDigit.max', 1, 6, problems);

  const possible = possibleSumRange(game.maxNumber);
  const minOk = checkInteger(resolved.sumRange.min, 'sumRange.min', possible.min, possible.max, problems);
  const maxOk = checkInteger(resolved.sumRange.max, 'sumRange.max', possible.min, possible.max, problems);
  if (minOk && maxOk && resolved.sumRange.min > resolved.sumRange.max) {
    problems.push('sumRange.min cannot be greater than sumRange.max.');
  }

  if (resolved.includeNumbers.length > MAX_INCLUDED_NUMBERS) {
    problems.push(`You can require at most ${MAX_INCLUDED_NUMBERS} numbers.`);
  }
  const overlap = resolved.includeNumbers.filter((number) => resolved.excludeNumbers.includes(number));
  if (overlap.length > 0) {
    problems.push(`A number cannot be both included and excluded: ${overlap.join(', ')}.`);
  }
  if (game.maxNumber - resolved.excludeNumbers.length < 6) {
    problems.push('Too many excluded numbers: at least 6 numbers must remain available.');
  }

  if (problems.length > 0) {
    throw new FilterValidationError(problems);
  }
  return resolved;
}

/**
 * Checks one combination against resolved filter settings.
 * @param {number[]} numbers - 6 unique numbers sorted ascending
 * @param {object} game - { code, maxNumber }
 * @param {object} filters - output of resolveFilters()
 * @param {Set<string>} [pastWinnerKeys] - past winning combinations as "1-2-3-4-5-6" strings
 * @param {number[]|null} [lastDrawNumbers] - the game's previous draw; without it the
 *   "from the previous draw" rule is skipped
 * @returns {{ passed: boolean, failedRules: string[] }}
 */
function checkCombination(numbers, game, filters, pastWinnerKeys = new Set(), lastDrawNumbers = null) {
  const pattern = describeCombination(numbers, game.maxNumber);
  const failed = [];

  if (filters.oddEvenBalance.enabled && (pattern.oddCount === 0 || pattern.oddCount === 6)) {
    failed.push('oddEvenBalance');
  }
  if (filters.lowHighBalance.enabled && (pattern.lowCount === 0 || pattern.lowCount === 6)) {
    failed.push('lowHighBalance');
  }
  if (filters.consecutive.enabled && pattern.longestRun > CONSECUTIVE_LIMITS[filters.consecutive.mode]) {
    failed.push('consecutive');
  }
  if (filters.consecutivePairs.enabled && pattern.consecutivePairs > MAX_CONSECUTIVE_PAIRS) {
    failed.push('consecutivePairs');
  }
  if (filters.tensGroups.enabled && pattern.decadeGroups < filters.tensGroups.min) {
    failed.push('tensGroups');
  }
  if (filters.crowdedDecade.enabled && pattern.maxInOneDecade > MAX_IN_ONE_DECADE) {
    failed.push('crowdedDecade');
  }
  if (filters.sameMultiple.enabled && pattern.maxSameMultiple > MAX_SAME_MULTIPLE) {
    failed.push('sameMultiple');
  }
  if (filters.lastDrawRepeat.enabled && lastDrawNumbers
    && sharedCount(numbers, lastDrawNumbers) > MAX_FROM_LAST_DRAW) {
    failed.push('lastDrawRepeat');
  }
  if (filters.evenlySpaced.enabled && pattern.hasEvenlySpacedFour) {
    failed.push('evenlySpaced');
  }
  if (filters.sumRange.enabled && (pattern.sum < filters.sumRange.min || pattern.sum > filters.sumRange.max)) {
    failed.push('sumRange');
  }
  if (filters.lastDigit.enabled && pattern.maxSameLastDigit > filters.lastDigit.max) {
    failed.push('lastDigit');
  }
  if (filters.antiBirthday.enabled && numbers[numbers.length - 1] <= BIRTHDAY_MAX) {
    failed.push('antiBirthday');
  }
  if (filters.pastWinners.enabled && pastWinnerKeys.has(numbers.join('-'))) {
    failed.push('pastWinners');
  }
  if (filters.includeNumbers.some((number) => !numbers.includes(number))) {
    failed.push('includeNumbers');
  }
  if (filters.excludeNumbers.some((number) => numbers.includes(number))) {
    failed.push('excludeNumbers');
  }

  return { passed: failed.length === 0, failedRules: failed };
}

module.exports = {
  RULES,
  defaultFilters,
  resolveFilters,
  checkCombination,
  FilterValidationError,
};
