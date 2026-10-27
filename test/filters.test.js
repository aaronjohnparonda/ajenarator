'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFilters, checkCombination, defaultFilters, FilterValidationError } = require('../src/engine/filters');

const GAME_42 = { code: '6/42', maxNumber: 42 };
const GAME_58 = { code: '6/58', maxNumber: 58 };
const defaults = resolveFilters(GAME_42);
const failures = (numbers, filters = defaults, winners) => checkCombination(numbers, GAME_42, filters, winners).failedRules;

test('defaults match the Phase 2 decisions', () => {
  const filters = defaultFilters(GAME_42);
  assert.equal(filters.consecutive.mode, 'strict');
  assert.deepEqual(filters.sumRange, { enabled: true, min: 83, max: 175 });
  assert.equal(filters.lastDigit.enabled, false);
  assert.equal(filters.antiBirthday.enabled, false);
  assert.equal(filters.pastWinners.enabled, true);
  assert.deepEqual(defaultFilters(GAME_58).sumRange, { enabled: true, min: 112, max: 242 });
});

test('a typical spread-out combination passes the defaults', () => {
  assert.deepEqual(failures([3, 11, 18, 27, 34, 41]), []);
});

test('a combination that looks balanced but is evenly spaced (every gap is 7) is removed', () => {
  assert.deepEqual(failures([5, 12, 19, 26, 33, 40]), ['evenlySpaced']);
});

test('each default rule catches its pattern', () => {
  assert.ok(failures([1, 3, 15, 27, 33, 41]).includes('oddEvenBalance'));
  assert.ok(failures([2, 8, 11, 15, 19, 21]).includes('lowHighBalance'));
  assert.ok(failures([5, 33, 37, 40, 41, 42]).includes('consecutive')); // real 6/42 winner, Jan 2 2025
  assert.ok(failures([21, 24, 27, 33, 35, 38]).includes('tensGroups'));
  assert.ok(failures([2, 9, 16, 23, 30, 41]).includes('evenlySpaced'));
  assert.ok(failures([1, 4, 7, 10, 15, 20]).includes('sumRange'));
  assert.ok(failures([3, 11, 18, 27, 34, 41], defaults, new Set(['3-11-18-27-34-41'])).includes('pastWinners'));
});

test('your two examples are removed, by more than one rule', () => {
  assert.ok(failures([1, 2, 3, 4, 5, 41]).includes('consecutive'));
  assert.ok(failures([1, 2, 3, 4, 5, 41]).includes('sumRange'));
  assert.ok(failures([1, 2, 3, 4, 20, 41]).includes('consecutive'));
  assert.ok(failures([1, 2, 3, 4, 20, 41]).includes('sumRange'));
});

test('consecutive pairs are never filtered', () => {
  assert.equal(failures([3, 14, 15, 27, 34, 41]).includes('consecutive'), false);
});

test('relaxed mode allows 3 in a row but blocks 4', () => {
  const relaxed = resolveFilters(GAME_42, { consecutive: { mode: 'relaxed' } });
  assert.equal(failures([5, 33, 37, 40, 41, 42], relaxed).includes('consecutive'), false);
  assert.ok(failures([5, 33, 39, 40, 41, 42], relaxed).includes('consecutive'));
});

test('optional rules only apply when turned on', () => {
  assert.equal(failures([3, 13, 23, 30, 36, 41]).includes('lastDigit'), false);
  const strict = resolveFilters(GAME_42, { lastDigit: { enabled: true }, antiBirthday: { enabled: true } });
  assert.ok(failures([3, 13, 23, 30, 36, 41], strict).includes('lastDigit'));
  assert.ok(failures([3, 9, 14, 20, 26, 31], strict).includes('antiBirthday'));
});

test('include and exclude numbers', () => {
  const custom = resolveFilters(GAME_42, { includeNumbers: [7], excludeNumbers: [13] });
  assert.ok(failures([3, 11, 18, 27, 34, 41], custom).includes('includeNumbers'));
  assert.ok(failures([7, 13, 18, 27, 34, 41], custom).includes('excludeNumbers'));
});

test('rejects bad settings with readable messages', () => {
  const cases = [
    [{ consecutive: { mode: 'loose' } }, /consecutive.mode/],
    [{ sumRange: { min: 200, max: 100 } }, /greater than/],
    [{ sumRange: { min: 5 } }, /sumRange.min/],
    [{ includeNumbers: [1, 2, 3, 4, 5, 6] }, /at most 5/],
    [{ includeNumbers: [7], excludeNumbers: [7] }, /both included and excluded/],
    [{ excludeNumbers: [43] }, /1 to 42/],
    [{ tensGroups: { min: 9 } }, /tensGroups.min/],
    [{ oddEven: { enabled: false } }, /Unknown filter/],
    [{ sumRange: { minimum: 90 } }, /Unknown setting/],
    [{ evenlySpaced: { enabled: 'yes' } }, /enabled must be true or false/],
  ];
  for (const [settings, message] of cases) {
    assert.throws(() => resolveFilters(GAME_42, settings), (error) => error instanceof FilterValidationError && message.test(error.message), JSON.stringify(settings));
  }
});

test('new rules: multiples of 5/6/7 and previous-draw repeats are on; crowded tens-group is off', () => {
  const game = { code: '6/42', maxNumber: 42 };
  const filters = resolveFilters(game);
  assert.equal(filters.sameMultiple.enabled, true);
  assert.equal(filters.lastDrawRepeat.enabled, true);
  assert.equal(filters.crowdedDecade.enabled, false);

  // 7-14-28-35 are four multiples of 7 (and not evenly spaced, so only this rule applies)
  assert.deepEqual(checkCombination([7, 14, 22, 28, 35, 41], game, filters).failedRules, ['sameMultiple']);

  const previous = [3, 11, 18, 27, 34, 41];
  assert.deepEqual(checkCombination([3, 11, 18, 27, 35, 40], game, filters, new Set(), previous).failedRules, ['lastDrawRepeat']);
  assert.equal(checkCombination([3, 11, 18, 26, 35, 40], game, filters, new Set(), previous).passed, true); // 3 shared is fine
  assert.equal(checkCombination([3, 11, 18, 27, 35, 40], game, filters).passed, true); // no previous draw known: rule skipped

  const crowded = [2, 12, 30, 33, 35, 38]; // four in the 30s
  assert.equal(checkCombination(crowded, game, filters).passed, true);
  const strict = resolveFilters(game, { crowdedDecade: { enabled: true } });
  assert.deepEqual(checkCombination(crowded, game, strict).failedRules, ['crowdedDecade']);
});
