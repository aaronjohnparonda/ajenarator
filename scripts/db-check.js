'use strict';

/**
 * AJenarator - database connection check.
 * Confirms the .env settings work, the connection is encrypted, and the time zone is Philippine time.
 * Read-only: it changes nothing in the database.
 *
 * Run with:  npm run db:check
 */

async function main() {
  // Required inside main so configuration errors are printed cleanly below.
  const { pool, closePool } = require('../src/db/pool');

  try {
    const [[serverInfo]] = await pool.query(
      'SELECT VERSION() AS version, DATABASE() AS databaseName, @@session.time_zone AS timeZone, NOW() AS serverNow',
    );
    const [[sslInfo]] = await pool.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");

    const encrypted = Boolean(sslInfo && sslInfo.Value);

    console.log('\n=== AJenarator: database check ===');
    console.log(`Connected        : yes`);
    console.log(`MySQL version    : ${serverInfo.version}`);
    console.log(`Database         : ${serverInfo.databaseName}`);
    console.log(`Encrypted (TLS)  : ${encrypted ? `yes (${sslInfo.Value})` : 'NO - stop and report this'}`);
    console.log(`Time zone        : ${serverInfo.timeZone}`);
    console.log(`Database time    : ${serverInfo.serverNow} (should match Philippine time now)\n`);

    if (!encrypted) {
      process.exitCode = 1;
    }
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  if (error.message.startsWith('Configuration error')) {
    console.error(`\n${error.message}\n`);
  } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('\nLogin rejected: check DB_USER and DB_PASSWORD in .env.\n');
  } else if (error.code === 'ENOTFOUND') {
    console.error('\nHost not found: check DB_HOST in .env.\n');
  } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
    console.error('\nCould not reach the database: check DB_HOST/DB_PORT, and that the Aiven service shows "Running".\n');
  } else if (error.code === 'HANDSHAKE_SSL_ERROR' || /certificate/i.test(error.message)) {
    console.error('\nCertificate problem: re-download the CA certificate from Aiven into certs/aiven-ca.pem.\n');
  } else {
    console.error(`\nDatabase check failed (${error.code || 'unknown'}): ${error.message}\n`);
  }
  process.exitCode = 1;
});
