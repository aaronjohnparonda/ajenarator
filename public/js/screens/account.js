/**
 * Me screen: owner sign-in with Google, and when signed in: profile, My Picks and sign-out.
 */

import { cloneTemplate } from '../ui/dom.js';
import { showToast, announce } from '../ui/toast.js';
import { fillAvatar } from '../ui/avatar.js';
import { renderGoogleButton, forgetGoogleSelection, stopListening } from '../ui/google-button.js';
import { subscribeSession, completeSignIn, signOutSession, firstName, loadSession } from '../core/session.js';
import { playChime } from '../core/sound.js';
import { vibrate } from '../core/haptics.js';
import { mountMyPicks } from '../ui/my-picks.js';
import { resetResultsCheck } from '../ui/results-popup.js';

const MESSAGES = {
  loading: 'Loading sign-in…',
  disabled: "Sign-in isn't set up on this server yet.",
  unreachable: "Couldn't check your sign-in. Check your connection and try again.",
  googleBlocked: "Couldn't load Google sign-in. Check your connection, or allow accounts.google.com if a blocker is on.",
  confirming: 'Confirming with Google…',
  failed: "Sign-in didn't go through. Please try again.",
};

export function mountAccountScreen(root, { api }) {
  const { fragment, refs } = cloneTemplate('tpl-account');
  root.append(fragment);

  let destroyed = false;
  let renderedFor = null; // which state the Google button was rendered for
  let busy = false;
  let myPicks = null;

  function setStatus(message, isError = false) {
    refs.status.textContent = message;
    refs.status.classList.toggle('account-card__status--error', isError);
  }

  async function handleCredential(credential) {
    if (busy || destroyed) {
      return;
    }
    busy = true;
    setStatus(MESSAGES.confirming);
    try {
      const user = await completeSignIn(api, credential);
      playChime();
      vibrate(15);
      showToast(`Welcome, ${firstName(user)}`);
      announce('Signed in.');
    } catch (error) {
      setStatus(error.isUserFacing ? error.message : MESSAGES.failed, true);
    } finally {
      busy = false;
    }
  }

  async function showGoogleButton(clientId) {
    if (renderedFor === clientId) {
      return;
    }
    renderedFor = clientId;
    setStatus(MESSAGES.loading);
    try {
      await renderGoogleButton(refs.googleSlot, { clientId, onCredential: handleCredential });
      if (!destroyed) {
        setStatus('');
      }
    } catch {
      renderedFor = null;
      if (!destroyed) {
        setStatus(MESSAGES.googleBlocked, true);
        refs.retry.hidden = false;
      }
    }
  }

  function renderSignedIn(user) {
    refs.signedOut.hidden = true;
    refs.signedIn.hidden = false;
    fillAvatar(refs.avatar, user);
    refs.name.textContent = user.name || firstName(user);
    refs.email.textContent = user.email;
    renderedFor = null;
    if (!myPicks) {
      myPicks = mountMyPicks(refs.myPicks, { api });
    }
  }

  function renderSignedOut(session) {
    if (myPicks) {
      myPicks.destroy();
      myPicks = null;
      refs.myPicks.replaceChildren();
    }
    refs.signedIn.hidden = true;
    refs.signedOut.hidden = false;
    refs.retry.hidden = true;

    if (session.status === 'loading') {
      setStatus(MESSAGES.loading);
    } else if (session.status === 'error') {
      setStatus(MESSAGES.unreachable, true);
      refs.retry.hidden = false;
    } else if (!session.enabled) {
      refs.googleSlot.replaceChildren();
      setStatus(MESSAGES.disabled);
    } else {
      showGoogleButton(session.googleClientId);
    }
  }

  const unsubscribe = subscribeSession((session) => {
    if (destroyed) {
      return;
    }
    if (session.user) {
      renderSignedIn(session.user);
    } else {
      renderSignedOut(session);
    }
  });

  refs.retry.addEventListener('click', () => {
    refs.retry.hidden = true;
    renderedFor = null;
    loadSession(api);
  });

  refs.signOut.addEventListener('click', async () => {
    if (busy) {
      return;
    }
    busy = true;
    refs.signOut.setAttribute('aria-busy', 'true');
    refs.signOut.disabled = true;
    try {
      await signOutSession(api);
      forgetGoogleSelection();
      resetResultsCheck();
      showToast('Signed out');
      announce('Signed out.');
    } catch (error) {
      showToast(error.isUserFacing ? error.message : "Couldn't sign out. Try again.");
    } finally {
      busy = false;
      refs.signOut.removeAttribute('aria-busy');
      refs.signOut.disabled = false;
    }
  });

  return {
    destroy() {
      destroyed = true;
      unsubscribe();
      stopListening();
      if (myPicks) {
        myPicks.destroy();
      }
    },
  };
}
