'use strict';

/** Reads and writes the users table (people who signed in with Google). */

function mapUserRow(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    picture: row.picture_url,
  };
}

/**
 * Creates the user on first sign-in, or refreshes email/name/picture and last login after that.
 * Matching is by Google account ID, which stays the same even if the email changes.
 * @returns {Promise<{id, email, name, picture}>}
 */
async function upsertGoogleUser(db, { googleSub, email, name, picture }) {
  // Plain placeholders in the UPDATE part (not the newer "AS alias" or deprecated VALUES()
  // forms) so this runs the same on MySQL 8 and TiDB.
  await db.execute(
    `INSERT INTO users (google_sub, email, display_name, picture_url)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       email = ?,
       display_name = ?,
       picture_url = ?,
       last_login_at = CURRENT_TIMESTAMP`,
    [googleSub, email, name, picture, email, name, picture],
  );
  const [rows] = await db.execute(
    'SELECT id, email, display_name, picture_url FROM users WHERE google_sub = ?',
    [googleSub],
  );
  return mapUserRow(rows[0]);
}

module.exports = { upsertGoogleUser };
