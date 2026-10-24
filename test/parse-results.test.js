'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseResultsPage, PcsoPageChangedError } = require('../src/fetcher/parse-results');

const readFixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('reads all 13 Lotto 6/42 draws from the real January 2025 PCSO page', () => {
  const { rows, statusMessage } = parseResultsPage(readFixture('pcso-results-642-jan-2025.html'));
  assert.equal(rows.length, 13);
  assert.equal(statusMessage, 'Search Results');
  assert.deepEqual(rows[0], {
    gameName: 'Lotto 6/42',
    combination: '37-41-05-33-42-40',
    drawDate: '1/2/2025',
    jackpot: '5,940,000.00',
    winners: '0',
  });
});

test('reads every game from the real all-games January 2016 page', () => {
  const { rows } = parseResultsPage(readFixture('pcso-results-all-games-jan-2016.html'));
  assert.equal(rows.length, 79);
  const gameNames = new Set(rows.map((row) => row.gameName));
  ['Lotto 6/42', 'Megalotto 6/45', 'Superlotto 6/49', 'Grand Lotto 6/55', 'Ultra Lotto 6/58', '4D Lotto']
    .forEach((name) => assert.ok(gameNames.has(name), `missing ${name}`));
});

test('an intact page with no results table returns no rows', () => {
  const html = '<span id="cphContainer_cpContent_lblError">No record found.</span>';
  assert.deepEqual(parseResultsPage(html), { rows: [], statusMessage: 'No record found.' });
});

test('throws when PCSO changes the page structure', () => {
  assert.throws(() => parseResultsPage('<html><body>Maintenance</body></html>'), PcsoPageChangedError);
});

test('throws when the table columns change', () => {
  const html = `<span id="cphContainer_cpContent_lblError">Search Results</span>
    <table id="cphContainer_cpContent_GridView1"><tr><th>GAME</th><th>NUMBERS</th><th>DATE</th><th>PRIZE</th><th>WINNERS</th></tr></table>`;
  assert.throws(() => parseResultsPage(html), PcsoPageChangedError);
});
