import {displayName} from './avatar.mjs';
import {mountHomeShelf} from './home-shelf.mjs';
import {sessionUser} from './account-link.mjs';

const user = await sessionUser();
document.querySelector('#cabinet-loading').hidden = true;
if (user) {
  const home = document.querySelector('#personal-home');
  const name = displayName(user);
  const greeting = document.querySelector('#cabinet-greeting');
  if (name) {
    greeting.textContent = 'Ваш дневник, ' + name;
    greeting.hidden = false;
  }
  home.hidden = false;
  mountHomeShelf(document.querySelector('#personal-shelf'), user);
} else {
  document.querySelector('#cabinet-guest').hidden = false;
}
addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
