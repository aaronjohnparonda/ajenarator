'use strict';

/**
 * Loads and validates environment settings once, then exposes them as a frozen config object.
 *
 * - Locally, values come from the .env file in the project root.
 * - On a host such as Render, values come from the host's environment variables (no .env file).
 *   Real environment variables always take priority over .env values.
 */

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ENV_FILE_PATH = path.join(PROJECT_ROOT, '.env');

function loadEnvFileIfPresent() {
  try {
    process.loadEnvFile(ENV_FILE_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Could not read .env file: ${error.message}`);
    }
  }
}

function readRequired(name, missing) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    missing.push(name);
  }
  return value;
}

function readPort(rawPort, problems) {
  const port = Number(rawPort);
  if (rawPort && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    problems.push(`DB_PORT must be a whole number between 1 and 65535 (got "${rawPort}").`);
  }
  return port;
}

function readCaCertificate(problems) {
  const inlineCertificate = (process.env.DB_CA_CERT || '').trim();
  if (inlineCertificate) {
    // Hosts often store multi-line values with literal "\n"; restore real line breaks.
    return inlineCertificate.replace(/\\n/g, '\n');
  }

  const certificatePath = (process.env.DB_CA_CERT_PATH || '').trim();
  if (!certificatePath) {
    problems.push('Set DB_CA_CERT_PATH (local) or DB_CA_CERT (hosting) so the database connection can be verified.');
    return '';
  }

  const absolutePath = path.isAbsolute(certificatePath)
    ? certificatePath
    : path.join(PROJECT_ROOT, certificatePath);

  try {
    return fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    problems.push(`Could not read the CA certificate at ${certificatePath} (${error.code || error.message}).`);
    return '';
  }
}

const AUTH_SETTINGS = ['GOOGLE_CLIENT_ID', 'OWNER_EMAILS', 'JWT_SECRET'];
const MIN_JWT_SECRET_LENGTH = 32;
const GOOGLE_CLIENT_ID_PATTERN = /^[\w-]+\.apps\.googleusercontent\.com$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Google sign-in settings. Optional as a group: scripts like the nightly fetch don't need them,
 * and the website still runs (sign-in shows as unavailable). Setting only some of them is an error.
 * @returns {null | {googleClientId, ownerEmails: string[], jwtSecret}}
 */
function readAuth(problems) {
  const values = Object.fromEntries(AUTH_SETTINGS.map((name) => [name, (process.env[name] || '').trim()]));
  const provided = AUTH_SETTINGS.filter((name) => values[name]);
  if (provided.length === 0) {
    return null;
  }
  if (provided.length < AUTH_SETTINGS.length) {
    const missing = AUTH_SETTINGS.filter((name) => !values[name]);
    problems.push(`Google sign-in is partly set up. Also set: ${missing.join(', ')} (or remove all three to turn sign-in off).`);
    return null;
  }

  if (!GOOGLE_CLIENT_ID_PATTERN.test(values.GOOGLE_CLIENT_ID)) {
    problems.push('GOOGLE_CLIENT_ID should end with .apps.googleusercontent.com.');
  }

  const ownerEmails = values.OWNER_EMAILS
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const badEmails = ownerEmails.filter((email) => !EMAIL_PATTERN.test(email));
  if (ownerEmails.length === 0 || badEmails.length > 0) {
    problems.push('OWNER_EMAILS must be one or more email addresses separated by commas.');
  }

  if (values.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters. Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`);
  }

  return Object.freeze({
    googleClientId: values.GOOGLE_CLIENT_ID,
    ownerEmails: Object.freeze([...new Set(ownerEmails)]),
    jwtSecret: values.JWT_SECRET,
  });
}

const MAX_PROXY_HOPS = 5;

/**
 * Hosting settings (optional):
 *   TRUST_PROXY_HOPS  how many proxies sit in front of the app (default 1). Used to read each
 *                     visitor's real IP for rate limits. Measure it with SHOW_IP_CHECK, don't guess.
 *   SHOW_IP_CHECK     "true" temporarily enables GET /api/v1/ip-check for that measurement.
 */
function readHosting(problems) {
  const rawHops = (process.env.TRUST_PROXY_HOPS || '').trim();
  let trustProxyHops = 1;
  if (rawHops) {
    trustProxyHops = Number(rawHops);
    if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > MAX_PROXY_HOPS) {
      problems.push(`TRUST_PROXY_HOPS must be a whole number from 0 to ${MAX_PROXY_HOPS} (got "${rawHops}").`);
      trustProxyHops = 1;
    }
  }
  return Object.freeze({
    trustProxyHops,
    showIpCheck: (process.env.SHOW_IP_CHECK || '').trim().toLowerCase() === 'true',
  });
}

function buildConfig() {
  loadEnvFileIfPresent();

  const missing = [];
  const problems = [];

  const db = {
    host: readRequired('DB_HOST', missing),
    port: readPort(readRequired('DB_PORT', missing), problems),
    user: readRequired('DB_USER', missing),
    password: readRequired('DB_PASSWORD', missing),
    database: readRequired('DB_NAME', missing),
    caCertificate: readCaCertificate(problems),
  };
  const auth = readAuth(problems);
  const hosting = readHosting(problems);

  if (missing.length > 0) {
    problems.unshift(`Missing settings: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`);
  }

  if (problems.length > 0) {
    throw new Error(`Configuration error:\n  - ${problems.join('\n  - ')}`);
  }

  return Object.freeze({
    projectRoot: PROJECT_ROOT,
    db: Object.freeze(db),
    auth,
    hosting,
  });
}

module.exports = buildConfig();
