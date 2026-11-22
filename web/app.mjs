import {icon} from './icons.mjs';
import {renderArchiveCalendar,shiftMonth} from './archive-calendar.mjs';
import {escapeHTML as h,dateLabel,timeLabel} from './ui.mjs';
import {composeText,words,analyzePhotos,analyzeAudio,checkPhotos,checkAudio,validCues,pacedCues,coverWarmth,sceneMontage} from './scene.mjs';
import {connectDiary,getDay,listDays,saveDay,getDraft,saveDraft,removeDay} from './diary.mjs';
import {demos,exampleFile} from './demo.mjs';
import {diaryTracks,libraryTracks} from './tracks.mjs';
import {mountPlayer} from './player.mjs';
import {exportDay,importDay} from './transfer.mjs';
import {openShare,shareSupported} from './share.mjs';
import {logout} from './account.mjs';
import {avatarHTML,displayName} from './avatar.mjs';
import {ambienceLibrary,ambienceItem,defaultAmbienceGain,sanitizeAmbience,suggestAmbience} from './ambience.mjs';
import {soundButton,sampleOutput,daySounds,mountSoundSamples} from './sound-samples.mjs';

const main=document.querySelector('main'), dialog=document.querySelector('#dialog');
const $=selector=>main.querySelector(selector);
const query=new URLSearchParams(location.search);
const guestMode=query.get('mode')==='guest';
const requestedExample=query.get('example');
const examplePreset=demos.find(day=>day.id===requestedExample);
let turn=0, urls=[], player=null, draft=null, preview=null, filter=null, archiveQuery='', toastTimer, playOnOpen='', visited=false;
let draftWrites=Promise.resolve();
let accountUser=null, shareable=false;
let archiveReturn=null;
let archiveView='list', calendarMonth='', calendarDate='';
const pendingDrafts=new Map();
const back='<a class="back" href="#archive">'+icon('back',16)+' К архиву</a>';
function localDate(){
  const d=new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function newId(){
  return crypto.randomUUID?.() || Date.now()+'-'+Math.random().toString(36).slice(2);
}
function newDraft(editing){
  const id=editing?.id ?? newId();
  return {
    id,key:editing?.id ?? 'new',dayDate:editing?.dayDate ?? localDate(),text:editing?.text ?? '',
    photos:editing?.photoFiles ?? [],coverIndex:editing?.scene.coverPhotoIndex ?? 0,
    detail:'',montage:editing?.scene.montage,
    audio:editing?.audioFile ?? null,audioName:editing?.audioName ?? '',
    title:editing?.title ?? '',quote:editing?.scene.quote ?? '',
    cues:editing?.scene && {quoteAtSec:editing.scene.quoteAtSec,returnAtSec:editing.scene.returnAtSec},revision:0,
    // An edited day keeps its sounds as chosen; a new one gets a suggestion.
    ambience:editing ? sanitizeAmbience(editing.scene.ambience) : null,ambienceSource:editing ? 'manual' : ''
  };
}
function draftStatus(message){
  const status=$('#draft-status');
  if(status)status.textContent=message;
}
function persistDraft(state){
  const snapshot={...state,photos:[...state.photos]};
  pendingDrafts.set(snapshot.key,snapshot);
  draftStatus('Сохраняем черновик…');
  draftWrites=draftWrites.then(async()=>{
    if(pendingDrafts.get(snapshot.key)!==snapshot)return;
    let message='Черновик сохранён';
    try{await saveDraft(snapshot.key,snapshot);}
    catch{message='Черновик пока не сохранён';}
    if(pendingDrafts.get(snapshot.key)===snapshot){
      pendingDrafts.delete(snapshot.key);
      if(draft===state && $('#save')?.getAttribute('aria-busy')!=='true')draftStatus(message);
    }
  });
}
function objectURL(blob){const url=URL.createObjectURL(blob);urls.push(url);return url;}
function displayDay(entry) {
  if(entry.example)return entry;
  return {...entry,photos:entry.photoFiles.map(objectURL),audio:objectURL(entry.audioFile)};
}
function toast(message){
  const node=document.querySelector('#status');node.textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.textContent='',4000);
}
function popup(contents,label){
  const body=document.querySelector('#dialog-body');body.innerHTML=contents;dialog.setAttribute('aria-label',label);if(!dialog.open)dialog.showModal();
}
document.querySelector('#about-trigger').onclick=()=>popup(
  '<h2>О дневнике</h2><p>Добавьте снимок, несколько строк и песню. На музыкальном акценте появится ваша фраза, а затем вернётся тот же кадр.</p><p>'+
  (accountUser?'Записи хранятся в вашем аккаунте. Черновики остаются в этом браузере.':'Гостевые записи остаются в этом браузере. Очистка данных сайта удаляет гостевой архив.')+
  '</p>','О дневнике');
document.querySelector('#dialog-close').onclick=()=>dialog.close();
dialog.onclick=e=>{if(e.target===dialog && e.offsetX>=0 && e.offsetY>=0 && (e.clientX<dialog.getBoundingClientRect().left || e.clientX>dialog.getBoundingClientRect().right || e.clientY<dialog.getBoundingClientRect().top || e.clientY>dialog.getBoundingClientRect().bottom))dialog.close();};
document.querySelector('.skip').onclick=e=>{e.preventDefault();main.focus();};
function rememberArchive(trigger){
  archiveReturn={scroll:window.scrollY,selector:trigger.id?'#'+trigger.id:trigger.classList.contains('feature')?'.feature':'.day-card',href:trigger.getAttribute('href'),
    featured:$('.feature')?.getAttribute('href')};
}
document.addEventListener('click',event=>{
  if(event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)return;
  const link=event.target.closest('[data-play]');
  if(link)playOnOpen=link.dataset.play;
  const archiveLink=event.target.closest('.day-card, .feature');
  if(main.dataset.page==='archive' && archiveLink)rememberArchive(archiveLink);
});
window.addEventListener('pagehide',()=>player?.pause());
function errorText(id,message){
  const el=$('#err-'+id);
  if(!el)return;
  el.textContent=message;
  for(const field of main.querySelectorAll('[aria-describedby~="'+el.id+'"]')){
    if(message)field.setAttribute('aria-invalid','true');
    else field.removeAttribute('aria-invalid');
  }
}
function title(name){document.title=name+' · ThroughTheLense';}
function heading(name,subtitle=''){return '<div class="page-heading">'+back+'<h1>'+h(name)+'</h1>'+(subtitle?'<p>'+h(subtitle)+'</p>':'')+'</div>';}
function step(id,number,label){
  return `<h2 class="step-title" id="step-${id}" data-material="${id}"><span aria-hidden="true" data-number="${number}">${number}</span>${label}<small class="sr-only"></small></h2>`;
}
function recordedText(state){
  return [state.text.trim(),state.detail?.trim()].filter(Boolean).join('\n\n');
}
function selectedQuote(state,text,composition){
  if(state.quote && text.includes(state.quote))return state.quote;
  const detail=state.detail?.trim();
  if(detail && words(detail).length)return detail;
  return composition?.quote ?? (words(text).length?composeText(text).quote:'');
}
function makePreview(state,composition,photo,timing){
  const text=recordedText(state), detail=state.detail?.trim();
  const quotes=[...new Set([...(detail && words(detail).length ? [detail] : []),...composition.quotes])];
  const quote=selectedQuote(state,text,composition);
  const scene={version:1,coverPhotoIndex:state.coverIndex,quote,palette:photo.palette,...timing,
    ...(validCues(state.cues,timing.endAtSec)?state.cues:{})};
  scene.montage=sceneMontage(state.montage,state.photos.length,state.coverIndex);
  const ambience=sanitizeAmbience(state.ambience);
  if(ambience.length)scene.ambience=ambience;
  const entry={id:state.id,dayDate:state.dayDate,title:state.title||composition.title,text,audioName:state.audioName,
    photoFiles:[...state.photos],audioFile:state.audio,scene};
  return {entry,quotes,thumbnail:photo.thumbnail,revision:state.revision,timing};
}
const cueLabel=value=>value.toLocaleString('ru',{maximumFractionDigits:2})+' с';
function card(day) {
  return `<a class="day-card" href="#day/${encodeURIComponent(day.id)}">
    <div class="card-img"><img loading="lazy" src="${h(day.thumbnail)}" alt=""><span class="card-open" aria-hidden="true">${icon('arrow',16)}</span></div>
    <div class="card-date"><time datetime="${h(day.dayDate)}">${h(dateLabel(day.dayDate))}</time>
      <span class="photo-count" aria-label="Количество снимков: ${day.photoCount}">${icon('stack',14)} ${day.photoCount}</span>
    </div>
    <h3>${h(day.title)}</h3><p class="card-track">${icon('music',15)}${h(day.audioName)}</p>
  </a>`;
}

function featurePage(day) {
  const duration = day.scene?.endAtSec ?? day.duration;
  return `<a class="feature" href="#day/${encodeURIComponent(day.id)}" data-play="${h(day.id)}">
    <div class="feature-print"><img src="${h(day.thumbnail)}" alt="${h(day.alts?.[day.scene?.coverPhotoIndex ?? 0] || '')}"></div>
    <div class="feature-caption">
      <div class="feature-story">
        <div class="feature-date"><span>${day.example ? 'Пример' : 'Личный день'}</span><time datetime="${h(day.dayDate)}">${h(dateLabel(day.dayDate))}</time></div>
        <h2>${h(day.title)}</h2>
      </div>
      <span class="open-feature" title="Смотреть день">${icon('play',20)} <span>Смотреть день</span></span>
    </div>
    <div class="feature-track">${icon('music',16)}<span>${h(day.audioName)}</span>${duration ? '<time class="feature-duration">'+timeLabel(duration)+'</time>' : ''}</div>
  </a>`;
}

const foldText = text => text.toLocaleLowerCase('ru').replaceAll('ё','е').trim();

// Input is newest first. Preserve that order for both the cover and the folder list.
function matchingDays(days, source, query) {
  const terms=foldText(query).split(/\s+/u).filter(Boolean);
  return days.filter(day=>{
    if(source==='mine' && day.example || source==='demo' && !day.example)return false;
    const numericDate=day.dayDate.split('-').reverse().join('.');
    const label=foldText([day.title,day.audioName,day.dayDate,numericDate,dateLabel(day.dayDate)].join(' '));
    return terms.every(term=>label.includes(term));
  });
}
async function archive(stamp) {
  title('Архив дней');
  await draftWrites;
  const [entries,unfinished]=await Promise.allSettled([listDays(),getDraft('new')]);
  if(stamp!==turn)return;
  const unavailable=entries.status==='rejected';
  let own=entries.value ?? [];
  if(filter===null || accountUser)filter=accountUser || own.length?'mine':'all';
  own=own.map(x=>({...x,thumbnail:objectURL(x.thumbnail)}));
  const days=[...own,...(accountUser?[]:demos)].sort((a,b)=>b.dayDate.localeCompare(a.dayDate)||b.id.localeCompare(a.id));
  let featureIndex=0, visible=[];
  main.innerHTML = `<section class="archive-hero" aria-labelledby="archive-heading"><div class="wrap intro">
      <h1 id="archive-heading">Архив дней</h1>
      <p>${accountUser?'Личные записи хранятся в аккаунте.':guestMode?'Гостевой режим. Записи хранятся в этом браузере.':'Гостевые записи хранятся в этом браузере.'}</p>
      ${unfinished.value?'<a class="textbtn" id="resume-draft" href="#new">'+icon('book',17)+' Продолжить черновик</a>':''}
    </div></section>
    <section class="collection wrap" aria-label="Записи архива">
      <div class="archive-tools">
        <div class="search-field"><label for="archive-query" class="sr-only">Поиск по архиву</label><div class="archive-search">${icon('search',18)}<input id="archive-query" type="search" aria-label="Поиск по названию, песне или дате" placeholder="Название, песня или дата" autocomplete="off"><button type="button" id="clear-query" aria-label="Очистить поиск" hidden>${icon('close',16)}</button></div></div>
        <div class="filters" role="group" aria-label="Какие дни показать"${accountUser?' hidden':''}>${[['all','Все дни'],['mine','Мои дни'],['demo','Примеры']].map(([key,label])=>'<button class="chip" type="button" data-filter="'+key+'">'+label+'</button>').join('')}</div>
      </div>
      <div class="archive-view" role="group" aria-label="Вид архива">
        <button class="chip" type="button" data-archive-view="list">Список</button>
        <button class="chip" type="button" data-archive-view="calendar">Календарь</button>
      </div>
      <div class="collection-head"><span id="day-count" class="count" role="status"></span>
        <div class="collection-actions"><button class="btn secondary" type="button" id="random-day">${icon('shuffle',16)} Случайный день</button>
        <button class="btn secondary" type="button" id="import-day">${icon('folder',16)} Открыть файл дня</button></div></div>
      <details class="collection-help"><summary>Как открыть копию дня?</summary><p>В записи выберите «Действия» → «Скачать копию». В архиве нажмите «Открыть файл дня» и выберите файл JSON.</p></details>
      <input type="file" id="day-file" accept=".json,application/json" aria-label="Файл копии дня" hidden>
      <p id="err-import" class="error" role="alert"></p>
      <div class="archive-results">
        <div id="folders"></div>
        <div class="spread" role="region" aria-label="Воспоминание из архива">
          <div id="featured-day"></div>
          <div class="spread-nav" role="group" aria-label="Листать воспоминания">
            <button id="previous-feature" aria-label="Предыдущий день">${icon('back',17)}</button>
            <span id="spread-position" aria-hidden="true"></span>
            <button id="next-feature" aria-label="Следующий день">${icon('arrow',17)}</button>
          </div>
        </div>
      </div><p class="sr-only" id="spread-status" role="status" aria-atomic="true"></p></section>`;
  const importButton=$('#import-day'),dayFile=$('#day-file');
  importButton.disabled=unavailable;
  importButton.onclick=()=>dayFile.click();
  dayFile.onchange=async()=>{
    const file=dayFile.files[0];
    dayFile.value='';
    if(!file)return;
    importButton.disabled=true;
    importButton.textContent='Открываем копию…';
    errorText('import','');
    try{
      const {entry,thumbnail}=await importDay(file,newId());
      await saveDay(entry,thumbnail);
      if(stamp===turn){
        filter='mine';archiveQuery='';archiveReturn=null;toast('Копия дня добавлена в архив');
        location.hash='day/'+encodeURIComponent(entry.id);
      }
    }catch(error){
      if(stamp===turn)errorText('import',error instanceof DOMException
        ?'Не удалось открыть копию. Проверьте, что файл цел и в браузере есть свободное место.'
        :error.message);
    }finally{
      if(stamp===turn){
        importButton.disabled=false;
        importButton.innerHTML=icon('folder',16)+' Открыть файл дня';
      }
    }
  };
  function showFeature(index,announce=false) {
    featureIndex = (index + visible.length) % visible.length;
    const day=visible[featureIndex], position=featureIndex+1;
    $('#featured-day').innerHTML = featurePage(day);
    $('#spread-position').textContent = position+' / '+visible.length;
    if(announce)$('#spread-status').textContent=`${day.title}. ${position} из ${visible.length}.`;
  }
  $('#previous-feature').onclick = () => showFeature(featureIndex - 1,true);
  $('#next-feature').onclick = () => showFeature(featureIndex + 1,true);
  $('.spread').onkeydown=event=>{
    if(visible.length<2 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)return;
    const direction={ArrowLeft:-1,ArrowRight:1}[event.key];
    if(!direction)return;
    event.preventDefault();
    const focusFeature=Boolean(event.target.closest('.feature'));
    showFeature(featureIndex+direction,!focusFeature);
    if(focusFeature)$('.feature').focus({preventScroll:true});
  };
  $('#random-day').onclick=()=>{
    const alternatives=visible.filter((day,index)=>index!==featureIndex);
    const day=alternatives[Math.floor(Math.random()*alternatives.length)] ?? visible[featureIndex];
    if(!day)return;
    rememberArchive($('#random-day'));
    playOnOpen=day.id;
    location.hash='day/'+encodeURIComponent(day.id);
  };
  function draw(featuredHref){
    visible=matchingDays(days,filter,archiveQuery);
    $('#spread-status').textContent='';
    const calendar=archiveView==='calendar';
    $('.archive-results').classList.toggle('calendar-view',calendar);
    main.querySelectorAll('[data-archive-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.archiveView===archiveView)));
    $('.spread').hidden=calendar||!visible.length;
    $('.spread-nav').hidden=visible.length<2;
    $('#random-day').hidden=visible.length<2;
    if(visible.length)showFeature(Math.max(0,visible.findIndex(day=>'#day/'+encodeURIComponent(day.id)===featuredHref)));
    else $('#featured-day').replaceChildren();
    const forms={one:'запись',few:'записи',many:'записей',other:'записи'};
    $('#day-count').textContent=visible.length+' '+forms[new Intl.PluralRules('ru').select(visible.length)];
    $('#clear-query').hidden=!archiveQuery;
    main.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));
    let content;
    if(calendar){
      const today=localDate(), thisMonth=today.slice(0,7);
      calendarMonth ||= visible.find(day=>day.dayDate<=today)?.dayDate.slice(0,7) || thisMonth;
      if(calendarMonth>thisMonth){calendarMonth=thisMonth;calendarDate='';}
      content=renderArchiveCalendar(visible,calendarMonth,calendarDate,card,today);
    }
    else if(visible.length){
      const months=Map.groupBy(visible,day=>day.dayDate.slice(0,7));
      const format=new Intl.DateTimeFormat('ru',{month:'long',year:'numeric',timeZone:'UTC'});
      content=[...months].map(([month,items])=>`<section class="archive-month"><h3>${h(format.format(new Date(month+'-01')))}</h3><div class="grid">${items.map(card).join('')}</div></section>`).join('');
    }
    else if(archiveQuery.trim())content='<div class="empty">'+icon('search',28)+'<h3>Совпадений пока нет</h3><p>Попробуйте другое название, песню или дату.</p><button id="reset-search" class="btn secondary">Сбросить поиск</button></div>';
    else if(unavailable)content='';
    else content='<div class="empty">'+icon('folder',29)+'<h3>Ваш первый день</h3><p>Добавьте снимок, музыку и пару строк о том, что запомнилось.</p><a class="btn primary" id="start-first-day" href="#new">Записать день</a></div>';
    $('#folders').innerHTML=(unavailable?'<p class="error" role="alert">Архив сейчас недоступен. Попробуйте обновить страницу.</p>':'')+content;
    if($('#reset-search'))$('#reset-search').onclick=clearQuery;
    main.querySelectorAll('[data-month-step]').forEach(button=>button.onclick=()=>{
      const step=button.dataset.monthStep;
      calendarMonth=shiftMonth(calendarMonth,Number(step));
      calendarDate='';
      draw();
      const next=$('[data-month-step="'+step+'"]');
      (next.disabled?$('[data-month-step="-1"]'):next).focus();
    });
    main.querySelectorAll('[data-calendar-date]').forEach(button=>button.onclick=()=>{
      calendarDate=button.dataset.calendarDate;
      draw();
      $('[data-calendar-date="'+calendarDate+'"]').focus();
    });
  }
  const input=$('#archive-query');
  function clearQuery(){archiveQuery=input.value='';calendarMonth=calendarDate='';draw();input.focus();}
  input.value=archiveQuery;
  input.oninput=()=>{archiveQuery=input.value;calendarMonth=calendarDate='';draw();};
  $('#clear-query').onclick=clearQuery;
  main.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;calendarMonth=calendarDate='';draw();});
  main.querySelectorAll('[data-archive-view]').forEach(button=>button.onclick=()=>{archiveView=button.dataset.archiveView;draw();});
  draw(archiveReturn?.featured);
}
async function formPage(stamp,editing){
  const key=editing?.id ?? 'new';
  if(draft?.key!==key){
    await draftWrites;
    const restored=await getDraft(key).catch(()=>undefined);
    if(stamp!==turn)return;
    draft=restored ?? newDraft(editing);
    preview=null;
  }
  const pageName=editing?'Редактировать день':'Новый день';
  title(pageName);
  const d=draft;
  const preset=editing?undefined:examplePreset;
  const sample=preset ?? (accountUser?null:demos[0]);
  const availableTracks=accountUser ? libraryTracks : diaryTracks;
  const sampleLabel=preset?`Взять материалы «${preset.title}»`:'Взять материалы примера';
  main.innerHTML=heading(pageName,'Выберите, что поможет вспомнить этот день.')+`
    <div class="form-wrap"><form novalidate>
      <div class="form-line"><div class="material-status"><progress id="material-progress" max="3" value="0" aria-label="Готовность материалов"></progress><span id="material-count">0 из 3 готово</span></div>
        ${sample?`<button type="button" class="textbtn" id="fill-demo">${icon('folder',15)} ${h(sampleLabel)}</button>`:''} </div>
      <section class="form-step" aria-labelledby="step-story">${step('story','1','Рассказ')}
        <div class="field"><label for="date">Дата дня</label><input type="date" id="date" required max="${localDate()}" aria-describedby="err-date"><p id="err-date" class="error" role="alert"></p></div>
        <div class="field"><label for="story">Как прошёл день?</label><textarea id="story" required rows="4" placeholder="Запомнилось, как…" aria-describedby="err-story"></textarea><p id="err-story" class="error" role="alert"></p></div>
        <div class="field"><label for="memory-detail">Что осталось за кадром? <small>Необязательно</small></label><textarea id="memory-detail" rows="2" maxlength="180" placeholder="Что вы услышали, почувствовали или заметили?"></textarea></div>
      </section>
      <section class="form-step" aria-labelledby="step-photos">${step('photos','2','Фотографии')}
        <div class="field"><label class="sr-only" for="photos">Добавить фотографии</label><span class="hint" id="photo-hint">До 5 снимков в JPEG, PNG или WebP. Нажмите на снимок, чтобы выбрать обложку.</span>
          <div class="drop">${icon('image')} Добавить фотографии<input type="file" multiple id="photos" accept="image/jpeg,image/png,image/webp" aria-describedby="photo-hint err-photos"></div>
          <div class="attachments" id="photo-list" role="group" aria-label="Выбор обложки"></div><p id="err-photos" class="error" role="alert"></p></div>
      </section>
      <aside class="cover-proof" aria-label="Обложка и фраза новой записи">
        <h2>Обложка дня</h2>
        <figure class="proof-sheet"><div class="proof-window"><img id="proof-image" alt="Выбранная обложка" hidden><span id="proof-placeholder">${icon('image',32)}Здесь появится ваш снимок</span></div><figcaption id="proof-date"></figcaption></figure>
        <blockquote class="proof-quote" id="proof-quote" hidden></blockquote>
        <p class="proof-song">${icon('music',16)}<span id="proof-song"></span></p>
      </aside>
      <section class="form-step" aria-labelledby="step-song">${step('song','3','Песня дня')}
        <div class="field"><label class="sr-only" for="song">Выбрать песню</label><span class="hint" id="song-hint">MP3 или WAV до 32 МиБ. Из длинной песни можно вырезать фрагмент от 3 до 60 секунд.</span>
          <div class="drop">${icon('music')} Выбрать песню<input type="file" id="song" accept=".mp3,.wav,.wave,audio/mpeg,audio/wav" aria-describedby="song-hint err-song"></div>
          <div class="attachments" id="audio-list"></div><audio id="song-audition" controls preload="metadata" aria-label="Послушать выбранную песню" hidden></audio>
          <details id="song-trim" class="timing-editor" hidden><summary>Выбрать фрагмент песни</summary><div class="trim-controls">
            <label for="trim-start">Начало <output id="trim-time"></output></label><input id="trim-start" type="range" min="0" step=".1" value="0">
            <label for="trim-length">Длина фрагмента</label><select id="trim-length"></select>
            <button class="btn secondary" id="apply-trim" type="button">Вырезать фрагмент</button>
          </div></details><p id="err-song" class="error" role="alert"></p></div>
        <fieldset class="field track-picks"><legend>Музыка из дневника</legend>
          <label class="sr-only" for="track-query">Поиск музыки из дневника</label>
          <input type="search" id="track-query" placeholder="Название или настроение" autocomplete="off">
          <p class="hint" id="track-hint" role="status"></p>
          <div class="track-options">${availableTracks.map(track=>`<button type="button" class="track-option" data-track="${track.id}" aria-pressed="false">${icon('music',15)}<span class="track-label"><span>${h(track.audioName)}</span><small>${h(track.mood)}</small><small class="track-fit" hidden>подходит к фото</small></span></button>`).join('')}</div>
          <p class="hint" id="track-empty" role="status"></p></fieldset>
        <fieldset class="field ambience-picks"><legend>Звуки места</legend>
          <p class="hint" id="ambience-hint" role="status"></p>
          <details class="collection-help"><summary>Как подбираются звуки?</summary><p>Когда доступен подбор по фото, проверяется обложка. В остальных случаях учитываются слова записи. Любой звук можно убрать или заменить вручную. <a href="/privacy.html#ambience">Как используется фото</a></p></details>
          <div class="ambience-chips" id="ambience-chips"></div>
          ${sampleOutput}
          <div class="ambience-tools"><label class="sr-only" for="ambience-add">Добавить звук места</label><select id="ambience-add"></select>
            <label class="ambience-gain" for="ambience-gain">Громкость фона<input type="range" id="ambience-gain" min="0" max="100" step="5"></label></div></fieldset>
      </section>
      <div class="actions stage-actions"><button class="btn primary" type="submit" id="prepare">Посмотреть сцену ${icon('arrow',16)}</button>
        <span class="subtle" id="busy" role="status"></span><span class="subtle" id="draft-status" role="status"></span></div>
    </form></div>`;
  if(editing){
    $('.page-heading .back').href='#day/'+encodeURIComponent(editing.id);
    $('.page-heading .back').lastChild.textContent=' К записи';
  }
  if(d.revision)draftStatus('Черновик открыт');
  let formBusy=false,pending=0, sampleRequest=0, audioRequest=0;
  const thumbURLs=new Map();
  let auditionFile=null;
  const current=()=>turn===stamp && d===draft;
  function syncButton(){
    if(!current())return;
    const busy=formBusy||pending>0;
    const button=$('#prepare');
    button.disabled=busy;
    button.setAttribute('aria-busy',String(busy));
    $('#busy').textContent=formBusy?'Собираем сцену…':pending?'Загружаем материалы…':'';
  }
  function updateProgress(){
    const ready={story:Boolean(d.dayDate && d.dayDate<=localDate() && words(recordedText(d)).length),photos:Boolean(d.photos.length),song:Boolean(d.audio)};
    const count=Object.values(ready).filter(Boolean).length;
    $('#material-progress').value=count;
    $('#material-count').textContent=count+' из 3 готово';
    for(const item of main.querySelectorAll('[data-material]')){
      const complete=ready[item.dataset.material];
      item.toggleAttribute('data-ready',complete);
      const marker=item.querySelector('span');
      marker.innerHTML=complete?icon('check',16):marker.dataset.number;
      item.querySelector('small').textContent=complete?'Готово':'';
    }
  }
  function changed(){d.revision++;formBusy=false;syncButton();updateProgress();persistDraft(d);}
  function drawProofQuote(){
    const node=$('#proof-quote'), text=selectedQuote(d,recordedText(d));
    node.hidden=!text;
    node.textContent=text?'«'+text+'»':'';
  }
  function picks(){
    $('#photo-list').innerHTML=d.photos.map((file,i)=>{
      if(!thumbURLs.has(file))thumbURLs.set(file,objectURL(file));
      const selected=i===d.coverIndex;
      return `<div class="attachment photo-pick"><button type="button" class="pick-cover" data-cover="${i}" aria-label="Выбрать обложкой фото ${i+1}, ${h(file.name)}" aria-pressed="${selected}">
        <img src="${h(thumbURLs.get(file))}" alt=""><span>${selected ? icon('check',12)+' Обложка' : 'Фото '+(i+1)}</span></button>
        <button type="button" class="remove-photo" data-remove="${i}" aria-label="Убрать фото ${i+1}">${icon('close',14)}</button></div>`;
    }).join('');
    $('#audio-list').innerHTML=d.audio?'<div class="attachment">'+icon('music',15)+'<span>'+h(d.audioName)+'</span><button type="button" id="remove-song" aria-label="Убрать песню">'+icon('close',14)+'</button></div>':'';
    main.querySelectorAll('[data-cover]').forEach(b=>b.onclick=()=>{
      const next=Number(b.dataset.cover);
      if(next===d.coverIndex)return;
      d.montage=sceneMontage(d.montage,d.photos.length,next);
      d.coverIndex=next;changed();picks();
      $('[data-cover="'+next+'"]').focus({preventScroll:true});
    });
    main.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{
      const index=Number(b.dataset.remove);
      d.photos.splice(index,1);
      if(d.montage?.detailIndex===index)d.montage=undefined;
      else if(d.montage?.detailIndex>index)d.montage={...d.montage,detailIndex:d.montage.detailIndex-1};
      if(index===d.coverIndex)d.coverIndex=0;
      else if(index<d.coverIndex)d.coverIndex--;
      changed();picks();errorText('photos','');
      ($('[data-remove="'+Math.min(index,d.photos.length-1)+'"]') || $('#photos')).focus({preventScroll:true});
    });
    if($('#remove-song'))$('#remove-song').onclick=()=>{audioRequest++;d.audio=null;d.audioName='';d.trackId='';d.cues=null;changed();picks();errorText('song','');$('#song').focus();};
    const cover = $('#proof-image');
    cover.hidden = !d.photos.length;
    $('#proof-placeholder').hidden = !!d.photos.length;
    if (d.photos.length) cover.src = thumbURLs.get(d.photos[d.coverIndex]);
    else cover.removeAttribute('src');
    $('#proof-date').textContent = d.dayDate ? dateLabel(d.dayDate) : '';
    $('#proof-song').textContent = d.audioName || 'Песня ещё не выбрана';
    drawProofQuote();
    if(d.audio!==auditionFile){
      const audition=$('#song-audition');
      audition.pause();
      auditionFile=d.audio;
      audition.hidden=!auditionFile;
      if(auditionFile)audition.src=objectURL(auditionFile);
      else audition.removeAttribute('src');
      trimBox.hidden=true;
      audition.load();
    }
    markTracks();
    suggestSounds();
  }
  // «Звуки места»: suggested from the cover (or the text when the server
  // cannot look at photos); any change by the person stops suggestions.
  let ambienceRequest=0,suggestedFor=null;
  function ambienceGain(){return d.ambience?.[0]?.gain ?? defaultAmbienceGain;}
  const soundSamples=mountSoundSamples($('.ambience-picks'),()=>$('#song-audition').pause());
  $('#song-audition').addEventListener('play',soundSamples.stop);
  function renderAmbience(){
    const list=sanitizeAmbience(d.ambience), chosen=new Set(list.map(x=>x.id));
    $('#ambience-chips').innerHTML=list.map(x=>`<span class="ambience-chip">${soundButton(x)}<button type="button" data-ambience-remove="${x.id}" aria-label="Убрать звук «${h(ambienceItem(x.id).title)}»">${icon('close',13)}</button></span>`).join('');
    soundSamples.refresh();
    $('#ambience-add').innerHTML='<option value="">+ Добавить звук</option>'+ambienceLibrary.filter(x=>!chosen.has(x.id)).map(x=>`<option value="${x.id}">${h(x.title)}</option>`).join('');
    $('#ambience-add').disabled=list.length>=4;
    $('#ambience-gain').value=Math.round(ambienceGain()*100);
    $('#ambience-gain').disabled=!list.length;
    const hint=$('#ambience-hint');
    if(d.ambience==null)hint.textContent=(d.photos.length||d.text.trim())?'Подбираем звуки места…':'Добавьте фото или пару строк, и мы подберём звуки места.';
    else if(d.ambienceSource==='photo')hint.textContent=list.length?'Подобрано по фото — решаете вы.':'По фото звуков не нашлось. Добавьте, если хотите.';
    else if(d.ambienceSource==='text')hint.textContent=list.length?'Подобрано по словам записи — решаете вы.':'Подходящих звуков не нашлось. Добавьте, если хотите.';
    else hint.textContent=list.length?'Звуки выбраны вами.':'Без фона. Добавьте звук, если хотите.';
    for(const b of main.querySelectorAll('[data-ambience-remove]'))b.onclick=()=>{
      chooseAmbience(sanitizeAmbience(d.ambience).filter(x=>x.id!==b.dataset.ambienceRemove));
      $('#ambience-add').focus({preventScroll:true});
    };
  }
  function chooseAmbience(list){d.ambience=sanitizeAmbience(list);d.ambienceSource='manual';ambienceRequest++;changed();renderAmbience();}
  function suggestSounds(){
    if(d.ambienceSource==='manual')return;
    const cover=d.photos[d.coverIndex]||null, text=recordedText(d);
    if(!cover && !text){
      suggestedFor=null;ambienceRequest++;
      d.ambience=null;d.ambienceSource='';
      renderAmbience();
      return;
    }
    if(suggestedFor?.cover===cover && suggestedFor.text===text)return suggestedFor.result;
    const req=++ambienceRequest;
    if(d.ambience==null)renderAmbience();
    const result=suggestAmbience({text,cover}).then(({ids,source})=>{
      if(!current() || req!==ambienceRequest || d.ambienceSource==='manual')return;
      d.ambience=ids.map(id=>({id,gain:ambienceGain()}));d.ambienceSource=source;
      persistDraft(d);renderAmbience();
    });
    suggestedFor={cover,text,result};
    return result;
  }
  // markTracks shows which diary track is chosen and, as a hint only, which
  // one is closest in tone to the cover. Nothing is chosen without a click.
  const warmthOf=new WeakMap();
  async function markTracks(){
    for(const b of main.querySelectorAll('[data-track]'))b.setAttribute('aria-pressed',String(b.dataset.track===d.trackId));
    const cover=d.photos[d.coverIndex], hint=$('#track-hint');
    const fit=id=>{for(const b of main.querySelectorAll('[data-track]'))b.querySelector('.track-fit').hidden=b.dataset.track!==id;};
    if(!cover){fit(null);hint.textContent='Добавьте фото, и мы подскажем трек под его тон. Выбор за вами.';return;}
    if(!warmthOf.has(cover))warmthOf.set(cover,coverWarmth(cover).catch(()=>null));
    const warmth=await warmthOf.get(cover);
    if(!current() || cover!==d.photos[d.coverIndex])return;
    if(warmth===null){fit(null);hint.textContent='';return;}
    const best=availableTracks.reduce((a,b)=>Math.abs(b.warmth-warmth)<Math.abs(a.warmth-warmth)?b:a);
    fit(best.id);
    const tone=warmth<0.07?'холодному':warmth>0.11?'тёплому':'мягкому';
    hint.textContent='Подсвечен трек, который ближе к '+tone+' тону обложки. Выбор за вами.';
  }
  const audition=$('#song-audition'), trimBox=$('#song-trim'), trimStart=$('#trim-start'), trimLength=$('#trim-length');
  const trimButton=$('#apply-trim'), trimTime=$('#trim-time');
  function trimBounds(){
    trimStart.max=Math.max(0,Math.floor((audition.duration-Number(trimLength.value))*10)/10);
    trimTime.value=cueLabel(Number(trimStart.value));
    trimStart.setAttribute('aria-valuetext',trimTime.value);
  }
  audition.onloadedmetadata=()=>{
    const duration=audition.duration;
    if(!Number.isFinite(duration) || duration<3)return;
    const last=Math.min(12,Math.floor(duration));
    const lengths=[3,6,9,12].filter(seconds=>seconds<=last);
    trimLength.replaceChildren(...lengths.map(seconds=>new Option(cueLabel(seconds),seconds)));
    trimLength.value=String(lengths.at(-1));
    trimStart.value=0;
    trimBounds();
    trimBox.hidden=false;
    trimBox.open=duration>60 || d.audio.size>12*1024*1024;
  };
  trimLength.onchange=trimBounds;
  trimStart.oninput=()=>{trimBounds();audition.currentTime=Number(trimStart.value);};
  trimButton.onclick=async()=>{
    const file=d.audio, request=++audioRequest, start=Number(trimStart.value), length=Number(trimLength.value);
    pending++;syncButton();trimButton.disabled=true;trimButton.textContent='Вырезаем…';audition.pause();
    try{
      const {trimSong}=await import('./audio-trim.mjs');
      const short=await trimSong(file,start,length);
      if(!current() || request!==audioRequest)return;
      d.audio=short;d.audioName=d.audioName.replace(/ · фрагмент$/,'')+' · фрагмент';d.trackId='';d.cues=null;
      changed();picks();errorText('song','');
    }catch{
      if(current() && request===audioRequest)errorText('song','Не удалось вырезать звук. Попробуйте другой MP3 или WAV.');
    }finally{pending--;syncButton();trimButton.disabled=false;trimButton.textContent='Вырезать фрагмент';}
  };
  const dateField=$('#date');
  const futureDateMessage='Выберите сегодняшний или прошедший день.';
  dateField.value=d.dayDate;$('#story').value=d.text;$('#memory-detail').value=d.detail || '';picks();updateProgress();
  if(dateField.validity.rangeOverflow)errorText('date',futureDateMessage);
  dateField.onfocus=()=>{dateField.max=localDate();};
  dateField.oninput=()=>{
    dateField.max=localDate();
    d.dayDate=dateField.value;
    $('#proof-date').textContent=d.dayDate?dateLabel(d.dayDate):'';
    changed();
    errorText('date',dateField.validity.rangeOverflow?futureDateMessage:'');
  };
  $('#story').oninput=e=>{d.text=e.target.value;drawProofQuote();changed();errorText('story','');};
  $('#story').onchange=suggestSounds;
  $('#memory-detail').oninput=e=>{d.detail=e.target.value;d.quote='';drawProofQuote();changed();};
  $('#memory-detail').onchange=suggestSounds;
  $('#ambience-add').onchange=e=>{const id=e.target.value;if(id)chooseAmbience([...sanitizeAmbience(d.ambience),{id,gain:ambienceGain()}]);};
  $('#ambience-gain').onchange=e=>{const gain=Number(e.target.value)/100;chooseAmbience(sanitizeAmbience(d.ambience).map(x=>({...x,gain})));};
  renderAmbience();
  function filesFor(type,files){
    if(!files.length)return;
    if(type==='photos'){
      const accepted=[], notes=[];
      for(const file of files){
        let note;
        if(d.photos.length+accepted.length===5)note='Уже выбрано пять снимков.';
        else {
          try{checkPhotos([file]);accepted.push(file);}
          catch(err){note=/\.hei[cf]$/i.test(file.name)?'Экспортируйте снимок в JPEG из приложения «Фото».':err.message;}
        }
        if(note)notes.push(file.name+' — '+note);
      }
      if(accepted.length){d.photos.push(...accepted);changed();picks();}
      errorText('photos',notes.join('\n'));
      return;
    }
    try{
      const file=files[0];
      if(file.size>32*1024*1024)throw Error('Выберите песню размером до 32 МиБ.');
      // The original may exceed the day format limits until the user trims it.
      if(!/\.(mp3|wav|wave)$/i.test(file.name) && !/^audio\/(mpeg|mp3|(?:x-)?wav|wave|vnd.wave)$/i.test(file.type))checkAudio(file);
      audioRequest++;d.audio=files[0];d.audioName=d.audio.name.replace(/\.[^.]+$/,'');d.trackId='';d.cues=null;
      changed();picks();errorText(type,'');
    }catch(err){errorText(type,err.message);}
  }
  for(const [id,type] of [['photos','photos'],['song','song']]){
    const input=$('#'+id),zone=input.parentElement;
    input.onchange=()=>{filesFor(type,Array.from(input.files));input.value='';};
    zone.ondragover=e=>{e.preventDefault();zone.classList.add('drag');};
    zone.ondragleave=()=>zone.classList.remove('drag');
    zone.ondrop=e=>{e.preventDefault();zone.classList.remove('drag');filesFor(type,Array.from(e.dataTransfer.files));};
  }
  async function loadExample(){
    const req=++sampleRequest,revision=d.revision;audioRequest++;pending++;syncButton();
    try{
      const files=await Promise.all([...sample.photos,sample.audio].map(exampleFile));
      if(!current() || req!==sampleRequest || revision!==d.revision)return;
      d.photos=files.slice(0,-1);d.coverIndex=0;d.audio=files.at(-1);d.audioName=sample.audioName;d.trackId=sample.id;d.text=sample.text;d.detail='';d.montage=sample.scene.montage;d.dayDate=sample.dayDate;d.cues=null;d.ambience=null;d.ambienceSource='';suggestedFor=null;
      $('#story').value=d.text;$('#date').value=d.dayDate;$('#memory-detail').value='';
      for(const name of ['story','date','photos','song'])errorText(name,'');
      picks();changed();
    }catch{if(current())errorText('photos','Не удалось загрузить материалы примера.');}
    finally{pending--;syncButton();}
  }
  if(sample)$('#fill-demo').onclick=()=>{
    if(!editing && !(recordedText(d) || d.photos.length || d.audio)){loadExample();return;}
    const exampleName=preset?` «${h(preset.title)}»`:'';
    popup(`<h2>Заменить материалы?</h2><p>Текст, фотографии и музыка в форме будут заменены примером${exampleName}.</p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Отмена</button><button type="button" class="btn primary" data-confirm>Взять пример</button></div>`,'Заменить материалы');
    dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
    dialog.querySelector('[data-confirm]').onclick=()=>{dialog.close();loadExample();};
    dialog.querySelector('[data-cancel]').focus();
  };
  const trackButtons=[...main.querySelectorAll('[data-track]')];
  for(const b of trackButtons)b.onclick=()=>chooseTrack(b.dataset.track);
  const trackQuery=$('#track-query');
  trackQuery.onkeydown=event=>{if(event.key==='Enter')event.preventDefault();};
  trackQuery.oninput=event=>{
    const terms=foldText(event.target.value).split(/\s+/u).filter(Boolean);
    for(const [index,track] of availableTracks.entries()){
      const label=foldText(track.audioName+' '+track.mood);
      trackButtons[index].hidden=!terms.every(term=>label.includes(term));
    }
    $('#track-empty').textContent=trackButtons.every(button=>button.hidden)?'Совпадений нет. Попробуйте другое название или настроение.':'';
  };
  const chooseTrack=async id=>{
    const item=availableTracks.find(x=>x.id===id);
    if(!item || id===d.trackId)return;
    const req=++audioRequest;
    changed();pending++;syncButton();
    try{
      const file=await exampleFile(item.audio);if(!current() || req!==audioRequest)return;
      d.audio=file;d.audioName=item.audioName;d.trackId=item.id;d.cues=null;changed();picks();errorText('song','');
    }catch{if(current() && req===audioRequest){errorText('song','Не удалось загрузить композицию.');picks();}}
    finally{pending--;syncButton();}
  };
  $('form').onsubmit=async e=>{
    e.preventDefault();if(formBusy || pending)return;
    const problems={};let composition;
    dateField.max=localDate();
    if(dateField.validity.rangeOverflow)problems.date=futureDateMessage;
    else if(!d.dayDate || !dateField.validity.valid)problems.date='Выберите дату дня.';
    try{composition=composeText(recordedText(d));}catch(err){problems.story=err.message;}
    try{checkPhotos(d.photos);}catch(err){problems.photos=err.message;}
    try{checkAudio(d.audio);}catch(err){problems.song=err.message;}
    for(const name of ['date','story','photos','song'])errorText(name,problems[name]||'');
    const first=Object.keys(problems)[0];if(first){$('#'+first).focus();return;}
    const rev=d.revision;formBusy=true;syncButton();
    const [photo,audio]=await Promise.allSettled([analyzePhotos(d.photos,d.coverIndex),analyzeAudio(d.audio),suggestSounds()]);
    if(!current()||rev!==d.revision)return;
    formBusy=false;syncButton();
    if(photo.status==='rejected')errorText('photos',photo.reason.message);
    if(audio.status==='rejected'){
      errorText('song',audition.duration>60?'Откройте «Выбрать фрагмент песни» и вырежьте нужный отрывок.':audio.reason.message);
      if(audition.duration>60){trimBox.open=true;trimStart.focus();return;}
    }
    if(photo.status==='rejected'||audio.status==='rejected'){ $('#'+(photo.status==='rejected'?'photos':'song')).focus();return;}
    preview=makePreview(d,composition,photo.value,audio.value);
    location.hash=editing?'preview/'+encodeURIComponent(editing.id):'preview';
  };
}
async function previewPage(stamp,editingId){
  const materials=editingId?'#edit/'+encodeURIComponent(editingId):'#new';
  const key=editingId??'new';
  if(!preview || draft?.key!==key || preview.revision!==draft.revision){
    await draftWrites;
    try{
      let restored=draft?.key===key?draft:await getDraft(key);
      if(!restored && editingId){const entry=await getDay(editingId);if(entry)restored=newDraft(entry);}
      if(stamp!==turn)return;
      if(!restored?.dayDate || restored.dayDate>localDate() || !restored.audio || !restored.photos.length){location.replace(materials);return;}
      const composition=composeText(recordedText(restored));
      const [photo,timing]=await Promise.all([analyzePhotos(restored.photos,restored.coverIndex),analyzeAudio(restored.audio)]);
      if(stamp!==turn)return;
      draft=restored;
      preview=makePreview(restored,composition,photo,timing);
    }catch{
      if(stamp===turn){toast('Сцену не удалось открыть. Проверьте материалы.');location.replace(materials);}
      return;
    }
  }
  title('Предпросмотр');const {entry,quotes,thumbnail}=preview,view=displayDay(entry);
  const state=draft;
  main.innerHTML=`<div class="page-heading"><a class="back" href="${h(materials)}">${icon('back',16)} К материалам</a><h1 id="preview-title">${h(entry.title)}</h1><p>${h(dateLabel(entry.dayDate))} · <span id="preview-track">${h(entry.audioName)}</span></p></div>
    <div class="preview-grid">
      <div class="preview-stage">
        <section class="player-box" aria-label="Сцена дня"></section>
        <fieldset class="pace-picker"><legend>Пауза перед фразой</legend><div class="pace-options">
          ${[['early','Короче'],['music','По музыке'],['late','Дольше']].map(([id,label])=>`<button type="button" data-pace="${id}" aria-pressed="false">${label}<small></small></button>`).join('')}
        </div></fieldset>
        <details class="timing-editor"><summary>${icon('wave',18)} <span>Переходы под музыку</span><span class="cue-readout"><span id="cue-source"></span><span id="cue-origin"></span></span>${icon('down',16)}</summary><div class="timing-fields">
          <div><label for="quote-cue">Появление фразы</label><output for="quote-cue"></output><input id="quote-cue" type="range" step="0.01" min="0.3"></div>
          <div><label for="return-cue">Возврат кадра</label><output for="return-cue"></output><input id="return-cue" type="range" step="0.01"></div>
          <div class="timing-actions"><button class="btn secondary" type="button" id="audition-cues">${icon('play',16)} Послушать переходы</button><button class="textbtn" type="button" id="reset-cues">Вернуть музыкальные акценты</button></div>
        </div></details>
      </div>
      <div class="preview-sidebar"><section class="editor"><h2>Оформление дня</h2>
        <div class="field"><label for="entry-title">Название дня</label><input id="entry-title" maxlength="120" aria-describedby="err-title"><p class="error" id="err-title" role="alert"></p></div>
        <div class="field quote-field"><label for="choice">Фраза за кадром</label><blockquote class="quote-print" id="chosen-quote"></blockquote>
          <select id="choice" aria-describedby="err-quote">${quotes.map((quote,index)=>`<option value="${index}">${h(quote)}</option>`).join('')}<option value="custom">Ввести свой фрагмент…</option></select>
          <div id="own-quote" hidden><label for="custom-quote">Дословный фрагмент записи</label><textarea id="custom-quote" rows="3" aria-describedby="err-quote"></textarea>
            </div><details class="quote-source"><summary>Фраза в исходной записи</summary><p id="quote-in-context"></p></details><p class="error" id="err-quote" role="alert"></p></div>
        <dl class="scene-sources"><div><dt>Обложка дня</dt><dd><img src="${h(view.photos[entry.scene.coverPhotoIndex])}" alt="">Снимок ${entry.scene.coverPhotoIndex+1} из ${view.photos.length}</dd></div></dl>
        <div class="field"><label for="scene-montage">Как показать день</label><select id="scene-montage">
          <option value="">Один кадр</option>
          ${view.photos.map((_,i)=>i===entry.scene.coverPhotoIndex?'':`<option value="${i}">Обложка → фото ${i+1} → обложка</option>`).join('')}
          <option value="quiet">Шум → тишина</option>
        </select><p class="subtle" id="montage-note"></p></div>
        ${entry.scene.ambience?.length?`<div class="preview-sounds"><p class="subtle">${h(entry.scene.ambience.map(item=>ambienceItem(item.id).title).join(' · '))}</p><button class="btn secondary" type="button" id="compare-ambience" aria-pressed="true">Звуки места включены</button></div>`:''}
        <details class="track-comparison"><summary>${icon('music',17)} Сравнить другую песню</summary><div class="track-comparison-body">
          <button class="btn secondary" type="button" id="compare-track"></button><p class="subtle" id="track-change" role="status"></p><p class="error" id="err-compare" role="alert"></p>
        </div></details>
      </section>
      <div class="actions stage-actions preview-actions"><button class="btn primary" id="save">${icon('folder',17)} ${editingId?'Сохранить изменения':'Сохранить день'}</button>
        <span class="subtle" id="draft-status" role="status"></span><p class="error" id="err-save" role="alert"></p></div>
      </div>
    </div>`;
  const playerHost=$('.player-box'), saveButton=$('#save'), compareButton=$('#compare-track');
  player=mountPlayer(playerHost,view);
  const montage=$('#scene-montage'), compareAmbience=$('#compare-ambience');
  const labels={
    default:'Оттенок рамки взят из обложки. Фраза появляется поверх кадра.',
    detail:'Второе фото появляется вместе с фразой. В конце возвращается обложка.',
    quiet:'Фон стихает на фразе и возвращается тише в финале.'
  };
  function drawMontage(){
    const value=entry.scene.montage;
    montage.value=value?.mode==='quiet'?'quiet':String(value?.detailIndex ?? '');
    $('#montage-note').textContent=labels[value?.mode ?? 'default'];
  }
  drawMontage();
  montage.onchange=()=>{
    const value=montage.value;
    state.montage=value==='quiet'?{mode:'quiet'}:value===''?undefined:{mode:'detail',detailIndex:Number(value)};
    player.setMontage(state.montage);
    player.seek(entry.scene.quoteAtSec);
    drawMontage();
    persistDraft(state);
  };
  let ambienceOn=true;
  function drawAmbienceButton(){
    if(!compareAmbience)return;
    compareAmbience.setAttribute('aria-pressed',String(ambienceOn));
    compareAmbience.textContent=ambienceOn?'Звуки места включены':'Звуки места выключены';
  }
  function applyAmbienceButton(next){
    ambienceOn=next;
    player.setAmbienceEnabled(next);
    drawAmbienceButton();
  }
  if(compareAmbience){
    playerHost.addEventListener('ambiencechange',event=>{ambienceOn=event.detail;drawAmbienceButton();});
    compareAmbience.onclick=()=>applyAmbienceButton(!player.ambienceEnabled());
  }
  const quoteCue=$('#quote-cue'),returnCue=$('#return-cue'),resetCues=$('#reset-cues');
  const auditionCues=$('#audition-cues');
  const paceButtons=[...main.querySelectorAll('[data-pace]')];
  const timingFields=[quoteCue,returnCue,resetCues,auditionCues,...paceButtons];
  const roundCue=value=>Math.round(value*100)/100;
  function drawCues(){
    const {quoteAtSec,returnAtSec,endAtSec}=entry.scene;
    quoteCue.max=roundCue(returnAtSec-0.6);
    returnCue.min=roundCue(quoteAtSec+0.6);
    returnCue.max=Math.floor((endAtSec-0.3)*100+1e-6)/100;
    quoteCue.value=quoteAtSec;
    returnCue.value=returnAtSec;
    for(const [input,value] of [[quoteCue,quoteAtSec],[returnCue,returnAtSec]]){
      const seconds=cueLabel(value);
      input.previousElementSibling.value=seconds;
      input.setAttribute('aria-valuetext',seconds);
    }
    $('#cue-source').textContent='Фраза '+cueLabel(quoteAtSec)+' · кадр '+cueLabel(returnAtSec);
    $('#cue-origin').textContent=state.cues?'Вручную':'По музыке';
    for(const button of paceButtons){
      const cues=pacedCues(preview.timing,button.dataset.pace);
      button.querySelector('small').textContent=cueLabel(cues.quoteAtSec);
      button.setAttribute('aria-pressed',String(cues.quoteAtSec===quoteAtSec && cues.returnAtSec===returnAtSec));
    }
  }
  function applyCues(cues,custom){
    if(!validCues(cues,entry.scene.endAtSec))return;
    player.setCues(cues);
    state.cues=custom?cues:null;
    drawCues();
    persistDraft(state);
  }
  const modifyCues=()=>applyCues({quoteAtSec:Number(quoteCue.value),returnAtSec:Number(returnCue.value)},true);
  for(const button of paceButtons)button.onclick=()=>{
    const pace=button.dataset.pace;
    applyCues(pacedCues(preview.timing,pace),pace!=='music');
    player.seek(0);
  };
  quoteCue.oninput=returnCue.oninput=modifyCues;
  for(const cue of [quoteCue,returnCue])cue.onchange=()=>player.seek(Number(cue.value));
  auditionCues.onclick=()=>{
    const {quoteAtSec,returnAtSec,endAtSec}=entry.scene;
    player.audition(Math.max(0,quoteAtSec-0.8),Math.min(endAtSec,returnAtSec+0.8));
  };
  resetCues.onclick=()=>{
    const {quoteAtSec,returnAtSec}=preview.timing;
    applyCues({quoteAtSec,returnAtSec},false);
  };
  drawCues();
  const titleField=$('#entry-title'),choice=$('#choice'),custom=$('#custom-quote');
  titleField.value=entry.title;const idx=quotes.indexOf(entry.scene.quote);choice.value=idx<0?'custom':String(idx);
  custom.value=entry.scene.quote;$('#own-quote').hidden=idx>=0;
  function highlightQuote(value){
    $('#chosen-quote').textContent='«'+value+'»';
    const anchor=entry.text.indexOf(value), mark=document.createElement('mark');
    mark.textContent=value;
    $('#quote-in-context').replaceChildren(entry.text.slice(0,anchor),mark,entry.text.slice(anchor+value.length));
  }
  highlightQuote(entry.scene.quote);
  function checkTitle(){
    const value=titleField.value.trim();
    const valid=value.length>0 && value.length<=120;
    errorText('title',valid?'':'Введите название до 120 знаков.');
    if(valid){
      entry.title=value;
      player.setTitle(value);
      $('#preview-title').textContent=value;
      if(state.title!==value){state.title=value;persistDraft(state);}
    }
    return valid;
  }
  function checkQuote(){
    const value=(choice.value==='custom'?custom.value:quotes[Number(choice.value)]).trim();
    const valid=words(value).length>0 && entry.text.includes(value) && value.length<=200;
    errorText('quote',valid?'':'Выберите до 200 знаков, точно как в исходном тексте.');
    if(valid){
      entry.scene.quote=value;player.setQuote(value);highlightQuote(value);
      if(state.quote!==value){state.quote=value;persistDraft(state);}
    }
    return valid;
  }
  titleField.oninput=checkTitle;custom.oninput=checkQuote;
  choice.onchange=()=>{
    const isCustom=choice.value==='custom';
    $('#own-quote').hidden=!isCustom;
    if(isCustom)custom.focus();
    else custom.value=quotes[Number(choice.value)];
    checkQuote();
  };
  const sample=(accountUser?libraryTracks:diaryTracks).find(item=>item.audioName!==entry.audioName);
  const tracks=[{id:state.trackId,name:entry.audioName,file:entry.audioFile,url:view.audio,timing:preview.timing,cues:state.cues},
    {id:sample.id,name:sample.audioName,cues:null}];
  let activeTrack=0,changingTrack=false,saving=false;
  function labelTrack(){compareButton.textContent=(activeTrack?'Вернуть «':'Поставить «')+tracks[1-activeTrack].name+'»';}
  labelTrack();
  compareButton.onclick=async()=>{
    if(saving||changingTrack)return;
    changingTrack=true;
    const nextIndex=1-activeTrack,next=tracks[nextIndex];
    compareButton.setAttribute('aria-disabled','true');
    saveButton.disabled=true;
    compareButton.textContent='Готовим трек…';
    errorText('compare','');
    try{
      if(!next.file){
        const file=await exampleFile(sample.audio);
        const timing=await analyzeAudio(file);
        if(stamp!==turn)return;
        Object.assign(next,{file,timing,url:objectURL(file)});
      }
      const previousCue=entry.scene.quoteAtSec;
      tracks[activeTrack].cues=state.cues;
      activeTrack=nextIndex;
      state.audio=entry.audioFile=next.file;
      state.audioName=entry.audioName=next.name;
      state.trackId=next.id;
      state.cues=next.cues;
      preview.timing=next.timing;
      Object.assign(entry.scene,next.timing,next.cues ?? {});
      player.destroy();
      Object.assign(view,{audio:next.url,audioName:next.name,title:entry.title});
      player=mountPlayer(playerHost,view);
      applyAmbienceButton(ambienceOn);
      $('#preview-track').textContent=next.name;
      drawCues();
      $('#track-change').textContent=previousCue===entry.scene.quoteAtSec
        ?'У обоих треков фраза появляется на '+cueLabel(previousCue)+'.'
        :'Появление фразы: '+cueLabel(previousCue)+' → '+cueLabel(entry.scene.quoteAtSec)+'.';
      persistDraft(state);
    }catch{
      if(stamp===turn)errorText('compare','Не удалось открыть трек. Попробуйте ещё раз.');
    }finally{
      changingTrack=false;
      if(stamp===turn){labelTrack();compareButton.removeAttribute('aria-disabled');saveButton.disabled=false;}
    }
  };
  saveButton.onclick=async()=>{
    if(saving||changingTrack)return;
    if(entry.dayDate>localDate()){
      toast('Выберите сегодняшний или прошедший день.');
      location.replace(materials);
      return;
    }
    if(!checkTitle()){titleField.focus();return;}if(!checkQuote()){custom.focus();return;}
    saving=true;saveButton.disabled=true;saveButton.setAttribute('aria-busy','true');errorText('save','');
    for(const field of [titleField,choice,custom,compareButton,montage,...timingFields])field.disabled=true;
    draftStatus('Сохраняем день…');
    try{
      await draftWrites;
      await saveDay(entry,thumbnail,state.key);
      if(draft===state){draft=null;preview=null;}
      if(stamp===turn){filter='mine';archiveQuery='';archiveReturn=null;toast(editingId?'Изменения сохранены':'День сохранён в вашем архиве');location.replace('#day/'+encodeURIComponent(entry.id));}
    }catch{
      if(stamp===turn){
        errorText('save',accountUser?'Не удалось сохранить день в аккаунте. Попробуйте снова.':'Не удалось сохранить день. Проверьте свободное место в браузере.');
        draftStatus('');
        saveButton.disabled=false;saveButton.removeAttribute('aria-busy');
        for(const field of [titleField,choice,custom,compareButton,montage,...timingFields])field.disabled=false;
        saveButton.focus();
      }
    }finally{saving=false;}
  };
}
function dayPage(entry,autoplay){
  const view=displayDay(entry);title(entry.title);
  main.innerHTML=heading(entry.title,dateLabel(entry.dayDate)+(entry.example?' · День из примеров':' · Личный день'))+
    `<div class="preview-grid day-grid"><section class="player-box" aria-label="Сцена дня"></section><aside class="day-sidebar">
      <section class="day-notes"><span class="micro">${icon('music',16)} Песня дня</span><h2>${h(entry.audioName)}</h2>${daySounds(entry.scene.ambience)}</section>
      <details class="materials"><summary>Материалы дня</summary>
        <h3>Рассказ</h3><p class="original">${h(entry.text)}</p>
        <h3>Фотографии</h3><div class="source-photos">${view.photos.map((src,i)=>`<button type="button" data-photo="${i}" aria-label="Открыть снимок ${i+1}"><img loading="lazy" src="${h(src)}" alt="${h(view.alts?.[i]||'Снимок '+(i+1))}"></button>`).join('')}</div>
        <h3>Исходный трек</h3><audio controls preload="none" aria-label="Исходный трек"></audio>
      </details></aside></div>`;
  player=mountPlayer($('.player-box'),view,autoplay);
  const original=$('.materials audio'), sounds=$('.day-sounds');
  const samples=sounds && mountSoundSamples(sounds,()=>{player.pause();original.pause();});
  original.onplay=()=>{player?.pause();samples?.stop();};
  $('.materials').ontoggle=event=>{
    if(event.currentTarget.open){if(!original.hasAttribute('src'))original.src=view.audio;}
    else original.pause();
  };
  if(!entry.example){
    $('.page-heading').insertAdjacentHTML('beforeend',`<details class="day-management"><summary class="btn secondary">Действия ${icon('down',16)}</summary>
      <div class="day-actions"><a class="btn secondary" href="#edit/${encodeURIComponent(entry.id)}">Редактировать день</a>
        <button class="btn secondary" type="button" id="export-folder">Скачать папку ZIP</button>
        <button class="btn secondary" type="button" id="export-day">Скачать копию</button>
        ${shareable?'<button class="btn secondary" type="button" id="share-day">Поделиться</button>':''}
        <button class="btn quiet-danger" type="button" id="remove-day">Удалить день</button>
        <p class="error" id="err-export" role="alert"></p></div></details>`);
    if(shareable)$('#share-day').onclick=()=>{player.pause();original.pause();openShare(entry,popup,dialog);};
    for(const [selector,label,create] of [
      ['#export-day','Скачать копию',async()=>({blob:await exportDay(entry),name:'ThroughTheLense-'+entry.dayDate+'.json'})],
      ['#export-folder','Скачать папку ZIP',async()=>(await import('./day-folder.mjs')).exportFolder(entry)]
    ]){
      const button=$(selector);
      button.onclick=async()=>{
        button.disabled=true;button.textContent='Готовим скачивание…';errorText('export','');
        try{
          const {blob,name}=await create();
          if(!button.isConnected)return;
          const url=URL.createObjectURL(blob), link=document.createElement('a');
          link.href=url;link.download=name;
          document.body.append(link);link.click();link.remove();
          setTimeout(()=>URL.revokeObjectURL(url),60000);
        }catch{
          if(button.isConnected)errorText('export','Не удалось скачать день. Попробуйте ещё раз.');
        }finally{button.disabled=false;button.textContent=label;}
      };
    }
    $('#remove-day').onclick=()=>{
      player.pause();original.pause();
      popup(`<h2>Удалить день?</h2><p>«${h(entry.title)}» и его материалы будут удалены из вашего архива.</p>
        <div class="dialog-actions"><button class="btn secondary" type="button" data-cancel>Отмена</button>
        <button class="btn destructive" type="button" data-confirm>Удалить день</button></div><p class="error" role="alert"></p>`,'Удалить день');
      dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
      dialog.querySelector('[data-cancel]').focus();
      const confirm=dialog.querySelector('[data-confirm]');
      confirm.onclick=async()=>{
        confirm.disabled=true;
        try{
          await draftWrites;
          await removeDay(entry.id);
          if(draft?.key===entry.id){draft=null;preview=null;}
          if(location.hash==='#day/'+encodeURIComponent(entry.id)){
            dialog.close();toast('День удалён');location.replace('#archive');
          }
        }catch{
          const error=dialog.querySelector('.error');
          if(dialog.contains(confirm) && error)error.textContent='Не удалось удалить день. Попробуйте ещё раз.';
          confirm.disabled=false;
        }
      };
    };
  }
  main.querySelectorAll('[data-photo]').forEach(b=>b.onclick=()=>{
    const i=Number(b.dataset.photo);
    popup('<img class="lightbox" src="'+h(view.photos[i])+'" alt="'+h(view.alts?.[i]||'Снимок дня')+'">','Фотография дня');
  });
}
function missing(message){
  title('Папка недоступна');main.innerHTML=heading('Папка недоступна',message)+'<p style="margin-bottom:40px"><a class="btn secondary" href="#archive">Открыть архив</a></p>';
}
async function route(){
  const stamp=++turn;
  if(dialog.open)dialog.close();
  player?.destroy();player=null;
  for(const a of main.querySelectorAll('audio')){a.pause();a.removeAttribute('src');a.load();}
  urls.forEach(URL.revokeObjectURL);urls=[];
  const hash=location.hash.slice(1)||'archive',auto=playOnOpen;playOnOpen='';
  main.dataset.page=hash.split('/')[0];
  main.innerHTML='<div class="loading-state" role="status">Открываем дневник…</div>';
  document.querySelector('#nav-archive').toggleAttribute('aria-current',hash==='archive');
  if(hash==='archive')document.querySelector('#nav-archive').setAttribute('aria-current','page');
  try{
    if(hash==='archive')await archive(stamp);
    else if(hash==='new')await formPage(stamp);
    else if(hash==='preview')await previewPage(stamp);
    else if(hash.startsWith('preview/'))await previewPage(stamp,decodeURIComponent(hash.slice(8)));
    else if(hash.startsWith('edit/')){
      const entry=await getDay(decodeURIComponent(hash.slice(5)));
      if(turn!==stamp)return;
      if(entry)await formPage(stamp,entry);
      else missing('Эта запись не найдена в вашем архиве.');
    }
    else if(hash.startsWith('day/')){
      const id=decodeURIComponent(hash.slice(4));const entry=demos.find(x=>x.id===id)||await getDay(id);
      if(turn!==stamp)return;
      if(entry)dayPage(entry,auto===id);else missing('Эта запись не найдена в вашем архиве.');
    }else missing('Проверьте адрес или выберите день в архиве.');
  }catch{if(stamp===turn)missing('Не удалось открыть запись. Попробуйте вернуться в архив.');}
  if(turn!==stamp)return;
  const returning=hash==='archive'?archiveReturn:null;
  if(returning)archiveReturn=null;
  const previousTrigger=returning && [...main.querySelectorAll(returning.selector)].find(node=>!returning.href || node.getAttribute('href')===returning.href);
  window.scrollTo(0,returning?.scroll ?? 0);
  if(visited){
    const pageTitle=$('h1');
    if(pageTitle)pageTitle.tabIndex=-1;
    (previousTrigger||pageTitle||main).focus({preventScroll:true});
  }
  visited=true;
}
// showAccount turns the header icon into the signed-in state: the first
// letter of the address, and a menu with the address and «Выйти».
function showAccount(user){
  const link=document.querySelector('#journal-account');
  const email=user.email||'', name=displayName(user);
  link.setAttribute('aria-label','Ваш аккаунт'+(name?': '+name:'')+(email?' ('+email+')':''));
  link.title='Аккаунт: '+(name?name+' · ':'')+email;
  link.classList.add('signed-in');
  link.innerHTML=avatarHTML(user,42);
  link.onclick=event=>{
    event.preventDefault();
    player?.pause();
    popup(`<div class="account-menu-head">${avatarHTML(user,48)}<div><h2>${h(name||'Ваш аккаунт')}</h2><p class="subtle">${h(email)}</p></div></div>
      <div class="dialog-actions"><a class="btn secondary" href="/account.html">Страница аккаунта</a>
      <button class="btn secondary" type="button" data-logout>Выйти</button></div><p class="error" role="alert"></p>`,'Ваш аккаунт');
    const button=dialog.querySelector('[data-logout]');
    button.focus();
    button.onclick=async()=>{
      button.disabled=true;
      try{
        await draftWrites;
        await logout();
        location.assign('/account.html');
      }catch{
        dialog.querySelector('.error').textContent='Не удалось выйти. Попробуйте ещё раз.';
        button.disabled=false;
      }
    };
  };
}
if(!guestMode){
  try {
    accountUser=await connectDiary();
    shareable=Boolean(accountUser) && await shareSupported();
    if(accountUser){
      showAccount(accountUser);
      document.querySelector('#storage-note').textContent='Личные дни хранятся в вашем аккаунте';
    }
  } catch {
    toast('Не удалось подключиться к аккаунту. Открыт гостевой дневник.');
  }
}
if(guestMode || accountUser){
  const archiveSwitch=document.createElement('a');
  archiveSwitch.href=guestMode?'/journal.html#archive':'/journal.html?mode=guest#archive';
  archiveSwitch.textContent=guestMode?'Выйти из гостевого режима':'Открыть гостевой архив';
  document.querySelector('.foot nav').prepend(archiveSwitch);
}
window.addEventListener('hashchange',route);
route();
