/**
 * Fills an element with the user's Google photo, or their initial if there is no photo
 * (or it fails to load). Signed out: a simple person icon.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function personIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const head = document.createElementNS(SVG_NS, 'circle');
  head.setAttribute('cx', '12');
  head.setAttribute('cy', '8');
  head.setAttribute('r', '4');
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', 'M4 21c0-4 4-6 8-6s8 2 8 6');
  svg.append(head, body);
  return svg;
}

function initialOf(user) {
  const source = (user.name || user.email || '?').trim();
  return source.charAt(0).toUpperCase();
}

export function fillAvatar(element, user) {
  element.replaceChildren();
  if (!user) {
    element.append(personIcon());
    return;
  }
  if (user.picture) {
    const image = document.createElement('img');
    image.alt = '';
    image.decoding = 'async';
    // Google photo links can refuse requests that carry a referrer.
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      element.replaceChildren(document.createTextNode(initialOf(user)));
    }, { once: true });
    image.src = user.picture;
    element.append(image);
    return;
  }
  element.textContent = initialOf(user);
}
