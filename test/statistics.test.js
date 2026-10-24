'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStatistics, yearsBefore } = require('../src/engine/statistics');

const GAME = { maxNumber: 42 };

const draws = [
  { drawDate: '2020-05-02', numbers: [1, 2, 3, 4, 5, 6] }, // older than 3 years: gaps only
  { drawDate: '2024-01-02', numbers: [1, 10, 20, 30, 40, 42] },
  { drawDate: '2025-06-03', numbers: [1, 11, 21, 31, 41, 42] },
  { drawDate: '2026-10-22', numbers: [1, 12, 22, 32, 40, 41] },
];
const stats = computeStatistics({ game: GAME, draws, today: '2026-10-24' });

test('frequency only counts the past 3 years', () => {
  assert.equal(stats.frequency.windowStart, '2023-10-24');
  assert.equal(stats.frequency.drawCount, 3);
  const countOf = (number) => stats.frequency.numbers.find((entry) => entry.number === number).count;
  assert.equal(countOf(1), 3);
  assert.equal(countOf(2), 0); // only drawn in 2020
  assert.equal(countOf(42), 2);
  assert.equal(stats.frequency.numbers.length, 42);
});

test('gaps use the full history, including numbers not seen in 3 years', () => {
  const gapOf = (number) => stats.gaps.find((entry) => entry.number === number);
  assert.deepEqual(gapOf(1), { number: 1, drawsSinceLastSeen: 0, lastSeenDate: '2026-10-22' });
  assert.deepEqual(gapOf(42), { number: 42, drawsSinceLastSeen: 1, lastSeenDate: '2025-06-03' });
  assert.deepEqual(gapOf(2), { number: 2, drawsSinceLastSeen: 3, lastSeenDate: '2020-05-02' });
  assert.deepEqual(gapOf(7), { number: 7, drawsSinceLastSeen: null, lastSeenDate: null });
});

test('hot and cold come from the last 100 draws, 6 each', () => {
  assert.equal(stats.hotCold.drawCount, 4); // fewer than 100 available
  assert.equal(stats.hotCold.hot.length, 6);
  assert.deepEqual(stats.hotCold.hot[0], { number: 1, count: 4 });
  assert.equal(stats.hotCold.cold.length, 6);
  assert.ok(stats.hotCold.cold.every((entry) => entry.count === 0));
  assert.equal(stats.hotCold.cold[0].number, 7); // never drawn = longest absent, listed first
});

test('hot/cold window is limited to the most recent draws', () => {
  const many = Array.from({ length: 150 }, (_, index) => ({
    drawDate: `2026-${String(1 + Math.floor(index / 28)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}`,
    numbers: index < 50 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12],
  }));
  const result = computeStatistics({ game: GAME, draws: many, today: '2026-12-31' });
  assert.equal(result.hotCold.drawCount, 100);
  assert.ok(result.hotCold.hot.every((entry) => entry.number >= 7 && entry.number <= 12));
});

test('distributions describe the 3-year window', () => {
  const { distributions } = stats;
  assert.equal(distributions.drawCount, 3);
  assert.equal(distributions.oddEven.reduce((total, row) => total + row.count, 0), 3);
  assert.equal(distributions.sum.lowest, 143);
  assert.equal(distributions.sum.highest, 148);
  assert.equal(distributions.consecutivePairShare, 0.6667);
});

test('handles a game with no draws', () => {
  const empty = computeStatistics({ game: GAME, draws: [], today: '2026-10-24' });
  assert.equal(empty.totalDraws, 0);
  assert.equal(empty.distributions.sum.average, null);
  assert.equal(empty.gaps[0].drawsSinceLastSeen, null);
});

test('yearsBefore handles leap days', () => {
  assert.equal(yearsBefore('2024-02-29', 3), '2021-02-28');
  assert.equal(yearsBefore('2026-10-24', 3), '2023-10-24');
});
