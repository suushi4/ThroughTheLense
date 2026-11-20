import {icon} from './icons.mjs';
import {timeLabel} from './ui.mjs';
import {phaseAt} from './scene.mjs';

export function mountPlayer(host,entry,autoplay=false) {
  const {scene}=entry;
  host.innerHTML='<div class="viewer-frame"><div class="stage" data-phase="0"><img alt=""><div class="reveal" aria-hidden="true"><blockquote></blockquote></div></div></div>'+
    '<div class="controls"><div class="playline"><button type="button" class="round playbutton"></button><div class="timeline"><span class="cue-ticks" aria-hidden="true"><i></i><i></i></span><input class="meter" type="range" aria-label="Позиция воспоминания" min="0" step="0.01" value="0"></div><span class="time"></span><button type="button" class="round restart" aria-label="С начала" title="С начала">'+icon('replay',16)+'</button><button type="button" class="round volume"></button></div><div class="chapters" role="group" aria-label="Моменты сцены"></div><p class="afterquote" hidden></p><p class="error" role="alert"></p></div>';
  const screen=document.createElement('dialog');
  screen.className='screening';
  screen.setAttribute('aria-label','Просмотр воспоминания');
  const frameElement=host.querySelector('.viewer-frame');
  const controls=host.querySelector('.controls');
  const expand=document.createElement('button');
  expand.type='button';expand.className='expand-scene';
  expand.innerHTML=icon('expand',18);
  expand.setAttribute('aria-label','Развернуть сцену');
  expand.title='Развернуть сцену';
  frameElement.append(expand);
  screen.innerHTML='<div class="screen-heading"><span></span><button type="button" class="screen-close">'+icon('close',18)+' Закрыть</button></div>';
  host.append(screen);
  expand.onclick=()=>{
    screen.querySelector('.screen-heading span').textContent=entry.title;
    screen.append(frameElement,controls);
    screen.showModal();
    screen.querySelector('.screen-close').focus();
  };
  screen.querySelector('.screen-close').onclick=()=>screen.close();
  screen.onclose=()=>{
    host.prepend(frameElement,controls);
    if(host.isConnected)expand.focus({preventScroll:true});
  };
  const $=selector=>host.querySelector(selector);
  const stage=$('.stage'), photo=$('.stage img'), reveal=$('.reveal'), quote=$('blockquote'), endQuote=$('.afterquote');
  const slider=$('.meter'), play=$('.playbutton'), volume=$('.volume');
  const end=scene.endAtSec;
  const ticks = host.querySelectorAll('.cue-ticks i');
  photo.src=entry.photos[scene.coverPhotoIndex]; photo.alt=entry.alts?.[scene.coverPhotoIndex] || 'Ключевой снимок дня';
  $('.viewer-frame').style.backgroundColor=scene.palette;
  function writeQuote(value){quote.textContent=endQuote.textContent='«'+value+'»';reveal.classList.toggle('long',value.length>110);}
  writeQuote(scene.quote);
  const audio=new Audio(entry.audio);audio.preload='auto';slider.max=end;
  let frame=0, disposed=false, done=false, position=0, currentPhase=-1, control='';
  const names=['Первый взгляд','За кадром','Второй взгляд'];
  const chapterTimes = [0, scene.quoteAtSec, scene.returnAtSec];
  const chapters = names.map((name, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    const thumbnail=document.createElement('span');
    thumbnail.className='chapter-still';
    thumbnail.setAttribute('aria-hidden','true');
    if(index===1)thumbnail.textContent='“';
    else{
      const smallPhoto=document.createElement('img');
      smallPhoto.src=photo.src;smallPhoto.alt='';
      thumbnail.append(smallPhoto);
    }
    const label=document.createElement('span');
    label.className='chapter-label';label.textContent=name;
    const time=document.createElement('small');
    button.setAttribute('aria-label',name);
    label.append(time);
    button.append(thumbnail,label);
    button.onclick = () => seek(chapterTimes[index]);
    $('.chapters').append(button);
    return button;
  });
  function updateCues(){
    for(const [index,value] of [scene.quoteAtSec,scene.returnAtSec].entries()){
      chapterTimes[index+1]=value;
      ticks[index].style.left=(100*value/end)+'%';
    }
    chapters.forEach((button,index)=>{
      const seconds=chapterTimes[index].toLocaleString('ru',{maximumFractionDigits:1})+' с';
      button.querySelector('small').textContent=seconds;
      button.setAttribute('aria-description','Перейти к отметке '+seconds);
    });
  }
  updateCues();
  function display(t){
    position=Math.min(end,Math.max(0,t||0));
    const phase=phaseAt(scene,position);
    if(phase!==currentPhase){
      currentPhase=phase;stage.dataset.phase=phase;
      chapters.forEach((button, index) => button.setAttribute('aria-pressed', String(index === phase)));
      reveal.setAttribute('aria-hidden',String(phase!==1));
      endQuote.hidden=phase!==2;
    }
    slider.value=position;slider.setAttribute('aria-valuetext',timeLabel(position));
    $('.time').textContent=timeLabel(position)+' / '+timeLabel(end);
    const action=done?'Повторить':audio.paused?'Воспроизвести':'Пауза';
    if(action!==control){control=action;play.setAttribute('aria-label',action);play.title=action;play.innerHTML=icon(done?'replay':audio.paused?'play':'pause',17);}
  }
  function finish(){done=true;audio.pause();cancelAnimationFrame(frame);display(end);}
  function update(){
    if(disposed)return;
    if(audio.currentTime>=end){finish();return;}
    display(done?end:audio.currentTime);
  }
  function animate(){update();if(!disposed && !audio.paused && !done)frame=requestAnimationFrame(animate);}
  function start(){
    if(disposed)return;
    if(done){audio.currentTime=0;done=false;}
    $('.error').textContent='';
    audio.play().catch(error=>{
      if(disposed || error.name==='AbortError')return;
      $('.error').textContent='Музыка не запустилась. Нажмите «Воспроизвести» ещё раз или передвиньте ползунок для просмотра.';display(position);
    });
  }
  function muted(){volume.innerHTML=icon(audio.muted?'mute':'sound',16);volume.setAttribute('aria-label',audio.muted?'Включить звук':'Выключить звук');volume.title=volume.getAttribute('aria-label');volume.setAttribute('aria-pressed',String(audio.muted));}
  audio.onplay=()=>{cancelAnimationFrame(frame);animate();};
  audio.onpause=update;audio.ontimeupdate=update;audio.onended=finish;
  audio.onerror=()=>{if(!disposed)$('.error').textContent='Не удалось воспроизвести звук. Сцену можно посмотреть с помощью ползунка.';};
  play.onclick=()=>audio.paused?start():pause();
  $('.restart').onclick=()=>{audio.currentTime=0;done=false;display(0);start();};
  function seek(value) {
    done = false;
    if (!audio.error) audio.currentTime = value;
    if (value >= end) finish();
    else display(value);
  }
  slider.oninput = () => seek(Number(slider.value));
  volume.onclick=()=>{audio.muted=!audio.muted;muted();};
  function pause(){
    if(audio.paused)return;
    audio.pause();
    cancelAnimationFrame(frame);
    update();
  }
  function stopOriginals(){document.querySelectorAll('audio').forEach(a=>a.pause());}
  audio.addEventListener('play',stopOriginals);
  display(0);muted();if(autoplay)start();
  return {
    pause,
    setCues(cues){Object.assign(scene,cues);updateCues();display(position);},
    setQuote(value){scene.quote=value;writeQuote(value);},
    destroy(){disposed=true;audio.onplay=audio.ontimeupdate=audio.onpause=audio.onended=audio.onerror=null;audio.removeEventListener('play',stopOriginals);cancelAnimationFrame(frame);audio.pause();audio.removeAttribute('src');audio.load();}
  };
}
