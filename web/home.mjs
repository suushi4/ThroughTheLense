import {sessionUser} from './account-link.mjs';
import {demos} from './demo.mjs';
import {mountAtmosphere} from './home-atmosphere.mjs';
import {mountPlayer} from './player.mjs';

function nearViewport(host, load, fallbackHref, fallbackText) {
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();
    Promise.resolve().then(load).catch(() => {
      const note = document.createElement('p');
      const link = document.createElement('a');
      note.className = 'feature-error';
      note.textContent = 'Этот раздел пока не загрузился.';
      link.href = fallbackHref;
      link.textContent = fallbackText;
      note.append(link);
      host.replaceChildren(note);
    });
  }, {rootMargin: `${Math.min(1400,Math.max(640,window.innerHeight * 1.5))}px 0px`});
  observer.observe(host);
}

const journalRoutes = /^#(?:archive|new|preview|edit|day)(?:\/|$)/;
if (journalRoutes.test(location.hash)) {
  location.replace('/journal.html' + location.hash);
} else if (await sessionUser()) {
  const {showPersonalHome} = await import('./personal-home.mjs');
  showPersonalHome(await sessionUser());
} else {
  const host = document.querySelector('#home-player');
  const opening = document.querySelector('.opening');
  const room = document.querySelector('.live-example');
  const date = room.querySelector('time');
  const summary = room.querySelector('.scene-notes');
  const openDay = room.querySelector('.example-link');
  const print = opening.querySelector('.contact-print');
  const printWindow = print.querySelector('.print-window');
  const printCaption = print.querySelector('figcaption');
  const choices = [...opening.querySelectorAll('.memory-choice')];
  const switcher = room.querySelector('.sample-switcher');
  const roomChoices = [...switcher.querySelectorAll('button')];
  const useExample = document.querySelector('#use-example');
  const motion = matchMedia('(prefers-reduced-motion: no-preference)');
  const setAtmosphere = mountAtmosphere(opening, motion);
  const dates = new Intl.DateTimeFormat('ru', {day: 'numeric', month: 'long', timeZone: 'UTC'});
  const descriptions = [
    'После сдачи проекта мы вышли на улицу. На перекрёстке пропустили зелёный, чтобы дослушать песню.',
    'Два стаканчика, остановка и разговор, из-за которого мы пропустили автобус.',
    'Последние аплодисменты слышны из-за двери. В полосе света остался один стул.'
  ];
  let player, stage, dialog;
  let selected;
  let printAnimations = [];
  let visible = false, closed = false;
  let lab, light, pending;

  const lightIsActive = () => visible && !document.hidden && motion.matches &&
    stage.dataset.phase === '1' && !dialog.open;

  function syncLight() {
    room.dataset.phase = stage.dataset.phase;
    const active = lightIsActive();
    light?.show(active);
    if (!active || pending || light) return;
    const context = document.createElement('canvas').getContext('webgl2', {failIfMajorPerformanceCaveat: true});
    if (!context) return;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    pending = import('./assets/scene-effects.mjs').then(({mountSceneLight}) => {
      if (closed) return;
      const surface = document.createElement('div');
      surface.className = 'scene-effects';
      surface.setAttribute('aria-hidden', 'true');
      host.before(surface);
      light = mountSceneLight(surface);
      light.show(lightIsActive());
    }).catch(() => {}); // The CSS lighting is already in place.
  }

  const changes = new MutationObserver(syncLight);

  async function replacePrint(choice, entry, direction, dateLabel) {
    const thumbnail = choice.querySelector('img');
    if (printWindow.lastElementChild.src === thumbnail.src) return;
    const photo = thumbnail.cloneNode();
    photo.removeAttribute('loading');
    photo.alt = entry.alts[entry.scene.coverPhotoIndex];
    try { await photo.decode(); } catch { return; }
    if (selected !== choice) return;

    for (const animation of printAnimations) animation.cancel();
    printAnimations = [];
    const previous = printWindow.lastElementChild;
    const previousDetails = printCaption.lastElementChild;
    const details = previousDetails.cloneNode(true);
    const time = details.querySelector('time');
    details.querySelector('.print-title').textContent = entry.title;
    time.dateTime = entry.dayDate;
    time.textContent = dateLabel;
    if (!motion.matches) {
      printWindow.replaceChildren(photo);
      printCaption.replaceChildren(details);
      return;
    }
    previous.setAttribute('aria-hidden', 'true');
    printWindow.replaceChildren(previous, photo);
    previousDetails.setAttribute('aria-hidden', 'true');
    printCaption.replaceChildren(previousDetails, details);
    const edge = direction < 0 ? '0%' : '100%';
    const closed = `polygon(${edge} 0, ${edge} 0, ${edge} 100%, ${edge} 100%)`;
    const cutting = direction < 0 ? 'polygon(0 0, 68% 0, 44% 100%, 0 100%)' :
      'polygon(55% 0, 100% 0, 100% 100%, 32% 100%)';
    const open = 'polygon(0 0, 100% 0, 100% 100%, 0 100%)';
    // Match the polygon vertices at each edge so direction follows the filmstrip.
    const duration = 540;
    const splice = photo.animate([
      {clipPath: closed},
      {clipPath: cutting, offset: 0.36},
      {clipPath: open}
    ], {duration, easing: 'cubic-bezier(.22,.76,.24,1)'});
    // Keep the previous caption through the first part of the wipe.
    const captionTiming = {duration, fill: 'both'};
    const fadeOut = previousDetails.animate([
      {opacity: 1}, {opacity: 1, offset: .13}, {opacity: 0, offset: .20}, {opacity: 0}
    ], captionTiming);
    const fadeIn = details.animate([
      {opacity: 0}, {opacity: 0, offset: .20}, {opacity: 1, offset: .28}, {opacity: 1}
    ], captionTiming);
    printAnimations = [splice, fadeOut, fadeIn];
    splice.onfinish = () => {
      if (printAnimations[0] !== splice) return;
      previous.remove();
      previousDetails.remove();
      fadeOut.cancel();
      fadeIn.cancel();
      printAnimations = [];
    };
  }

  function selectMemory(choice, index) {
    if (choice === selected) return;
    const entry = demos[index];
    const name = choice.dataset.memory;
    const initial = !selected;
    const direction = index - choices.indexOf(selected);
    const dateLabel = dates.format(new Date(entry.dayDate));
    selected?.setAttribute('aria-pressed', 'false');
    choice.setAttribute('aria-pressed', 'true');
    selected = choice;
    roomChoices.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sampleChoice === name)));

    opening.dataset.memory = room.dataset.memory = name;
    setAtmosphere(name);
    replacePrint(choice, entry, direction, dateLabel);
    room.querySelector('h2').textContent = entry.title;
    date.dateTime = entry.dayDate;
    date.textContent = dateLabel;
    summary.textContent = descriptions[index];
    openDay.href = '/journal.html#day/' + entry.id;
    useExample.href = '/journal.html?example=' + encodeURIComponent(entry.id) + '#new';
    useExample.firstChild.textContent = 'Открыть материалы «' + entry.title + '» ';

    changes.disconnect();
    player?.destroy();
    player = mountPlayer(host, {...entry, photos: ['/media/' + name + '-preview.webp', ...entry.photos.slice(1)], audioPreload: 'none'});
    stage = host.querySelector('.stage');
    dialog = host.querySelector('dialog');
    changes.observe(stage, {attributes: true, attributeFilter: ['data-phase']});
    changes.observe(dialog, {attributes: true, attributeFilter: ['open']});
    syncLight();
    if (!initial) room.querySelector('#sample-status').textContent = 'Выбрана сцена «' + entry.title + '».';
  }

  choices.forEach((choice, index) => choice.addEventListener('click', () => selectMemory(choice, index)));
  roomChoices.forEach((button, index) => button.addEventListener('click', () => selectMemory(choices[index], index)));
  selectMemory(choices[0], 0);
  const heroPlay = print.querySelector('.hero-play');
  heroPlay.hidden = false;
  heroPlay.onclick = () => player.screen(heroPlay);
  opening.querySelector('.memory-dock').hidden = false;
  switcher.hidden = false;
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!visible && !dialog.open) player.pause();
    syncLight();
  });
  observer.observe(host);
  const chapterLinks = new Map([...document.querySelectorAll('.chapter-index a')].map(link => [link.hash.slice(1), link]));
  const visibleChapters = new Set();
  const chapters = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visibleChapters.add(entry.target.id);
      else visibleChapters.delete(entry.target.id);
    }
    const current = [...chapterLinks.keys()].findLast(id => visibleChapters.has(id));
    for (const [id, link] of chapterLinks) {
      if (id === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }, {rootMargin: '-53px 0px -60% 0px'});
  for (const id of chapterLinks.keys()) chapters.observe(document.getElementById(id));
  const copyHelp = document.querySelector('#day-copy');
  if (location.hash === '#day-copy') copyHelp.open = true;
  document.querySelector('#copy-help-link').addEventListener('click', () => { copyHelp.open = true; });

  const labHost = document.querySelector('#home-lab');
  nearViewport(labHost, async () => {
    const {mountHomeLab} = await import('./home-lab.mjs');
    lab = mountHomeLab(labHost, {onPlay: () => player.pause()});
  }, '/journal.html#day/demo-street', 'Открыть сцену в дневнике');
  host.addEventListener('click', event => {
    if (event.target.closest('.restart, .playbutton:not([aria-label="Пауза"])')) lab?.pause();
  }, true);
  const shelfHost = document.querySelector('#home-shelf');
  nearViewport(shelfHost, async () => {
    const {mountHomeShelf} = await import('./home-shelf.mjs');
    await mountHomeShelf(shelfHost);
    addEventListener('pageshow', event => { if (event.persisted) mountHomeShelf(shelfHost); });
  }, '/journal.html?mode=guest#archive', 'Открыть гостевой архив');
  motion.addEventListener('change', () => {
    if (!motion.matches) for (const animation of printAnimations) animation.finish();
    syncLight();
  });
  document.addEventListener('visibilitychange', syncLight);
  addEventListener('pagehide', event => {
    player.pause();
    lab?.pause();
    if (!event.persisted) {
      closed = true;
      light?.dispose();
    }
  });
}
