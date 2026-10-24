'use strict';

/**
 * AJenarator - Phase 0 test: can we read PCSO's results page automatically?
 *
 * What this does:
 *   1. Fetches PCSO's lotto results search page once.
 *   2. Saves the raw HTML to spike-output/pcso-page.html.
 *   3. Writes a structure report to spike-output/pcso-report.json:
 *        - HTTP status, final URL, server headers
 *        - signs of bot protection (Cloudflare challenge, captcha)
 *        - ASP.NET form state fields (names and sizes only, never values)
 *        - every dropdown (date ranges, game list) with first/last options
 *        - every button
 *        - every table with headers and sample rows
 *
 * It makes exactly ONE request and does not submit any form.
 * Run with:  npm run spike:pcso
 */

const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const TARGET_URL = 'https://www.pcso.gov.ph/SearchLottoResult.aspx';
const OUTPUT_DIR = path.join(__dirname, '..', 'spike-output');
const HTML_OUTPUT_FILE = path.join(OUTPUT_DIR, 'pcso-page.html');
const REPORT_OUTPUT_FILE = path.join(OUTPUT_DIR, 'pcso-report.json');
const REQUEST_TIMEOUT_MS = 30000;
const SAMPLE_ROW_LIMIT = 8;
const SAMPLE_OPTION_LIMIT = 3;
const MAX_TEXT_LENGTH = 200;

const BOT_PROTECTION_MARKERS = [
  'cf-challenge',
  'challenge-platform',
  'just a moment',
  'attention required',
  'captcha',
  'access denied',
  'request unsuccessful',
];

function cleanText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text;
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AJenarator/0.1 (personal lotto analytics project)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-PH,en;q=0.9',
      },
    });
    const body = await response.text();
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function detectBotProtection(response, body) {
  const lowerBody = body.toLowerCase();
  const matchedMarkers = BOT_PROTECTION_MARKERS.filter((marker) => lowerBody.includes(marker));

  return {
    cloudflareHeaderPresent: response.headers.has('cf-ray'),
    matchedMarkers,
    likelyBlocked: response.status === 403 || response.status === 503 || matchedMarkers.length > 0,
  };
}

function describeAspNetState($) {
  const stateFieldNames = ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION', '__EVENTTARGET', '__EVENTARGUMENT'];

  return stateFieldNames.map((fieldName) => {
    const input = $(`input[name="${fieldName}"]`);
    return {
      name: fieldName,
      present: input.length > 0,
      valueLength: input.length > 0 ? String(input.attr('value') || '').length : 0,
    };
  });
}

function describeForms($) {
  return $('form')
    .map((_, form) => ({
      id: $(form).attr('id') || null,
      name: $(form).attr('name') || null,
      method: ($(form).attr('method') || 'GET').toUpperCase(),
      action: $(form).attr('action') || null,
    }))
    .get();
}

function describeDropdowns($) {
  return $('select')
    .map((_, select) => {
      const options = $(select)
        .find('option')
        .map((__, option) => ({
          value: $(option).attr('value') ?? null,
          text: cleanText($(option).text()),
          selected: $(option).is('[selected]'),
        }))
        .get();

      return {
        id: $(select).attr('id') || null,
        name: $(select).attr('name') || null,
        optionCount: options.length,
        firstOptions: options.slice(0, SAMPLE_OPTION_LIMIT),
        lastOptions: options.slice(-SAMPLE_OPTION_LIMIT),
        selectedOptions: options.filter((option) => option.selected),
      };
    })
    .get();
}

function describeButtons($) {
  return $('input[type="submit"], input[type="button"], input[type="image"], button')
    .map((_, button) => ({
      tag: button.tagName,
      id: $(button).attr('id') || null,
      name: $(button).attr('name') || null,
      type: $(button).attr('type') || null,
      label: cleanText($(button).attr('value') || $(button).text()),
    }))
    .get();
}

function describeTables($) {
  return $('table')
    .map((tableIndex, table) => {
      const rows = $(table).find('tr');
      const headerCells = rows
        .first()
        .find('th, td')
        .map((_, cell) => cleanText($(cell).text()))
        .get();

      const sampleRows = rows
        .slice(1, SAMPLE_ROW_LIMIT + 1)
        .map((_, row) => [
          $(row)
            .find('td, th')
            .map((__, cell) => cleanText($(cell).text()))
            .get(),
        ])
        .get();

      return {
        index: tableIndex,
        id: $(table).attr('id') || null,
        className: $(table).attr('class') || null,
        rowCount: rows.length,
        headerCells,
        sampleRows,
      };
    })
    .get();
}

function printSummary(report) {
  console.log('\n=== AJenarator: PCSO page test ===');
  console.log(`HTTP status      : ${report.http.status}`);
  console.log(`Final URL        : ${report.http.finalUrl}`);
  console.log(`Likely blocked   : ${report.botProtection.likelyBlocked ? 'YES' : 'no'}`);
  console.log(`ASP.NET form     : ${report.aspNetState.some((field) => field.present) ? 'yes' : 'no'}`);
  console.log(`Dropdowns found  : ${report.dropdowns.length}`);
  console.log(`Tables found     : ${report.tables.length}`);

  const biggestTable = [...report.tables].sort((a, b) => b.rowCount - a.rowCount)[0];
  if (biggestTable) {
    console.log(`Largest table    : #${biggestTable.index} with ${biggestTable.rowCount} rows`);
    console.log(`  Headers        : ${biggestTable.headerCells.join(' | ')}`);
    biggestTable.sampleRows.slice(0, 3).forEach((row) => console.log(`  Row            : ${row.join(' | ')}`));
  }

  console.log(`\nSaved raw HTML   : ${HTML_OUTPUT_FILE}`);
  console.log(`Saved report     : ${REPORT_OUTPUT_FILE}`);
  console.log('\nSend pcso-report.json back for the next step.\n');
}

async function main() {
  if (typeof fetch !== 'function') {
    throw new Error('This script needs Node.js 20 or newer (built-in fetch is missing).');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const startedAt = Date.now();
  const { response, body } = await fetchPage(TARGET_URL);
  const elapsedMs = Date.now() - startedAt;

  fs.writeFileSync(HTML_OUTPUT_FILE, body, 'utf8');

  const $ = cheerio.load(body);
  const report = {
    testedAt: new Date().toISOString(),
    targetUrl: TARGET_URL,
    http: {
      status: response.status,
      ok: response.ok,
      finalUrl: response.url,
      elapsedMs,
      contentType: response.headers.get('content-type'),
      server: response.headers.get('server'),
      bodyLength: body.length,
    },
    pageTitle: cleanText($('title').text()),
    botProtection: detectBotProtection(response, body),
    aspNetState: describeAspNetState($),
    forms: describeForms($),
    dropdowns: describeDropdowns($),
    buttons: describeButtons($),
    tables: describeTables($),
  };

  fs.writeFileSync(REPORT_OUTPUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  printSummary(report);
}

main().catch((error) => {
  if (error.name === 'AbortError') {
    console.error(`\nRequest timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. PCSO's site may be slow or blocking automated requests.`);
  } else if (error.cause && error.cause.code) {
    console.error(`\nNetwork error (${error.cause.code}): ${error.message}`);
  } else {
    console.error(`\nTest failed: ${error.message}`);
  }
  process.exitCode = 1;
});
