import {demos} from './demo.mjs';
import {mountPlayer} from './player.mjs';
import {escapeHTML as h} from './ui.mjs';

const cards = document.querySelector('#gallery-cards');
const stage = document.querySelector('#gallery-stage');
const editor = document.querySelector('#gallery-editor');
let player;

cards.innerHTML = demos.map((day, index) => `
  <button class="gallery-card" type="button" data-example="${index}" aria-pressed="false" aria-controls="gallery-stage">
    <img src="/media/${h(day.id.slice(5))}-preview.webp" width="1120" height="747" alt="${h(day.alts[0])}" loading="lazy">
    <strong>${h(day.title)}</strong>
    <span>${h(day.audioName)}</span>
  </button>`).join('');

const buttons = [...cards.querySelectorAll('button')];
function showExample(index) {
  const day = demos[index];
  player?.destroy();
  document.querySelector('#gallery-scene-title').textContent = day.title;
  player = mountPlayer(stage, {...day, audioPreload: 'none'});
  editor.href = '/journal.html?example=' + encodeURIComponent(day.id) + '#new';
  buttons.forEach((button, position) => button.setAttribute('aria-pressed', String(position === index)));
}
buttons.forEach((button, index) => button.onclick = () => showExample(index));
showExample(0);
window.addEventListener('pagehide', () => player?.pause());
