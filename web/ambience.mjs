// «Звуки места»: a quiet bed of looped field recordings under the song.
// The library holds CC0 loops (docs/ambience-licenses.md). A day stores the
// choice as scene.ambience = [{id, gain}]; unknown ids are dropped so old and
// imported days keep working.

const pattern = stems => new RegExp('(^|[^\\p{L}])(' + stems.join('|') + ')', 'iu');

// words: Russian word starts that point to the place. Kept specific so that,
// for example, «мороз» does not match the sea or «дома» a crowd.
export const ambienceLibrary = [
  {id:'rain', title:'Дождь', file:'rain.mp3', words:pattern(['дожд','ливн','ливен','морос','капл','зонт','гроз'])},
  {id:'wet-asphalt', title:'Мокрый асфальт', file:'wet-asphalt.mp3', words:pattern(['мокр','асфальт','луж','слякот','после дождя'])},
  {id:'street-traffic', title:'Улица', file:'street-traffic.mp3', words:pattern(['улиц','машин','дорог','пробк','перекр[её]ст','светофор','автобус','остановк','трамва','троллейбус','такси','город'])},
  {id:'park-birds', title:'Птицы в парке', file:'park-birds.mp3', words:pattern(['птиц','парк','сквер','сад[уаеы]?(?!\\p{L})','садов','аллея','аллее','аллеи','деревь','рассвет','весн','лес[ауе]?(?!\\p{L})','лесн'])},
  {id:'crowd-talk', title:'Голоса людей', file:'crowd-talk.mp3', words:pattern(['толп','люд','площад','рын[ео]к','рынк','разговор','праздник','ярмарк','концерт','фестивал','вокзал','очеред'])},
  {id:'cafe', title:'Кафе', file:'cafe.mp3', words:pattern(['каф[еэ]','кофе','кофейн','какао','ча[йяю]','чаепит','ресторан','бар[аеу]?(?!\\p{L})','столик','официант','завтрак','обед','ужин'])},
  {id:'wind', title:'Ветер', file:'wind.mp3', words:pattern(['вет[её]р','ветр','ветрен','сквозняк','бур[яиюе]','метел','вьюг','порыв'])},
  {id:'indoor-quiet', title:'Часы в тихой комнате', file:'indoor-quiet.mp3', words:pattern(['комнат','квартир','кухн','тишин','тих','дома(?!\\p{L})','у себя','книг','плед','часы','репетиц','зал[аеу]?(?!\\p{L})','сцен'])},
  {id:'stream', title:'Ручей', file:'stream.mp3', words:pattern(['руч[её]','речк','речн','рек[аиуе]','озер','вод[аыуео]','фонтан','водопад','тает','таял'])},
  {id:'sea', title:'Морской прибой', file:'sea.mp3', words:pattern(['мор[еяю](?!\\p{L})','морск','океан','прибой'])},
  {id:'night-crickets', title:'Сверчки ночью', file:'night-crickets.mp3', words:pattern(['сверч','цикад'])},
  {id:'campfire', title:'Треск костра', file:'campfire.mp3', words:pattern(['кост[её]р','костр','камин','дров'])},
  {id:'train', title:'Поезд', file:'train.mp3', words:pattern(['поезд','электричк','рельс'])},
];

const byId = new Map(ambienceLibrary.map(item => [item.id, item]));
export const ambienceItem = id => byId.get(id);
export const defaultAmbienceGain = 0.5;
const maxSounds = 4;

// sanitizeAmbience keeps known ids once each, with gain clamped to 0..1.
export function sanitizeAmbience(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(), out = [];
  for (const item of list) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!byId.has(id) || seen.has(id)) continue;
    const gain = Number.isFinite(item.gain) ? Math.min(1, Math.max(0, item.gain)) : defaultAmbienceGain;
    seen.add(id);
    out.push({id, gain: Math.round(gain * 100) / 100});
    if (out.length === maxSounds) break;
  }
  return out;
}

// suggestFromText ranks sounds by how many of their words the entry uses.
export function suggestFromText(text, limit = 3) {
  const sentences = String(text || '').toLowerCase();
  return ambienceLibrary
    .map(item => ({id: item.id, hits: (sentences.match(new RegExp(item.words.source, 'giu')) || []).length}))
    .filter(item => item.hits)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map(item => item.id);
}

// coverLight measures mean brightness (0..1) of a small copy of the image.
export async function coverLight(file) {
  const bitmap = await createImageBitmap(file, {resizeWidth: 32, resizeHeight: 32, resizeQuality: 'medium'});
  const canvas = new OffscreenCanvas(32, 32), context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = context.getImageData(0, 0, 32, 32).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  return sum / (data.length / 4) / 255;
}

// localSuggestion is the offline fallback: words of the entry, and for a
// dark cover without other clues, a quiet room.
export async function localSuggestion(text, cover) {
  const ids = suggestFromText(text);
  if (!ids.length && cover) {
    const light = await coverLight(cover).catch(() => null);
    if (light !== null && light < 0.22) ids.push('indoor-quiet');
  }
  return ids;
}

// reducedJPEG returns the cover scaled to at most 512 px as JPEG.
async function reducedJPEG(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({type: 'image/jpeg', quality: 0.8});
}

let visionAvailable;
async function visionEnabled() {
  return visionAvailable ??= fetch('/api/runtime', {cache: 'no-store',signal:AbortSignal.timeout(2500)})
    .then(response => response.ok ? response.json() : {})
    .then(config => config.ambience === 'vision')
    .catch(() => false);
}

// suggestAmbience asks the server to look at the cover when it can, and
// otherwise falls back to the local rules. Returns {ids, source}.
export async function suggestAmbience({text, cover}) {
  if (cover && await visionEnabled()) {
    try {
      const response = await fetch('/api/ambience/suggest', {
        method: 'POST', cache: 'no-store', signal:AbortSignal.timeout(6000),
        headers: {'X-Diary-Request': '1', 'Content-Type': 'image/jpeg'},
        body: await reducedJPEG(cover)
      });
      if (response.ok) {
        const {tags} = await response.json();
        const ids = (Array.isArray(tags) ? tags : [])
          .filter(tag => byId.has(tag?.id) && tag.confidence >= 0.5)
          .sort((a, b) => b.confidence - a.confidence)
          .map(tag => tag.id).slice(0, 3);
        if (ids.length) return {ids, source: 'photo'};
      }
    } catch {}
  }
  return {ids: await localSuggestion(text, cover), source: 'text'};
}

// ambienceBed mixes the chosen loops under the song with WebAudio.
export function ambienceBed(list) {
  const sounds = sanitizeAmbience(list);
  if (!sounds.length) return null;
  let context, master, buffers, sources = [], wanted = false, enabled = true, phaseGain = 1, muted = false, ending = false;
  const level = () => (!enabled || muted || ending) ? 0 : phaseGain;
  function ramp(value, seconds) {
    if (!master) return;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }
  function stopSources() {
    for (const source of sources) { try { source.stop(); } catch {} source.disconnect(); }
    sources = [];
  }
  async function load() {
    context ??= new (window.AudioContext || window.webkitAudioContext)();
    if (!master) {
      master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);
    }
    buffers ??= Promise.all(sounds.map(async sound => {
      const response = await fetch('/media/ambience/' + byId.get(sound.id).file);
      if (!response.ok) throw Error('ambience ' + sound.id);
      return {gain: sound.gain, buffer: await context.decodeAudioData(await response.arrayBuffer())};
    }));
    return buffers;
  }
  const spread = 1 / Math.sqrt(sounds.length);
  return {
    async start() {
      wanted = true; ending = false;
      let loaded;
      try { loaded = await load(); } catch { return; }
      if (!wanted) return;
      if (context.state === 'suspended') await context.resume().catch(() => {});
      if (!sources.length) {
        sources = loaded.map(({gain, buffer}) => {
          const source = context.createBufferSource(), node = context.createGain();
          source.buffer = buffer; source.loop = true;
          node.gain.value = gain * spread;
          source.connect(node).connect(master);
          source.start(0, Math.random() * buffer.duration);
          return source;
        });
      }
      ramp(level(), 1);
    },
    stop(seconds = 0.3) {
      wanted = false;
      if (!master) return;
      ramp(0, seconds);
      setTimeout(() => { if (!wanted) stopSources(); }, seconds * 1000 + 60);
    },
    fadeOut(seconds) { if (!ending) { ending = true; ramp(0, Math.max(0.2, seconds)); } },
    setLevel(gain) { if (gain !== phaseGain) { phaseGain = gain; if (wanted) ramp(level(), 0.5); } },
    mute(on) { muted = on; if (wanted) ramp(level(), 0.15); },
    get enabled() { return enabled; },
    set enabled(on) { enabled = on; if (wanted) ramp(level(), 0.4); },
    destroy() { wanted = false; stopSources(); context?.close().catch(() => {}); }
  };
}
