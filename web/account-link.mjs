// Shows the account state in page headers: «Войти» for visitors, «Мой аккаунт»
// once signed in. Pages mark the link with data-account-link.
import {currentUser} from './account.mjs';

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
    // The short label keeps phone headers on one line.
    link.innerHTML = '<span class="label-wide">Мой аккаунт</span><span class="label-narrow">Аккаунт</span>';
    link.title = user.email ? 'Аккаунт: ' + user.email : 'Аккаунт';
    link.dataset.signedIn = '';
  }
}

markAccountLinks();
