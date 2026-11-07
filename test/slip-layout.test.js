'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('bet-slip layout: 9 per row for 6/42-6/49, 10 per column for 6/55 and 6/58', async () => {
  const { slipLayout } = await import('../public/js/lib/slip-layout.js');
  assert.deepEqual(slipLayout(42), { flow: 'row', columns: 9, rows: 5 });
  assert.deepEqual(slipLayout(45), { flow: 'row', columns: 9, rows: 5 });
  assert.deepEqual(slipLayout(49), { flow: 'row', columns: 9, rows: 6 });
  assert.deepEqual(slipLayout(55), { flow: 'column', columns: 6, rows: 10 });
  assert.deepEqual(slipLayout(58), { flow: 'column', columns: 6, rows: 10 });
});
