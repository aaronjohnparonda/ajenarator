/**
 * Google's "Sign in with Google" button (Google Identity Services).
 * The script is loaded only when the Me screen needs it, and only once per page.
 * Google calls back with an ID token, which the server verifies; nothing here is trusted alone.
 */

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const LOAD_TIMEOUT_MS = 15000;
const BUTTON_MAX_WIDTH = 320;

let scriptPromise = null;
let initializedClientId = null;
let currentCredentialHandler = null;

function loadScript() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    return Promise.resolve();
  }
  if (scriptPromise) {
    return scriptPromise;
  }
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    const timer = window.setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS);
    script.addEventListener('load', () => {
      window.clearTimeout(timer);
      resolve();
    });
    script.addEventListener('error', () => {
      window.clearTimeout(timer);
      reject(new Error('blocked'));
    });
    document.head.append(script);
  }).catch((error) => {
    scriptPromise = null; // allow a retry later
    throw error;
  });
  return scriptPromise;
}

/**
 * Renders the button into container. onCredential(idToken) runs after the person picks an account.
 * Rejects if Google's script can't load (offline, blocked by an extension).
 */
export async function renderGoogleButton(container, { clientId, onCredential }) {
  await loadScript();
  const accounts = window.google.accounts.id;

  currentCredentialHandler = onCredential;
  if (initializedClientId !== clientId) {
    accounts.initialize({
      client_id: clientId,
      callback: (response) => {
        if (currentCredentialHandler && response && response.credential) {
          currentCredentialHandler(response.credential);
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    initializedClientId = clientId;
  }

  container.replaceChildren();
  accounts.renderButton(container, {
    type: 'standard',
    // White button: the sign-in card is dark navy in both themes, so this has the best contrast.
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    text: 'signin_with',
    logo_alignment: 'left',
    width: Math.min(BUTTON_MAX_WIDTH, Math.max(200, Math.floor(container.clientWidth || BUTTON_MAX_WIDTH))),
  });
}

/** Stops Google from silently re-selecting the account after sign-out. */
export function forgetGoogleSelection() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.disableAutoSelect();
  }
}

export function stopListening() {
  currentCredentialHandler = null;
}
