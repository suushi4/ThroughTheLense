import {displayName} from './avatar.mjs';
import {mountHomeShelf} from './home-shelf.mjs';

export function showPersonalHome(user) {
  document.querySelector('#visitor-home').hidden = true;
  for (const link of document.querySelectorAll('.home-mast .story-link')) link.hidden = true;
  const home = document.querySelector('#personal-home');
  const name = displayName(user);
  if (name) home.querySelector('h1').textContent = name + ', ваш дневник';
  home.hidden = false;
  document.title = 'Мой дневник · ThroughTheLense';
  const update = () => mountHomeShelf(home.querySelector('#personal-shelf'), user);
  update();
  addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
}
