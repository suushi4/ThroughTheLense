// Shows the account state in page headers: «Войти» for visitors, «Мой аккаунт»
// once signed in. Pages mark the link with data-account-link.
import {currentUser} from './account.mjs';
import {avatarHTML, displayName} from './avatar.mjs';
import {escapeHTML as h} from './ui.mjs';

let session;
// sessionUser resolves to the signed-in user or null; any failure counts as
// signed out so a page never breaks because the account service is down.
export function sessionUser() {
  return session ??= currentUser().catch(() => null);
}

export async function markAccountLinks(root = document) {
  const links = root.querySelectorAll('[data-account-link]');
  if (!links.length) return;
  const user = await sessionUser();
  if (!user) return;
  for (const link of links) {
    // Avatar and name; on phones only the avatar, so the header fits.
    const name = displayName(user);
    link.innerHTML = avatarHTML(user, 26) + '<span class="label-wide">' + h(name || 'Мой аккаунт') + '</span>';
    link.title = 'Аккаунт: ' + (name ? name + ' · ' : '') + (user.email || '');
    link.setAttribute('aria-label', 'Аккаунт' + (name ? ': ' + name : ''));
    link.dataset.signedIn = '';
  }
}

markAccountLinks();
