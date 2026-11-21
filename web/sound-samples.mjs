import {ambienceItem,sanitizeAmbience} from './ambience.mjs';
import {icon} from './icons.mjs';

// Buttons and audio refer only to sounds in the bundled library.
export function soundButton({id,gain}){
  const {title}=ambienceItem(id);
  return `<button type="button" class="sound-sample" data-listen="${id}" data-gain="${gain}" aria-label="Послушать «${title}»" aria-pressed="false"><span class="sample-symbol" aria-hidden="true">${icon('play',14)}${icon('pause',14)}</span>${title}</button>`;
}

export const sampleOutput='<audio class="sample-audio" preload="none" hidden></audio><p class="sample-status" role="status"></p>';

export function daySounds(ambience){
  const list=sanitizeAmbience(ambience);
  if(!list.length)return '';
  return `<section class="day-sounds" aria-label="Звуки места"><h3>Звуки места</h3><div class="ambience-chips">${list.map(soundButton).join('')}</div>${sampleOutput}</section>`;
}

export function mountSoundSamples(host,beforePlay){
  const audio=host.querySelector('.sample-audio'), status=host.querySelector('.sample-status');
  let current='',request=0;
  function refresh(){
    const selected=current && host.querySelector(`[data-listen="${current}"]`);
    if(current && !selected){stop();return;}
    if(selected)audio.volume=Number(selected.dataset.gain);
    for(const button of host.querySelectorAll('[data-listen]')){
      button.setAttribute('aria-pressed',String(button===selected && !audio.paused));
    }
  }
  function stop(){
    request++;
    current='';
    audio.pause();
    status.textContent='';
    refresh();
  }
  host.addEventListener('click',async event=>{
    const button=event.target.closest('[data-listen]');
    if(!button)return;
    const id=button.dataset.listen;
    if(current===id){stop();return;}
    stop();
    const turn=request;
    current=id;
    beforePlay();
    audio.src='/media/ambience/'+ambienceItem(id).file;
    audio.volume=Number(button.dataset.gain);
    try{await audio.play();}
    catch{
      if(turn!==request || !host.isConnected)return;
      stop();
      status.textContent='Не удалось воспроизвести звук. Нажмите ещё раз.';
    }
  });
  audio.addEventListener('play',refresh);
  audio.addEventListener('pause',()=>{if(audio.paused && current)stop();});
  audio.addEventListener('ended',stop);
  return {refresh,stop};
}
