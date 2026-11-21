import {demos} from './demo.mjs';
import {mountPlayer} from './player.mjs';
import {escapeHTML as h} from './ui.mjs';

const memory=demos[0];
const duration=memory.scene.endAtSec;
const seconds=value=>value.toLocaleString('ru',{maximumFractionDigits:1})+' с';

function trackRow(track,index) {
  const {quoteAtSec,returnAtSec}=track.scene;
  return `<label class="lab-track">
    <input name="lab-soundtrack" type="radio" value="${index}"${index===0?' checked':''}>
    <span class="lab-track-title">${h(track.audioName)}</span>
    <span class="lab-track-time"><span class="visually-hidden">Фраза через </span>${seconds(quoteAtSec)}</span>
    <span class="lab-track-range" aria-hidden="true" style="--cue-start:${100*quoteAtSec/duration}%;--cue-end:${100*returnAtSec/duration}%"><i></i></span>
    <span class="visually-hidden">Кадр снова через ${seconds(returnAtSec)}</span>
  </label>`;
}

export function mountHomeLab(host,{onPlay}={}) {
  host.classList.add('home-lab');
  host.innerHTML=`<fieldset class="lab-tracks">
      <legend>Выберите песню</legend>
      <div class="lab-ruler" aria-hidden="true"><span>0 с</span><span>${seconds(duration/2)}</span><span>${seconds(duration)}</span></div>
      ${demos.map(trackRow).join('')}
      <p class="lab-key"><i aria-hidden="true"></i> Фраза на экране</p>
      <p class="visually-hidden" role="status"></p>
    </fieldset>
    <div class="lab-screen" role="region" aria-label="Сцена для сравнения песен"></div>`;

  const screen=host.querySelector('.lab-screen');
  const tracks=host.querySelector('.lab-tracks');
  const status=tracks.querySelector('[role="status"]');
  let player;

  function selectTrack(index,announce=false) {
    const track=demos[index];
    const position=Number(screen.querySelector('.meter')?.value ?? 0);
    const muted=screen.querySelector('.volume')?.getAttribute('aria-pressed')==='true';
    player?.destroy();
    player=mountPlayer(screen,{
      ...memory,
      audio:track.audio,
      audioName:track.audioName,
      audioPreload:'none',
      photos:['/media/street-preview.webp'],
      scene:{...memory.scene,quoteAtSec:track.scene.quoteAtSec,returnAtSec:track.scene.returnAtSec}
    });
    if(muted)screen.querySelector('.volume').click();
    if(position>0 && position<duration)player.seek(position);
    if(announce)status.textContent=`${track.audioName}. Фраза через ${seconds(track.scene.quoteAtSec)}.`;
  }

  tracks.addEventListener('change',event=>selectTrack(Number(event.target.value),true));
  screen.addEventListener('click',event=>{
    if(event.target.closest('.restart, .playbutton:not([aria-label="Пауза"])'))onPlay?.();
  },true);
  selectTrack(0);

  const visibility=new IntersectionObserver(([entry])=>{
    if(!entry.isIntersecting && !screen.querySelector('dialog[open]'))player.pause();
  });
  visibility.observe(screen);

  return {
    pause(){player.pause();},
    destroy(){visibility.disconnect();player.destroy();host.replaceChildren();}
  };
}
