'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// The browser modules are ES modules; load them with import().
const load = () => import('../public/js/lib/draw-schedule.js');
const GAME_642 = { drawDays: [2, 4, 6], drawTime: '21:00' }; // Tue, Thu, Sat

test('a Saturday morning in Manila: next 6/42 draw is tonight at 9 PM', async () => {
  const { nextDraw, drawDayLabel } = await load();
  const draw = nextDraw(GAME_642, new Date('2026-10-24T02:30:00Z')); // Sat 10:30 AM PHT
  assert.equal(draw.date, '2026-10-24');
  assert.equal(draw.startsAt.toISOString(), '2026-10-24T13:00:00.000Z');
  assert.equal(drawDayLabel(draw), 'Tonight');
});

test('after tonight\'s draw time, the next draw moves to the next scheduled day', async () => {
  const { nextDraw, drawDayLabel } = await load();
  const draw = nextDraw(GAME_642, new Date('2026-10-24T13:30:00Z')); // Sat 9:30 PM PHT
  assert.equal(draw.date, '2026-10-27'); // Tuesday
  assert.equal(drawDayLabel(draw), 'Tue');
});

test('uses Philippine time even when the device is in another time zone', async () => {
  const { nextDraw, drawDayLabel } = await load();
  // 11:30 PM Friday UTC = 7:30 AM Saturday in Manila
  const draw = nextDraw(GAME_642, new Date('2026-10-23T23:30:00Z'));
  assert.equal(draw.date, '2026-10-24');
  assert.equal(drawDayLabel(draw), 'Tonight');
});

test('tomorrow label', async () => {
  const { nextDraw, drawDayLabel } = await load();
  const draw = nextDraw({ drawDays: [7], drawTime: '21:00' }, new Date('2026-10-24T02:30:00Z'));
  assert.equal(drawDayLabel(draw), 'Tomorrow');
});

test('countdown and time formatting', async () => {
  const { formatCountdown, formatDrawTime } = await load();
  assert.equal(formatCountdown(5 * 3600000 + 42 * 60000 + 18000), '05:42:18');
  assert.equal(formatCountdown(28 * 3600000), '1d 04h');
  assert.equal(formatCountdown(-5000), '00:00:00');
  assert.equal(formatDrawTime('21:00'), '9:00 PM');
  assert.equal(formatDrawTime('00:30'), '12:30 AM');
});
