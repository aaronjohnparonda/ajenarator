'use strict';

/**
 * Owner sign-in with Google.
 *
 * Flow:
 *   1. The browser shows Google's "Sign in with Google" button; Google returns an ID token
 *      (a signed JWT that says who the person is).
 *   2. The server verifies that token with Google's public keys: signature, expiry, issuer, and
 *      that it was issued for OUR client ID (audience). The browser is never trusted on its own.
 *   3. Only verified emails on the OWNER_EMAILS allow-list get in.
 *   4. The server issues its own short session token (HS256 JWT signed with JWT_SECRET), stored in
 *      an httpOnly cookie so page scripts can't read it.
 *
 * Authentication (who are you?) is checked here; authorization (are you the owner?) is checked
 * again on every request in verifySession, so removing an email from OWNER_EMAILS locks it out
 * immediately, even with an unexpired cookie.
 */

const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const userRepository = require('../repositories/user-repository');

const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const SESSION_ISSUER = 'ajenarator';
const SESSION_AUDIENCE = 'ajenarator-web';
const SESSION_ALGORITHM = 'HS256';
const MAX_CREDENTIAL_LENGTH = 4096;

class AuthError extends Error {
  /**
   * @param {'INVALID_CREDENTIAL'|'EMAIL_NOT_VERIFIED'|'NOT_OWNER'|'GOOGLE_UNAVAILABLE'} code
   */
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** Real Google verification. Returns the token's payload or throws AuthError. */
function createGoogleVerifier(googleClientId) {
  const client = new OAuth2Client(googleClientId);

  return async function verifyGoogleIdToken(idToken) {
    try {
      // Fetched separately so "Google is unreachable" isn't reported as "bad token".
      // The library caches these keys until Google says they expire.
      await client.getFederatedSignonCertsAsync();
    } catch {
      throw new AuthError('GOOGLE_UNAVAILABLE', "Couldn't reach Google to confirm your sign-in. Try again in a moment.");
    }

    try {
      const ticket = await client.verifyIdToken({ idToken, audience: googleClientId });
      return ticket.getPayload();
    } catch {
      throw new AuthError('INVALID_CREDENTIAL', 'Google sign-in could not be confirmed. Please try again.');
    }
  };
}

/** Keeps only what the app shows; trims to the database column sizes. */
function cleanProfile(payload) {
  const text = (value, maxLength) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null);
  const picture = text(payload.picture, 1024);
  return {
    googleSub: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    name: text(payload.name, 200),
    picture: picture && picture.startsWith('https://') ? picture : null,
  };
}

/**
 * @param {object} options
 * @param {object} options.db - mysql2 promise pool
 * @param {string} options.googleClientId
 * @param {string[]} options.ownerEmails - lowercase
 * @param {string} options.jwtSecret
 * @param {Function} [options.verifyGoogleIdToken] - tests pass a stand-in
 * @param {object} [options.users] - tests pass a stand-in for the user repository
 */
function createAuthService({
  db,
  googleClientId,
  ownerEmails,
  jwtSecret,
  verifyGoogleIdToken = createGoogleVerifier(googleClientId),
  users = userRepository,
}) {
  const owners = new Set(ownerEmails.map((email) => email.toLowerCase()));

  function issueSession(user) {
    return jwt.sign(
      { email: user.email, name: user.name, picture: user.picture },
      jwtSecret,
      {
        algorithm: SESSION_ALGORITHM,
        subject: String(user.id),
        issuer: SESSION_ISSUER,
        audience: SESSION_AUDIENCE,
        expiresIn: SESSION_SECONDS,
      },
    );
  }

  return {
    googleClientId,
    sessionMaxAgeMs: SESSION_SECONDS * 1000,

    /**
     * @param {unknown} credential - the ID token from Google's button
     * @returns {Promise<{ user: {id,email,name,picture}, sessionToken: string }>}
     */
    async signInWithGoogle(credential) {
      if (typeof credential !== 'string' || credential.length === 0 || credential.length > MAX_CREDENTIAL_LENGTH) {
        throw new AuthError('INVALID_CREDENTIAL', 'Google sign-in could not be confirmed. Please try again.');
      }

      const payload = await verifyGoogleIdToken(credential);
      if (!payload || !payload.sub || typeof payload.email !== 'string') {
        throw new AuthError('INVALID_CREDENTIAL', 'Google sign-in could not be confirmed. Please try again.');
      }
      if (payload.email_verified !== true) {
        throw new AuthError('EMAIL_NOT_VERIFIED', 'This Google account has no verified email.');
      }

      const profile = cleanProfile(payload);
      if (!owners.has(profile.email)) {
        throw new AuthError('NOT_OWNER', "Saving picks is only for this app's owner. Everything else works without signing in.");
      }

      const user = await users.upsertGoogleUser(db, profile);
      return { user, sessionToken: issueSession(user) };
    },

    /**
     * Checks a session cookie value. Returns the user, or null if missing, invalid, expired,
     * or the email is no longer on the allow-list.
     */
    verifySession(sessionToken) {
      if (typeof sessionToken !== 'string' || sessionToken.length === 0 || sessionToken.length > MAX_CREDENTIAL_LENGTH) {
        return null;
      }
      let claims;
      try {
        claims = jwt.verify(sessionToken, jwtSecret, {
          algorithms: [SESSION_ALGORITHM],
          issuer: SESSION_ISSUER,
          audience: SESSION_AUDIENCE,
        });
      } catch {
        return null;
      }
      const id = Number(claims.sub);
      if (!Number.isInteger(id) || id < 1 || typeof claims.email !== 'string' || !owners.has(claims.email)) {
        return null;
      }
      return { id, email: claims.email, name: claims.name || null, picture: claims.picture || null };
    },
  };
}

module.exports = { createAuthService, AuthError, SESSION_DAYS };
