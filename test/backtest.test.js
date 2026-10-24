'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { resolveFilters } = require('../src/engine/filters');
const { runBacktest, wilsonInterval } = require('../src/engine/backtest');

const GAME = { code: '6/42', maxNumber: 42 };

function randomDraws(count) {
  const draws = [];
  for (let index = 0; index < count; index += 1) {
    const chosen = new Set();
    while (chosen.size < 6) {
      chosen.add(1 + crypto.randomInt(42));
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
