'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFilters, checkCombination } = require('../src/engine/filters');
const { generateCombinations, ImpossibleFiltersError } = require('../src/engine/generator');
const { estimateCoverage } = require('../src/engine/coverage');

const GAMES = [
  // Exact shares counted over every combination (5,245,786 and 40,475,358) with the default
  // filters as of Oct 2026 (includes the "4+ multiples of 5, 6 or 7" rule).
  { code: '6/42', maxNumber: 42, exactRemovedShare: 0.2158 },
  { code: '6/58', maxNumber: 58, exactRemovedShare: 0.1742 },
];

test('every generated combination is valid, unique, sorted and passes the filters', () => {
  for (const game of GAMES) {
    const filters = resolveFilters(game);
    const { combinations } = generateCombinations({ game, filters, count: 10 });
    assert.equal(combinations.length, 10);
    assert.equal(new Set(combinations.map((numbers) => numbers.join('-'))).size, 10);
    for (const numbers of combinations) {
      assert.equal(numbers.length, 6);
      assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
      assert.ok(numbers.every((number) => number >= 1 && number <= game.maxNumber));
      assert.equal(checkCombination(numbers, game, filters).passed, true);
    }
  }
});

test('must-include numbers always appear and excluded numbers never do', () => {
  const game = GAMES[0];
  const filters = resolveFilters(game, { includeNumbers: [7, 21], excludeNumbers: [13, 40] });
  const { combinations } = generateCombinations({ game, filters, count: 10 });
  for (const numbers of combinations) {
    assert.ok(numbers.includes(7) && numbers.includes(21));
    assert.ok(!numbers.includes(13) && !numbers.includes(40));
  }
});

test('never suggests a past winning combination', () => {
  const game = GAMES[0];
  const filters = resolveFilters(game, { includeNumbers: [3, 11, 18, 27, 34] });
  const pastWinnerKeys = new Set(['3-11-18-27-34-41']);
  const { combinations } = generateCombinations({ game, filters, count: 5, pastWinnerKeys });
  assert.ok(combinations.every((numbers) => numbers.join('-') !== '3-11-18-27-34-41'));
});

test('impossible filters stop with an explanation instead of running forever', () => {
  const game = GAMES[0];
  const filters = resolveFilters(game, { sumRange: { min: 21, max: 22 } });
  assert.throws(() => generateCombinations({ game, filters, count: 1, maxAttempts: 2000 }), ImpossibleFiltersError);
});

test('rejects a count outside 1-10', () => {
  const game = GAMES[0];
  assert.throws(() => generateCombinations({ game, filters: resolveFilters(game), count: 11 }), /1 to 10/);
  assert.throws(() => generateCombinations({ game, filters: resolveFilters(game), count: 0 }), /1 to 10/);
});

test('coverage estimate matches the exact count of all combinations (default filters)', () => {
  for (const game of GAMES) {
    const coverage = estimateCoverage({ game, filters: resolveFilters(game), sampleSize: 100000 });
    const removed = 1 - coverage.keptShare;
    assert.ok(Math.abs(removed - game.exactRemovedShare) < 0.01, `${game.code}: estimated ${removed}, exact ${game.exactRemovedShare}`);
  }
});
