// Public page for /d/{slug}: plays one shared day, read-only.
import {escapeHTML as h,dateLabel} from './ui.mjs';
import {importDay} from './transfer.mjs';
import {mountPlayer} from './player.mjs';
import {daySounds,mountSoundSamples} from './sound-samples.mjs';

const main = document.querySelector('main');
const slug = location.pathname.match(/^\/d\/([A-Za-z0-9_-]{22})$/)?.[1];

function gone(message) {
  document.title = 'Ссылка недоступна · ThroughTheLense';
  main.innerHTML = '<section class="empty" role="alert"><h1>Ссылка недоступна</h1><p>' + h(message) +
    '</p><p><a class="btn secondary" href="/">На главную</a></p></section>';
}

async function open() {
  if (!slug) return gone('Проверьте адрес ссылки.');
  const response = await fetch('/api/public/' + slug, {cache: 'no-store'});
  if (response.status === 404) return gone('Автор отозвал ссылку или удалил этот день.');
  if (!response.ok) return gone('Не удалось открыть день. Обновите страницу.');
  const {entry} = await importDay(await response.blob(), 'shared');
  const view = {...entry, photos: entry.photoFiles.map(file => URL.createObjectURL(file)), audio: URL.createObjectURL(entry.audioFile)};
  document.title = entry.title + ' · ThroughTheLense';
  main.innerHTML = '<div class="page-heading"><h1>' + h(entry.title) + '</h1><p>' + h(dateLabel(entry.dayDate)) +
    ' · День, которым поделился автор</p></div><div class="preview-grid day-grid"><section class="player-box" aria-label="Сцена дня"></section>' +
    '<aside class="day-sidebar"><section class="day-notes"><span class="micro">Песня дня</span><h2>' + h(entry.audioName) + '</h2>'+daySounds(entry.scene.ambience)+'</section>' +
    '<p style="margin-top:20px"><a class="btn primary" href="/journal.html#new">Записать свой день</a></p></aside></div>';
  const player=mountPlayer(main.querySelector('.player-box'),view);
  const sounds=main.querySelector('.day-sounds');
  if(sounds)mountSoundSamples(sounds,player.pause);
}

open().catch(() => gone('Копия дня повреждена или не поддерживается этим браузером.'));
