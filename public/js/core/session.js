/**
 * Who is signed in, shared by the header and the Me screen.
 * The session itself lives in an httpOnly cookie the browser script can't read; this only keeps
 * the public profile the server returns ({ email, name, picture }).
 */

const listeners = new Set();

let state = {
  status: 'loading', // 'loading' | 'ready' | 'error'
  enabled: false,
  googleClientId: null,
  user: null,
};

function setState(changes) {
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener(state));
}

export function getSession() {
  return state;
}

/** Calls listener now and on every change. Returns an unsubscribe function. */
export function subscribeSession(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function loadSession(api) {
  setState({ status: 'loading' });
  try {
    const [config, user] = await Promise.all([api.fetchAuthConfig(), api.fetchCurrentUser()]);
    setState({ status: 'ready', enabled: config.enabled, googleClientId: config.googleClientId, user });
  } catch {
    setState({ status: 'error', user: null });
  }
}

export async function completeSignIn(api, credential) {
  const user = await api.signInWithGoogle(credential);
  setState({ user });
  return user;
}

export async function signOutSession(api) {
  await api.signOut();
  setState({ user: null });
}

/** "Aaron John" -> "Aaron"; falls back to the part of the email before @. */
export function firstName(user) {
  if (!user) {
    return '';
  }
  const source = user.name || user.email.split('@')[0];
  return source.trim().split(/\s+/)[0];
}
