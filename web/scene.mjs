const wordPattern = /[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu;
export const words = value => value.match(wordPattern) || [];

function excerpt(value, limit = 135) {
  if (value.length <= limit) return value;
  const end = value.slice(0, limit).search(/\s+\S*$/u);
  return value.slice(0, end > 0 ? end : limit).trimEnd();
}

export function composeText(text) {
  if (!words(text).length) throw Error('Напишите хотя бы одно слово о своём дне.');
  const sentences = (text.match(/[^.!?…\r\n]+[.!?…]*/gu) || [])
    .map(s => s.trim()).filter(s => words(s).length);
  const score = s => (/(впервые|пахл|слыш|услыш|ждал|ждала|скрип|вкус|пальц|шеп|голос|хлоп|заметил)/iu.test(s) ? 4 : 0)
    + (s.length >= 16 && s.length <= 130 ? 2 : 0);
  const ranked = [...sentences].sort((a,b) => score(b) - score(a));
  const quotes = [...new Set([ranked[0], ...sentences].map(s => excerpt(s)))];
  const first = (sentences.find(s => words(s).length >= 3) || sentences[0]);
  const tokens = words(first);
  const title = tokens.length < 3 ? ['В', 'этот', 'день', ...tokens].join(' ') : tokens.slice(0,7).join(' ');
  return { title, quote: quotes[0], quotes };
}

export function rhythm(channels, sampleRate, duration) {
  const endAtSec = Math.min(12, duration);
  const windowSize = Math.max(1, Math.round(sampleRate * 0.1));
  const count = Math.ceil(endAtSec * sampleRate / windowSize);
  const energy = [];
  for (let n = 0; n < count; n++) {
    let power = 0, samples = 0;
    for (const channel of channels) {
      const end = Math.min(channel.length, Math.round(endAtSec * sampleRate), (n+1)*windowSize);
      for (let i=n*windowSize; i<end; i++) { power += channel[i] * channel[i]; samples++; }
    }
    energy.push(Math.sqrt(power / Math.max(1, samples)));
  }
  const peak = Math.max(0.0001, ...energy);
  const smooth = energy.map((x,i) => (x * 0.7 + (energy[i-1] ?? x) * 0.3) / peak);
  function accent(from,to,fallback) {
    let best = 0.095, selected = endAtSec*fallback;
    for (let i=1; i<smooth.length; i++) {
      const t = i*windowSize/sampleRate;
      const jump = Math.abs(smooth[i] - smooth[i-1]);
      if (t >= from*endAtSec && t <= to*endAtSec && jump > best) { best=jump; selected=t; }
    }
    return Math.round(selected*1000)/1000;
  }
  return {quoteAtSec: accent(0.20,0.40,0.33), returnAtSec: accent(0.62,0.82,0.72), endAtSec};
}

export function phaseAt(scene, time) {
  if (time >= scene.returnAtSec) return 2;
  return time >= scene.quoteAtSec ? 1 : 0;
}

export function validCues(cues, endAtSec) {
  return Number.isFinite(cues?.quoteAtSec) && Number.isFinite(cues.returnAtSec) &&
    cues.quoteAtSec >= 0.3 && cues.returnAtSec - cues.quoteAtSec >= 0.599 &&
    endAtSec - cues.returnAtSec >= 0.299;
}

export function checkPhotos(files) {
  if (files.length < 1 || files.length > 5) throw Error('Выберите от одной до пяти фотографий.');
  for (const file of files) {
    if (!(file.type ? /^image\/(jpeg|png|webp)$/.test(file.type) : /\.(jpe?g|png|webp)$/i.test(file.name))) throw Error('Подойдут фотографии JPEG, PNG и WebP.');
    if (file.size > 8*1024*1024) throw Error('Каждая фотография должна весить до 8 МиБ.');
  }
}

export function checkAudio(file) {
  if (!file) throw Error('Добавьте музыку для этого дня.');
  if (!/\.(mp3|wav|wave)$/i.test(file.name) && !/^audio\/(mpeg|mp3|(?:x-)?wav|wave|vnd.wave)$/i.test(file.type)) throw Error('Выберите файл MP3 или WAV.');
  if (file.size > 12*1024*1024) throw Error('Выберите трек размером до 12 МиБ.');
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src=url;
    await img.decode();
    return img;
  } catch { throw Error('Не удалось открыть снимок. Попробуйте другое фото.'); }
  finally { URL.revokeObjectURL(url); }
}

// Validate every image. Derive the palette and archive thumbnail from the selected cover.
export async function analyzePhotos(files, coverIndex=0) {
  checkPhotos(files);
  if(!Number.isInteger(coverIndex) || !files[coverIndex])throw Error('Выберите обложку из снимков дня.');
  let thumbnail, palette;
  for (const [index,file] of files.entries()) {
    const image = await loadImage(file);
    if (index !== coverIndex) continue;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 650 / Math.max(image.width,image.height));
    canvas.width=Math.max(1,Math.round(image.width*scale)); canvas.height=Math.max(1,Math.round(image.height*scale));
    const ctx=canvas.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const sums=[0,0,0]; let weight=0;
    for (let i=0; i<pixels.length; i+=4*7) {
      const alpha=pixels[i+3]/255; weight+=alpha;
      for (let c=0;c<3;c++) sums[c]+=pixels[i+c]*alpha;
    }
    palette='rgb('+[246,242,234].map((paper,c)=>Math.round(paper*0.76+(weight ? sums[c]/weight : paper)*0.24)).join(',')+')';
    ctx.globalCompositeOperation='destination-over'; ctx.fillStyle='#f6f2ea'; ctx.fillRect(0,0,canvas.width,canvas.height);
    thumbnail=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
    if (!thumbnail) throw Error('Не удалось подготовить миниатюру.');
  }
  return {thumbnail,palette};
}

export async function analyzeAudio(file) {
  checkAudio(file);
  const media = document.createElement('audio'), url=URL.createObjectURL(file);
  let timer;
  try {
    const duration=await new Promise((resolve,reject)=>{
      media.onloadedmetadata=()=>resolve(media.duration);
      media.onerror=()=>reject(Error());
      timer=setTimeout(()=>reject(Error()),12000);
      media.preload='metadata'; media.src=url;
    });
    if (!Number.isFinite(duration) || duration<2.999 || duration>60.001) throw RangeError();
    const bytes=await file.arrayBuffer();
    const Offline=window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoded=await new Offline(1,1,22050).decodeAudioData(bytes);
    if(decoded.duration<2.999 || decoded.duration>60.001) throw RangeError();
    const channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i));
    return rhythm(channels,decoded.sampleRate,decoded.duration);
  } catch (err) {
    if(err instanceof RangeError) throw Error('Нужен фрагмент длительностью от 3 до 60 секунд.');
    throw Error('Не удалось прочитать песню. Выберите другой MP3 или WAV.');
  } finally {
    clearTimeout(timer); media.onloadedmetadata=null; media.onerror=null;
    media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url);
  }
}
