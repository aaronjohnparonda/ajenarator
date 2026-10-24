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

  if (missing.length > 0) {
    problems.unshift(`Missing settings: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`);
  }

  if (problems.length > 0) {
    throw new Error(`Configuration error:\n  - ${problems.join('\n  - ')}`);
  }

  return Object.freeze({
    projectRoot: PROJECT_ROOT,
    db: Object.freeze(db),
  });
}

module.exports = buildConfig();
