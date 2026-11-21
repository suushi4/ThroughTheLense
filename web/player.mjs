import {icon} from './icons.mjs';
import {timeLabel} from './ui.mjs';
import {phaseAt,sceneMontage} from './scene.mjs';
import {ambienceBed} from './ambience.mjs';

export function mountPlayer(host,entry,autoplay=false) {
  const {scene}=entry;
  host.innerHTML='<div class="viewer-frame"><div class="scene-head"><span class="scene-phase"></span><span>'+icon('music',14)+' <span class="scene-song"></span></span></div><div class="stage" data-phase="0"><img alt=""><div class="reveal" aria-hidden="true"><div class="quote-scroll"><blockquote></blockquote></div></div></div></div>'+
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
  const screenTitle=screen.querySelector('.screen-heading span');
  const closeScreen=screen.querySelector('.screen-close');
  screenTitle.textContent=entry.title;
  host.append(screen);
  let screenTrigger=expand;
  function openScreen(trigger){
    if(screen.open)return;
    screenTrigger=trigger;
    screen.append(frameElement,controls);
    screen.showModal();
    closeScreen.focus({preventScroll:true});
  };
  expand.onclick=()=>openScreen(expand);
  closeScreen.onclick=()=>screen.close();
  screen.onclose=()=>{
    pause();
    host.prepend(frameElement,controls);
    if(screenTrigger.isConnected)screenTrigger.focus({preventScroll:true});
  };
  const $=selector=>host.querySelector(selector);
  const stage=$('.stage'), photo=$('.stage img'), reveal=$('.reveal'), quoteScroll=$('.quote-scroll'), quote=$('blockquote'), endQuote=$('.afterquote');
  const slider=$('.meter'), play=$('.playbutton'), volume=$('.volume');
  const timeline=$('.timeline'), phaseLabel=$('.scene-phase'), clock=$('.time'), chapterGroup=$('.chapters');
  const errorText=$('.error');
  const end=scene.endAtSec;
  // «Звуки места»: looped field recordings under the song, if the day has them.
  let bed=ambienceBed(scene.ambience);
  const bedToggle=document.createElement('button');
  bedToggle.type='button';bedToggle.className='round ambience-toggle';bedToggle.innerHTML=icon('wave',16);
  function bedLabel(){
    const on=bed?.enabled!==false;
    bedToggle.setAttribute('aria-pressed',String(on));
    bedToggle.setAttribute('aria-label',on?'Выключить звуки места':'Включить звуки места');
    bedToggle.title=bedToggle.getAttribute('aria-label');
  }
  bedToggle.onclick=()=>{if(bed)setAmbienceEnabled(!bed.enabled);};
  function setAmbienceEnabled(on){
    if(!bed)return;
    bed.enabled=on;bedLabel();
    host.dispatchEvent(new CustomEvent('ambiencechange',{detail:on}));
  }
  bedToggle.hidden=!bed;bedLabel();
  $('.playline').insertBefore(bedToggle,$('.volume'));
  const ticks = host.querySelectorAll('.cue-ticks i');
  photo.src=entry.photos[scene.coverPhotoIndex]; photo.alt=entry.alts?.[scene.coverPhotoIndex] || 'Ключевой снимок дня';
  frameElement.style.setProperty('--scene-paper',scene.palette);
  controls.style.setProperty('--scene-paper',scene.palette);
  function renderMontage(phase){
    const montage=sceneMontage(scene.montage,entry.photos.length,scene.coverPhotoIndex);
    const detail=phase===1 && montage?.mode==='detail';
    const index=detail?montage.detailIndex:scene.coverPhotoIndex;
    if(photo.getAttribute('src')!==entry.photos[index])photo.src=entry.photos[index];
    photo.alt=entry.alts?.[index] || (detail?'Деталь дня':'Ключевой снимок дня');
    stage.toggleAttribute('data-detail',detail);
    bed?.setLevel(montage?.mode==='quiet' ? [1,0,.32][phase] : [1,.55,.85][phase]);
  }
  function writeQuote(value){quote.textContent=endQuote.textContent='«'+value+'»';reveal.classList.toggle('long',value.length>110);}
  writeQuote(scene.quote);
  const audio=new Audio();
  audio.preload=entry.audioPreload || 'auto';
  audio.src=entry.audio;
  slider.max=end;
  let frame=0, disposed=false, done=false, loading=false, position=0, currentPhase=-1, control='';
  let auditionEnd=null;
  const names=['Первый взгляд','За кадром','Второй взгляд'];
  $('.scene-song').textContent=entry.audioName;
  const chapterTimes = [0, scene.quoteAtSec, scene.returnAtSec];
  const chapters = names.map((name, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    const thumbnail=document.createElement('span');
    thumbnail.className='chapter-still';
    thumbnail.setAttribute('aria-hidden','true');
    const smallPhoto=document.createElement('img');
    smallPhoto.src=photo.src;smallPhoto.alt='';
    thumbnail.append(smallPhoto);
    if(index===1){
      const quoteMark=document.createElement('span');
      quoteMark.textContent='«';
      thumbnail.append(quoteMark);
    }
    const label=document.createElement('span');
    label.className='chapter-label';label.textContent=name;
    const time=document.createElement('small');
    label.append(time);
    button.append(thumbnail,label);
    button.onclick = () => seek(chapterTimes[index]);
    chapterGroup.append(button);
    return button;
  });
  chapterGroup.onkeydown = event => {
    const index = chapters.indexOf(event.target);
    if (index < 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    let next;
    switch (event.key) {
      case 'ArrowLeft': next = (index - 1 + chapters.length) % chapters.length; break;
      case 'ArrowRight': next = (index + 1) % chapters.length; break;
      case 'Home': next = 0; break;
      case 'End': next = chapters.length - 1; break;
      default: return;
    }
    event.preventDefault();
    chapters[next].focus({preventScroll:true});
    seek(chapterTimes[next]);
  };

  const lookMotion = matchMedia('(any-hover: hover) and (any-pointer: fine) and (prefers-reduced-motion: no-preference)');
  function centerPhoto(){
    stage.style.removeProperty('--scene-look-x');
    stage.style.removeProperty('--scene-look-y');
  }
  stage.onpointermove = event => {
    if(currentPhase!==2 || !lookMotion.matches || event.pointerType!=='mouse')return;
    const bounds = stage.getBoundingClientRect();
    const x = (0.5 - (event.clientX - bounds.left) / bounds.width) * 4;
    const y = (0.5 - (event.clientY - bounds.top) / bounds.height) * 4;
    stage.style.setProperty('--scene-look-x',x.toFixed(2)+'%');
    stage.style.setProperty('--scene-look-y',y.toFixed(2)+'%');
  };
  stage.onpointerleave=stage.onpointercancel=centerPhoto;
  lookMotion.addEventListener('change',centerPhoto);

  function updateCues(){
    for(const [index,value] of [scene.quoteAtSec,scene.returnAtSec].entries()){
      chapterTimes[index+1]=value;
      ticks[index].style.left=(100*value/end)+'%';
    }
    chapters.forEach((button,index)=>{
      const seconds=chapterTimes[index].toLocaleString('ru',{maximumFractionDigits:1})+' с';
      button.querySelector('small').textContent=seconds;
    });
    const quoteLength=scene.returnAtSec-scene.quoteAtSec;
    const returnLength=end-scene.returnAtSec;
    stage.style.setProperty('--paper-develop',Math.round(Math.min(460,quoteLength*420))+'ms');
    stage.style.setProperty('--quote-delay',Math.round(Math.min(90,quoteLength*95))+'ms');
    stage.style.setProperty('--quote-fade',Math.round(Math.min(240,quoteLength*250))+'ms');
    stage.style.setProperty('--return-move',Math.round(Math.min(720,returnLength*720))+'ms');
  }
  updateCues();
  function display(t){
    position=Math.min(end,Math.max(0,t||0));
    const phase=phaseAt(scene,position);
    if(phase!==currentPhase){
      if(currentPhase===2)centerPhoto();
      currentPhase=phase;stage.dataset.phase=phase;phaseLabel.textContent=names[phase];
      chapters.forEach((button,index)=>{
        button.setAttribute('aria-pressed',String(index===phase));
        button.toggleAttribute('data-passed',index<phase);
      });
      reveal.setAttribute('aria-hidden',String(phase!==1));
      renderMontage(phase);
      if(phase===1)quoteScroll.scrollTop=0;
      endQuote.hidden=phase!==2;
    }
    const chapterEnd = chapterTimes[phase + 1] ?? end;
    const chapterProgress = (position - chapterTimes[phase]) / Math.max(.001,chapterEnd - chapterTimes[phase]);
    chapterGroup.style.setProperty('--chapter-progress',chapterProgress);
    slider.value=position;slider.setAttribute('aria-valuetext',timeLabel(position));
    timeline.style.setProperty('--played',(100*position/end)+'%');
    if(bed && !audio.paused && end-position<=1.5)bed.fadeOut(end-position);
    clock.textContent=timeLabel(position)+' / '+timeLabel(end);
    const action=loading?'Загружается песня':done?'Повторить':audio.paused?'Воспроизвести':'Пауза';
    if(action!==control){
      control=action;
      play.setAttribute('aria-busy',String(loading));
      play.setAttribute('aria-label',action);play.title=action;
      play.innerHTML=icon(loading?'loader':done?'replay':audio.paused?'play':'pause',17);
    }
  }
  function finish(){auditionEnd=null;done=true;audio.pause();cancelAnimationFrame(frame);display(end);}
  function update(){
    if(disposed)return;
    if(audio.currentTime>=end){finish();return;}
    if(auditionEnd!==null && audio.currentTime>=auditionEnd){
      const stoppedAt=auditionEnd;
      auditionEnd=null;
      audio.pause();
      audio.currentTime=stoppedAt;
      cancelAnimationFrame(frame);
      display(stoppedAt);
      return;
    }
    display(done?end:audio.currentTime);
  }
  function animate(){update();if(!disposed && !audio.paused && !done)frame=requestAnimationFrame(animate);}
  function start(){
    if(disposed || loading)return;
    if(done){audio.currentTime=0;done=false;}
    errorText.textContent='';
    loading=true;
    display(position);
    audio.play().catch(error=>{
      if(disposed || error.name==='AbortError')return;
      auditionEnd=null;
      errorText.textContent='Музыка не запустилась. Нажмите «Воспроизвести» ещё раз или передвиньте ползунок для просмотра.';
    }).finally(()=>{
      loading=false;
      if(!disposed)display(position);
    });
  }
  function muted(){volume.innerHTML=icon(audio.muted?'mute':'sound',16);volume.setAttribute('aria-label',audio.muted?'Включить звук':'Выключить звук');volume.title=volume.getAttribute('aria-label');volume.setAttribute('aria-pressed',String(audio.muted));}
  audio.onplay=()=>{cancelAnimationFrame(frame);animate();bed?.start();};
  audio.addEventListener('pause',()=>bed?.stop(0.3));
  audio.onpause=update;audio.ontimeupdate=update;audio.onended=finish;
  audio.onerror=()=>{if(!disposed)errorText.textContent='Не удалось воспроизвести звук. Сцену можно посмотреть с помощью ползунка.';};
  play.onclick=()=>audio.paused?start():pause();
  $('.restart').onclick=()=>{seek(0);start();};
  function seek(value) {
    if (!Number.isFinite(value)) return;
    value = Math.max(0,Math.min(end,value));
    auditionEnd = null;
    done = false;
    if (!audio.error) audio.currentTime = value;
    if (value >= end) finish();
    else display(value);
  }
  slider.oninput = () => seek(Number(slider.value));
  volume.onclick=()=>{audio.muted=!audio.muted;bed?.mute(audio.muted);muted();};
  function pause(){
    auditionEnd=null;
    if(audio.paused)return;
    audio.pause();
    cancelAnimationFrame(frame);
    update();
  }
  function stopOriginals(){document.querySelectorAll('audio').forEach(a=>a.pause());}
  audio.addEventListener('play',stopOriginals);
  function setMontage(value){
    scene.montage=sceneMontage(value,entry.photos.length,scene.coverPhotoIndex);
    const index=scene.montage?.detailIndex ?? scene.coverPhotoIndex;
    chapters[1].querySelector('img').src=entry.photos[index];
    renderMontage(currentPhase);
  }
  display(0);setMontage(scene.montage);muted();if(autoplay)start();
  return {
    pause,
    setMontage,
    setAmbienceEnabled,
    ambienceEnabled:()=>bed?.enabled===true,
    screen(trigger){openScreen(trigger);seek(0);start();},
    seek(seconds){pause();seek(seconds);},
    audition(fromSeconds,endSeconds){
      const from=Math.max(0,fromSeconds), to=Math.min(end,endSeconds);
      if(!Number.isFinite(from) || !Number.isFinite(to) || to<=from)return;
      seek(from);
      auditionEnd=to;
      start();
    },
    setTitle(value){screenTitle.textContent=value;},
    setCues(cues){Object.assign(scene,cues);updateCues();display(position);},
    setQuote(value){scene.quote=value;writeQuote(value);},
    setAmbience(list){
      const playing=!audio.paused;
      bed?.destroy();
      bed=ambienceBed(list);bed?.mute(audio.muted);
      bedToggle.hidden=!bed;bedLabel();
      renderMontage(currentPhase);
      if(bed && playing)bed.start();
    },
    destroy(){
      disposed=true;
      lookMotion.removeEventListener('change',centerPhoto);
      stage.onpointermove=stage.onpointerleave=stage.onpointercancel=null;
      audio.onplay=audio.ontimeupdate=audio.onpause=audio.onended=audio.onerror=null;
      audio.removeEventListener('play',stopOriginals);
      cancelAnimationFrame(frame);audio.pause();audio.removeAttribute('src');audio.load();
      bed?.destroy();
    }
  };
}
