'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGameMatcher, parsePcsoDate, parseMoney, parseWinners, normalizeRow,
} = require('../src/fetcher/normalize-draw');

const GAMES = [
  { id: 1, code: '6/42', maxNumber: 42, pickCount: 6, drawDays: new Set([2, 4, 6]) },
  { id: 2, code: '6/45', maxNumber: 45, pickCount: 6, drawDays: new Set([1, 3, 5]) },
  { id: 3, code: '6/49', maxNumber: 49, pickCount: 6, drawDays: new Set([2, 4, 7]) },
  { id: 4, code: '6/55', maxNumber: 55, pickCount: 6, drawDays: new Set([1, 3, 6]) },
  { id: 5, code: '6/58', maxNumber: 58, pickCount: 6, drawDays: new Set([2, 5, 7]) },
];
const matchGame = createGameMatcher(GAMES);

const row = (overrides) => ({
  gameName: 'Lotto 6/42', combination: '37-41-05-33-42-40', drawDate: '1/2/2025', jackpot: '5,940,000.00', winners: '0', ...overrides,
});

test('matches both PCSO spellings of the same game, and ignores games we do not track', () => {
  assert.equal(matchGame('Megalotto 6/45').id, 2);
  assert.equal(matchGame('Mega Lotto 6/45').id, 2);
  assert.equal(matchGame('Superlotto 6/49').id, 3);
  assert.equal(matchGame('4D Lotto'), null);
  assert.equal(matchGame('3D Lotto 9PM'), null);
});

test('parses PCSO dates, money and winners', () => {
  assert.equal(parsePcsoDate('1/2/2025'), '2025-01-02');
  assert.equal(parsePcsoDate('12/31/2016'), '2016-12-31');
  assert.equal(parsePcsoDate('2/30/2025'), null);
  assert.equal(parsePcsoDate('2025-01-02'), null);
  assert.equal(parseMoney('430,857,884.28'), '430857884.28');
  assert.equal(parseMoney('15,000,000.00'), '15000000.00');
  assert.equal(parseMoney('-'), null);
  assert.equal(parseWinners('3'), 3);
  assert.equal(parseWinners(''), null);
});

test('a valid row becomes a sorted draw that keeps the published order', () => {
  const result = normalizeRow(row(), matchGame);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.draw, {
    gameId: 1,
    gameCode: '6/42',
    drawDate: '2025-01-02',
    numbers: [5, 33, 37, 40, 41, 42],
    drawOrder: '37-41-05-33-42-40',
    jackpotAmount: '5940000.00',
    winners: 0,
    offSchedule: false,
  });
});

test('other PCSO games are ignored, not treated as errors', () => {
  assert.deepEqual(normalizeRow(row({ gameName: '4D Lotto', combination: '4-1-7-0' }), matchGame), { status: 'ignored' });
});

test('rejects bad combinations with a clear reason', () => {
  const reasons = [
    ['1-2-3-4-5', 'expected 6 numbers'],
    ['1-2-3-4-5-43', 'outside 1-42'],
    ['0-2-3-4-5-6', 'outside 1-42'],
    ['1-2-3-4-5-5', 'more than once'],
    ['1-2-3-4-5-x', 'non-number'],
  ];
  for (const [combination, expected] of reasons) {
    const result = normalizeRow(row({ combination }), matchGame);
    assert.equal(result.status, 'invalid', combination);
    assert.match(result.reason, new RegExp(expected), combination);
  }
});

test('rejects an unreadable date', () => {
  assert.equal(normalizeRow(row({ drawDate: '13/45/2025' }), matchGame).status, 'invalid');
});

test('flags (but keeps) a draw on a day the game is not normally drawn', () => {
  const result = normalizeRow(row({ drawDate: '1/3/2025' }), matchGame); // a Friday; 6/42 is Tue/Thu/Sat
  assert.equal(result.status, 'ok');
  assert.equal(result.draw.offSchedule, true);
});

test('unknown jackpot or winners are saved as empty, not as zero', () => {
  const result = normalizeRow(row({ jackpot: '', winners: '-' }), matchGame);
  assert.equal(result.draw.jackpotAmount, null);
  assert.equal(result.draw.winners, null);
});
