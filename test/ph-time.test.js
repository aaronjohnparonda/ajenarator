'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nowInManila, isValidIsoDate, addDays, isoWeekday, eachDate } = require('../src/utils/ph-time');

test('nowInManila converts UTC to Philippine time (+08:00), including across midnight', () => {
  assert.deepEqual(nowInManila(new Date('2026-10-24T02:54:00Z')), { date: '2026-10-24', time: '10:54' });
  assert.deepEqual(nowInManila(new Date('2026-10-24T16:30:00Z')), { date: '2026-10-25', time: '00:30' });
});

test('isValidIsoDate accepts real dates only', () => {
  assert.equal(isValidIsoDate('2024-02-29'), true);
  assert.equal(isValidIsoDate('2025-02-29'), false);
  assert.equal(isValidIsoDate('2025-13-01'), false);
  assert.equal(isValidIsoDate('2025-1-1'), false);
  assert.equal(isValidIsoDate(null), false);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2025-12-30', 3), '2026-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('isoWeekday returns 1 (Monday) to 7 (Sunday)', () => {
  assert.equal(isoWeekday('2026-10-24'), 6); // Saturday
  assert.equal(isoWeekday('2026-10-25'), 7); // Sunday
  assert.equal(isoWeekday('2026-10-26'), 1); // Monday
});

test('eachDate is inclusive', () => {
  assert.deepEqual(eachDate('2025-12-31', '2026-01-02'), ['2025-12-31', '2026-01-01', '2026-01-02']);
  assert.deepEqual(eachDate('2026-01-02', '2026-01-01'), []);
});
