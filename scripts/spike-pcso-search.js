'use strict';

/**
 * AJenarator - Phase 0 test #2: can we search PCSO results for OLDER dates?
 *
 * The PCSO results page is an ASP.NET form. To search a date range we must:
 *   1. GET the page and copy its hidden security fields (__VIEWSTATE, etc.)
 *      plus any session cookie it sets.
 *   2. POST those fields back together with the dates and game we want.
 *
 * This script runs 3 small searches, with a pause between each:
 *   A. Lotto 6/42 for January 2025      -> expect about 13 draws
 *   B. Lotto 6/42 for all of 2025       -> expect about 156 draws (checks paging)
 *   C. All games for Jan 1-10, 2016     -> checks that 2016 data really exists
 *
 * Total: 6 requests (one GET + one POST per search).
 * Output: spike-output/pcso-search-report.json and one HTML file per search.
 * Run with:  npm run spike:pcso-search
 */

const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const PAGE_URL = 'https://www.pcso.gov.ph/SearchLottoResult.aspx';
const PAGE_ORIGIN = 'https://www.pcso.gov.ph';
const OUTPUT_DIR = path.join(__dirname, '..', 'spike-output');
const REPORT_OUTPUT_FILE = path.join(OUTPUT_DIR, 'pcso-search-report.json');
const REQUEST_TIMEOUT_MS = 30000;
const DELAY_BETWEEN_SEARCHES_MS = 3000;
const USER_AGENT = 'AJenarator/0.1 (personal lotto analytics project)';
const RESULTS_TABLE_SELECTOR = '#cphContainer_cpContent_GridView1';
const EXPECTED_COLUMN_COUNT = 5;

// Exact field names taken from the Phase 0 page report.
// Note: start day is "ddlStartDate" but end day is "ddlEndDay" - this is PCSO's naming, not a typo here.
const FIELD = {
  startMonth: 'ctl00$ctl00$cphContainer$cpContent$ddlStartMonth',
  startDay: 'ctl00$ctl00$cphContainer$cpContent$ddlStartDate',
  startYear: 'ctl00$ctl00$cphContainer$cpContent$ddlStartYear',
  endMonth: 'ctl00$ctl00$cphContainer$cpContent$ddlEndMonth',
  endDay: 'ctl00$ctl00$cphContainer$cpContent$ddlEndDay',
  endYear: 'ctl00$ctl00$cphContainer$cpContent$ddlEndYear',
  game: 'ctl00$ctl00$cphContainer$cpContent$ddlSelectGame',
  searchButton: 'ctl00$ctl00$cphContainer$cpContent$btnSearch',
};
const SEARCH_BUTTON_LABEL = 'Search Lotto';
const ALL_GAMES_VALUE = '0';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SEARCH_CASES = [
  {
    label: 'lotto-642-one-month',
    gameMatch: '6/42',
    startDate: '2025-01-01',
    endDate: '2025-01-31',
    expectation: 'About 13 draws (Tue/Thu/Sat)',
  },
  {
    label: 'lotto-642-full-year',
    gameMatch: '6/42',
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    expectation: 'About 156 draws; shows whether results are split into pages',
  },
  {
    label: 'all-games-oldest-2016',
    gameMatch: null,
    startDate: '2016-01-01',
    endDate: '2016-01-10',
    expectation: 'Any 6-number game rows mean 2016 history is available',
  },
];

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeGameName(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, '');
}

function parseIsoDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid date "${isoDate}". Use YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid date "${isoDate}".`);
  }
  return { year, month, day };
}

// PCSO shows dates as MM/DD/YYYY; convert to YYYY-MM-DD so they sort correctly.
function pcsoDateToIso(pcsoDate) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cleanText(pcsoDate));
  if (!match) {
    return null;
  }
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

function extractCookieHeader(response) {
  const setCookieValues = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  return setCookieValues.map((cookie) => cookie.split(';')[0]).join('; ');
}

async function sendRequest(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-PH,en;q=0.9',
        ...(options.headers || {}),
      },
    });
    const body = await response.text();
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function loadSearchForm() {
  const { response, body } = await sendRequest(PAGE_URL, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Search page returned HTTP ${response.status}.`);
  }

  const $ = cheerio.load(body);
  const hiddenFields = {};
  $('input[type="hidden"]').each((_, input) => {
    const name = $(input).attr('name');
    if (name) {
      hiddenFields[name] = $(input).attr('value') || '';
    }
  });

  if (!hiddenFields.__VIEWSTATE) {
    throw new Error('The page has no __VIEWSTATE field; the form structure may have changed.');
  }

  const gameOptions = $(`select[name="${FIELD.game}"] option`)
    .map((_, option) => ({
      value: $(option).attr('value') ?? '',
      text: cleanText($(option).text()),
    }))
    .get();

  return {
    cookieHeader: extractCookieHeader(response),
    hiddenFields,
    gameOptions,
  };
}

function findGameValue(gameOptions, gameMatch) {
  if (gameMatch === null) {
    return ALL_GAMES_VALUE;
  }

  const wanted = normalizeGameName(gameMatch);
  const matches = gameOptions.filter((option) => normalizeGameName(option.text).includes(wanted));

  if (matches.length !== 1) {
    const available = gameOptions.map((option) => `${option.value}=${option.text}`).join(', ');
    throw new Error(`Expected exactly one game matching "${gameMatch}", found ${matches.length}. Options: ${available}`);
  }
  return matches[0].value;
}

function buildSearchBody(form, gameValue, startDate, endDate) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const params = new URLSearchParams();

  Object.entries(form.hiddenFields).forEach(([name, value]) => params.append(name, value));

  params.append(FIELD.startMonth, MONTH_NAMES[start.month - 1]);
  params.append(FIELD.startDay, String(start.day));
  params.append(FIELD.startYear, String(start.year));
  params.append(FIELD.endMonth, MONTH_NAMES[end.month - 1]);
  params.append(FIELD.endDay, String(end.day));
  params.append(FIELD.endYear, String(end.year));
  params.append(FIELD.game, gameValue);
  params.append(FIELD.searchButton, SEARCH_BUTTON_LABEL);

  return params.toString();
}

function parseResultsTable(body) {
  const $ = cheerio.load(body);
  const table = $(RESULTS_TABLE_SELECTOR);

  if (table.length === 0) {
    return { tableFound: false, rows: [], pagerDetected: false };
  }

  const rows = table
    .find('tr')
    .slice(1)
    .map((_, row) => [
      $(row)
        .find('td')
        .map((__, cell) => cleanText($(cell).text()))
        .get(),
    ])
    .get()
    .filter((cells) => cells.length === EXPECTED_COLUMN_COUNT);

  const tableHtml = $.html(table);
  const pagerDetected = /Page\$\d+/.test(tableHtml)
    || table.find('tr.pager, tr.pgr, .pagination').length > 0;

  return { tableFound: true, rows, pagerDetected };
}

function summarizeRows(rows) {
  const isoDates = rows
    .map((cells) => pcsoDateToIso(cells[2]))
    .filter(Boolean)
    .sort();

  const rowsPerGame = rows.reduce((counts, cells) => {
    counts[cells[0]] = (counts[cells[0]] || 0) + 1;
    return counts;
  }, {});

  return {
    rowCount: rows.length,
    distinctDrawDates: new Set(isoDates).size,
    earliestDate: isoDates[0] || null,
    latestDate: isoDates[isoDates.length - 1] || null,
    rowsPerGame,
    firstRow: rows[0] || null,
    lastRow: rows[rows.length - 1] || null,
  };
}

async function runSearchCase(searchCase) {
  const form = await loadSearchForm();
  const gameValue = findGameValue(form.gameOptions, searchCase.gameMatch);
  const requestBody = buildSearchBody(form, gameValue, searchCase.startDate, searchCase.endDate);

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: PAGE_ORIGIN,
    Referer: PAGE_URL,
  };
  if (form.cookieHeader) {
    headers.Cookie = form.cookieHeader;
  }

  const startedAt = Date.now();
  const { response, body } = await sendRequest(PAGE_URL, { method: 'POST', headers, body: requestBody });
  const elapsedMs = Date.now() - startedAt;

  fs.writeFileSync(path.join(OUTPUT_DIR, `search-${searchCase.label}.html`), body, 'utf8');

  const parsed = parseResultsTable(body);

  return {
    label: searchCase.label,
    expectation: searchCase.expectation,
    request: {
      game: searchCase.gameMatch || 'All Games',
      gameValueSent: gameValue,
      startDate: searchCase.startDate,
      endDate: searchCase.endDate,
      sessionCookieSent: Boolean(form.cookieHeader),
    },
    http: { status: response.status, ok: response.ok, elapsedMs, bodyLength: body.length },
    tableFound: parsed.tableFound,
    pagerDetected: parsed.pagerDetected,
    ...summarizeRows(parsed.rows),
    gameOptions: form.gameOptions,
  };
}

function printSummary(report) {
  console.log('\n=== AJenarator: PCSO search test ===');
  console.log(`Games in dropdown: ${report.gameOptions.map((option) => `${option.value}=${option.text}`).join(', ')}\n`);

  report.results.forEach((result) => {
    console.log(`[${result.label}]`);
    if (result.error) {
      console.log(`  FAILED         : ${result.error}\n`);
      return;
    }
    console.log(`  Expected       : ${result.expectation}`);
    console.log(`  HTTP status    : ${result.http.status}`);
    console.log(`  Table found    : ${result.tableFound ? 'yes' : 'NO'}`);
    console.log(`  Rows           : ${result.rowCount}`);
    console.log(`  Date range     : ${result.earliestDate || '-'} to ${result.latestDate || '-'}`);
    console.log(`  Split in pages : ${result.pagerDetected ? 'YES' : 'no'}`);
    console.log(`  Rows per game  : ${JSON.stringify(result.rowsPerGame)}`);
    if (result.firstRow) {
      console.log(`  First row      : ${result.firstRow.join(' | ')}`);
    }
    console.log('');
  });

  console.log(`Saved report: ${REPORT_OUTPUT_FILE}`);
  console.log('Send pcso-search-report.json back for the next step.\n');
}

async function main() {
  if (typeof fetch !== 'function') {
    throw new Error('This script needs Node.js 20 or newer (built-in fetch is missing).');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results = [];
  let gameOptions = [];

  for (let index = 0; index < SEARCH_CASES.length; index += 1) {
    const searchCase = SEARCH_CASES[index];
    console.log(`Searching ${searchCase.label} (${index + 1}/${SEARCH_CASES.length})...`);

    try {
      const result = await runSearchCase(searchCase);
      gameOptions = result.gameOptions;
      delete result.gameOptions;
      results.push(result);
    } catch (error) {
      const message = error.name === 'AbortError'
        ? `Timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`
        : error.message;
      results.push({ label: searchCase.label, error: message });
    }

    if (index < SEARCH_CASES.length - 1) {
      await sleep(DELAY_BETWEEN_SEARCHES_MS);
    }
  }

  const report = { testedAt: new Date().toISOString(), pageUrl: PAGE_URL, gameOptions, results };
  fs.writeFileSync(REPORT_OUTPUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  printSummary(report);
}

main().catch((error) => {
  console.error(`\nTest failed: ${error.message}`);
  process.exitCode = 1;
});
