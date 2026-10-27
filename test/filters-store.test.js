'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal browser storage stand-in for the browser module.
const stored = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (stored.has(key) ? stored.get(key) : null),
    setItem: (key, value) => stored.set(key, String(value)),
  },
};

const load = () => import('../public/js/lib/filters-store.js');

const GAME = {
  code: '6/42',
  maxNumber: 42,
  defaultFilters: {
    oddEvenBalance: { enabled: true },
    lowHighBalance: { enabled: true },
    consecutive: { enabled: true, mode: 'strict' },
    consecutivePairs: { enabled: true },
    tensGroups: { enabled: true, min: 3 },
    crowdedDecade: { enabled: false },
    sameMultiple: { enabled: true },
    lastDrawRepeat: { enabled: true },
    evenlySpaced: { enabled: true },
    sumRange: { enabled: true, min: 83, max: 175 },
    lastDigit: { enabled: false, max: 2 },
    antiBirthday: { enabled: false },
    pastWinners: { enabled: true },
    includeNumbers: [],
    excludeNumbers: [],
  },
};

test.beforeEach(() => stored.clear());

test('with nothing saved, settings equal the defaults', async () => {
  const { loadFilters, countChanges } = await load();
  const settings = loadFilters(GAME);
  assert.deepEqual(settings, GAME.defaultFilters);
  assert.equal(countChanges(GAME, settings), 0);
});

test('only changes are saved, and they come back on load', async () => {
  const { loadFilters, saveFilters, countChanges } = await load();
  const settings = loadFilters(GAME);
  settings.consecutive.mode = 'relaxed';
  settings.antiBirthday.enabled = true;
  settings.includeNumbers = [21, 7];
  saveFilters(GAME, settings);

  assert.deepEqual(JSON.parse(stored.get('ajenarator.filters.6/42')), {
    consecutive: { mode: 'relaxed' },
    antiBirthday: { enabled: true },
    includeNumbers: [7, 21],
  });

  const reloaded = loadFilters(GAME);
  assert.equal(reloaded.consecutive.mode, 'relaxed');
  assert.equal(reloaded.consecutive.enabled, true);
  assert.equal(reloaded.antiBirthday.enabled, true);
  assert.deepEqual(reloaded.includeNumbers, [7, 21]);
  assert.equal(countChanges(GAME, reloaded), 3);
});

test('defaults are not mutated by edits', async () => {
  const { loadFilters } = await load();
  const settings = loadFilters(GAME);
  settings.sumRange.min = 100;
  assert.equal(GAME.defaultFilters.sumRange.min, 83);
});

test('broken or tampered saved data is ignored safely', async () => {
  const { loadFilters } = await load();
  stored.set('ajenarator.filters.6/42', '{not json');
  assert.deepEqual(loadFilters(GAME), GAME.defaultFilters);

  stored.set('ajenarator.filters.6/42', JSON.stringify({
    sumRange: { min: 'abc', max: 150 },
    includeNumbers: [7, 99, 'x', 0],
    unknownRule: { enabled: false },
  }));
  const settings = loadFilters(GAME);
  assert.equal(settings.sumRange.min, 83);
  assert.equal(settings.sumRange.max, 150);
  assert.deepEqual(settings.includeNumbers, [7]);
  assert.equal('unknownRule' in settings, false);
});

test('rules added later (and consecutive pairs) are saved, restored and counted', async () => {
  const { loadFilters, saveFilters, countChanges } = await load();
  const settings = loadFilters(GAME);
  settings.consecutivePairs.enabled = false;
  settings.crowdedDecade.enabled = true;
  settings.lastDrawRepeat.enabled = false;
  saveFilters(GAME, settings);
  assert.deepEqual(JSON.parse(stored.get('ajenarator.filters.6/42')), {
    consecutivePairs: { enabled: false },
    crowdedDecade: { enabled: true },
    lastDrawRepeat: { enabled: false },
  });
  const reloaded = loadFilters(GAME);
  assert.equal(reloaded.consecutivePairs.enabled, false);
  assert.equal(reloaded.crowdedDecade.enabled, true);
  assert.equal(reloaded.sameMultiple.enabled, true);
  assert.equal(countChanges(GAME, reloaded), 3);
});
