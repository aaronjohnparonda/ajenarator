'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../public/js/lib/draw-status.js');

// 6/42 draws Tue/Thu/Sat. 2026-10-24 is a Saturday.
const game642 = (lastDrawDate) => ({ drawDays: [2, 4, 6], drawTime: '21:00', lastDraw: lastDrawDate ? { drawDate: lastDrawDate } : null });
const at = (manilaTime) => new Date(`${manilaTime}+08:00`);

test('draw day, before 9 PM: tonight with a countdown', async () => {
  const { drawStatus } = await load();
  const status = drawStatus(game642('2026-10-22'), at('2026-10-24T15:00:00'));
  assert.equal(status.state, 'tonight');
  assert.equal(status.label, 'Tonight 9:00 PM');
  assert.equal(status.countdownTo.toISOString(), '2026-10-24T13:00:00.000Z');
});

test('draw day, after 9 PM, not saved yet: waiting for results', async () => {
  const { drawStatus } = await load();
  assert.equal(drawStatus(game642('2026-10-22'), at('2026-10-24T21:40:00')).state, 'waiting');
});

test('draw day, result saved: result in', async () => {
  const { drawStatus } = await load();
  const status = drawStatus(game642('2026-10-24'), at('2026-10-24T22:20:00'));
  assert.equal(status.state, 'result');
  assert.equal(status.label, 'Result in');
});

test('not a draw day, last scheduled draw saved: upcoming', async () => {
  const { drawStatus } = await load();
  const status = drawStatus(game642('2026-10-24'), at('2026-10-25T10:00:00')); // Sunday
  assert.equal(status.state, 'upcoming');
  assert.equal(status.label, 'Tue 9:00 PM');
});

test('not a draw day, last scheduled draw missing: delayed (e.g. holiday)', async () => {
  const { drawStatus } = await load();
  const status = drawStatus(game642('2026-10-22'), at('2026-10-25T10:00:00'));
  assert.equal(status.state, 'delayed');
  assert.equal(status.missingDate, '2026-10-24');
});

test('a game with no saved draws yet does not crash', async () => {
  const { drawStatus } = await load();
  assert.equal(drawStatus(game642(null), at('2026-10-25T10:00:00')).state, 'delayed');
  assert.equal(drawStatus(game642(null), at('2026-10-24T10:00:00')).state, 'tonight');
});

test('previous scheduled date skips non-draw days', async () => {
  const { previousScheduledDate } = await load();
  assert.equal(previousScheduledDate({ drawDays: [2, 4, 6] }, '2026-10-26'), '2026-10-24'); // Mon -> Sat
  assert.equal(previousScheduledDate({ drawDays: [2, 4, 6] }, '2026-10-24'), '2026-10-22'); // Sat -> Thu
});
