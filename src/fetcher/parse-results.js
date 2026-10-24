'use strict';

/**
 * Reads PCSO's results page HTML. Pure function: no network, no database.
 *
 * Confirmed against real PCSO pages (Phase 0):
 *   table#cphContainer_cpContent_GridView1
 *   columns: LOTTO GAME | COMBINATIONS | DRAW DATE | JACKPOT (PHP) | WINNERS
 *   span#cphContainer_cpContent_lblError holds the page's status text ("Search Results").
 */

const cheerio = require('cheerio');

const RESULTS_TABLE_SELECTOR = '#cphContainer_cpContent_GridView1';
const STATUS_LABEL_SELECTOR = '#cphContainer_cpContent_lblError';
const EXPECTED_HEADERS = ['LOTTO GAME', 'COMBINATIONS', 'DRAW DATE', 'JACKPOT (PHP)', 'WINNERS'];

class PcsoPageChangedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PcsoPageChangedError';
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * @returns {{ rows: Array<{gameName, combination, drawDate, jackpot, winners}>, statusMessage: string|null }}
 * @throws {PcsoPageChangedError} when neither the results table nor the status label exists,
 *   or the table's columns are not the ones we expect. This means PCSO changed the page and the
 *   reader must be updated - we stop instead of saving wrong data.
 */
function parseResultsPage(html) {
  const $ = cheerio.load(html);
  const table = $(RESULTS_TABLE_SELECTOR);
  const statusLabel = $(STATUS_LABEL_SELECTOR);
  const statusMessage = statusLabel.length > 0 ? cleanText(statusLabel.text()) : null;

  if (table.length === 0) {
    if (statusLabel.length === 0) {
      throw new PcsoPageChangedError('PCSO results page structure changed: no results table and no status label found.');
    }
    // Page is intact but shows no table (e.g. a search with no draws in range).
    return { rows: [], statusMessage };
  }

  const tableRows = table.find('tr');
  const headers = tableRows
    .first()
    .find('th, td')
    .map((_, cell) => cleanText($(cell).text()).toUpperCase())
    .get();

  if (headers.join('|') !== EXPECTED_HEADERS.join('|')) {
    throw new PcsoPageChangedError(`PCSO results table columns changed. Expected [${EXPECTED_HEADERS.join(', ')}], got [${headers.join(', ')}].`);
  }

  const rows = [];
  tableRows.slice(1).each((_, row) => {
    const cells = $(row)
      .find('td')
      .map((__, cell) => cleanText($(cell).text()))
      .get();

    // Skip anything that is not a 5-column data row (e.g. a pager row, if PCSO ever adds one).
    if (cells.length !== EXPECTED_HEADERS.length) {
      return;
    }

    rows.push({
      gameName: cells[0],
      combination: cells[1],
      drawDate: cells[2],
      jackpot: cells[3],
      winners: cells[4],
    });
  });

  return { rows, statusMessage };
}

module.exports = {
  parseResultsPage,
  PcsoPageChangedError,
};
