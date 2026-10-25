'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFilters } = require('../src/engine/filters');
const { runBacktest, wilsonInterval } = require('../src/engine/backtest');

const GAME = { code: '6/42', maxNumber: 42 };

/**
 * Small seeded random generator (mulberry32), so the "random" draws are the same on every run.
 * Truly random draws made this test fail about 1 run in 20: the verdict uses a 95% confidence
 * range, so 5% of honest random histories land outside it by chance. That is expected
 * statistics, not a bug, but a test must not depend on luck.
 */
function seededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDraws(count, seed = 20261025) {
  const random = seededRandom(seed);
  const draws = [];
  for (let index = 0; index < count; index += 1) {
    const chosen = new Set();
    while (chosen.size < 6) {
      chosen.add(1 + Math.floor(random() * 42));
    }
    const day = new Date(Date.UTC(2016, 0, 1) + index * 86400000).toISOString().slice(0, 10);
    draws.push({ drawDate: day, numbers: [...chosen].sort((a, b) => a - b) });
  }
  return draws;
}

test('random draws show no edge: kept share of winners matches kept share of all combinations', () => {
  const result = runBacktest({ game: GAME, filters: resolveFilters(GAME), draws: randomDraws(3000), coverage: { keptShare: 0.796 } });
  assert.equal(result.totalDraws, 3000);
  assert.ok(Math.abs(result.keptShareOfWinners - 0.796) < 0.04);
  assert.match(result.verdict, /^No edge/);
});

test('seeded draws are repeatable and use every number fairly', () => {
  assert.deepEqual(randomDraws(50), randomDraws(50));
  const counts = new Array(43).fill(0);
  randomDraws(3000).forEach((draw) => draw.numbers.forEach((number) => { counts[number] += 1; }));
  const expected = (3000 * 6) / 42;
  counts.slice(1).forEach((count) => assert.ok(Math.abs(count - expected) < expected * 0.15));
});

test('a repeated winner is only compared with EARLIER draws', () => {
  const filters = resolveFilters(GAME);
  const draws = [
    { drawDate: '2020-01-02', numbers: [3, 11, 18, 27, 34, 41] },
    { drawDate: '2020-01-04', numbers: [3, 11, 18, 27, 34, 41] },
  ];
  const result = runBacktest({ game: GAME, filters, draws, coverage: { keptShare: 0.8 } });
  assert.equal(result.keptDraws, 1); // first occurrence kept, the repeat removed
  assert.deepEqual(result.removedByRule, { pastWinners: 1 });
});

test('counts which rules removed past winners', () => {
  const draws = [
    { drawDate: '2025-01-02', numbers: [5, 33, 37, 40, 41, 42] }, // 3 in a row
    { drawDate: '2025-01-04', numbers: [3, 11, 18, 27, 34, 41] }, // passes
  ];
  const result = runBacktest({ game: GAME, filters: resolveFilters(GAME), draws, coverage: { keptShare: 0.8 } });
  assert.equal(result.removedDraws, 1);
  assert.equal(result.removedByRule.consecutive, 1);
  assert.equal(result.removedExamples[0].drawDate, '2025-01-02');
});

test('handles a game with no draws yet', () => {
  const result = runBacktest({ game: GAME, filters: resolveFilters(GAME), draws: [], coverage: { keptShare: 0.8 } });
  assert.equal(result.totalDraws, 0);
  assert.match(result.verdict, /No past draws/);
});

test('wilson interval behaves at the edges', () => {
  assert.deepEqual(wilsonInterval(0, 0), { low: 0, high: 0 });
  const range = wilsonInterval(80, 100);
  assert.ok(range.low < 0.8 && range.high > 0.8);
});
