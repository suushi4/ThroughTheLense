import {icon} from './icons.mjs';
import {escapeHTML as h,dateLabel,timeLabel} from './ui.mjs';
import {composeText,words,analyzePhotos,analyzeAudio,checkPhotos,checkAudio,validCues} from './scene.mjs';
import {getDay,listDays,saveDay,getDraft,saveDraft,removeDay} from './journal.mjs?v=2';
import {demos,exampleFile} from './demo.mjs';
import {mountPlayer} from './player.mjs';
import {exportDay,importDay} from './transfer.mjs';

const main=document.querySelector('main'), dialog=document.querySelector('#dialog');
const $=selector=>main.querySelector(selector);
let turn=0, urls=[], player=null, draft=null, preview=null, filter=null, archiveQuery='', toastTimer, playOnOpen='', visited=false;
let draftWrites=Promise.resolve();
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
    audio:editing?.audioFile ?? null,audioName:editing?.audioName ?? '',
    title:editing?.title ?? '',quote:editing?.scene.quote ?? '',
    cues:editing?.scene && {quoteAtSec:editing.scene.quoteAtSec,returnAtSec:editing.scene.returnAtSec},revision:0
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
      if(draft===state)draftStatus(message);
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
document.querySelector('#about-trigger').onclick=()=>popup('<h2>О дневнике</h2><p>Через месяц фотография напомнит, где вы были. Запись сохранит и то, что осталось за кадром.</p><p>Добавьте снимок, несколько строк и песню. На музыкальном акценте появится ваша фраза, а затем вернётся тот же кадр.</p><p>Личные дни хранятся в этом браузере. Очистка данных сайта удаляет архив. Три открытых примера используют постановочные иллюстрации и оригинальную инструментальную музыку.</p>','О дневнике');
document.querySelector('#foot-about').onclick=()=>document.querySelector('#about-trigger').click();
document.querySelector('#dialog-close').onclick=()=>dialog.close();
dialog.onclick=e=>{if(e.target===dialog && e.offsetX>=0 && e.offsetY>=0 && (e.clientX<dialog.getBoundingClientRect().left || e.clientX>dialog.getBoundingClientRect().right || e.clientY<dialog.getBoundingClientRect().top || e.clientY>dialog.getBoundingClientRect().bottom))dialog.close();};
document.querySelector('.skip').onclick=e=>{e.preventDefault();main.focus();};
document.addEventListener('click',event=>{
  const link=event.target.closest('[data-play]');
  if(link && !event.ctrlKey && !event.metaKey && !event.shiftKey)playOnOpen=link.dataset.play;
});
window.addEventListener('hashchange',route);
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
    <div class="feature-caption">
      <div class="feature-date"><span>${day.example ? 'Из примеров' : 'Личный день'}</span><time datetime="${h(day.dayDate)}">${h(dateLabel(day.dayDate))}</time></div>
      <div class="feature-story"><h2>${h(day.title)}</h2>
        <p class="feature-track">${icon('music',16)}${h(day.audioName)}</p></div>
      <span class="open-feature">${icon('play',16)} Смотреть день ${duration ? '<span class="feature-duration">'+timeLabel(duration)+'</span>' : ''}</span>
    </div>
    <div class="feature-print"><img src="${h(day.thumbnail)}" alt="${h(day.alts?.[0] || '')}" fetchpriority="high"></div>
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
  if(filter===null)filter=own.length?'mine':'all';
  own=own.map(x=>({...x,thumbnail:objectURL(x.thumbnail)}));
  const days=[...own,...demos].sort((a,b)=>b.dayDate.localeCompare(a.dayDate)||b.id.localeCompare(a.id));
  let featureIndex=0, visible=[];
  main.innerHTML = `<section class="archive-hero" aria-labelledby="archive-heading">
    <div class="intro"><div><h1 id="archive-heading">Архив дней</h1><p>Ваши фотографии, музыка и слова о том, что осталось за кадром.</p></div>
    ${unfinished.value?'<a class="btn secondary" id="resume-draft" href="#new">'+icon('book',17)+' Продолжить черновик</a>':''}</div>
    <div class="archive-tools">
      <div class="filters" role="group" aria-label="Какие дни показать">${[['all','Все дни'],['mine','Мои дни'],['demo','Примеры']].map(([key,label])=>'<button class="chip" data-filter="'+key+'">'+label+'</button>').join('')}</div>
      <div class="search-field"><label for="archive-query">Поиск</label><div class="archive-search">${icon('search',18)}<input id="archive-query" type="search" aria-label="Поиск по названию, песне или дате" placeholder="Название, песня или дата" autocomplete="off"><button type="button" id="clear-query" aria-label="Очистить поиск" hidden>${icon('close',16)}</button></div></div>
    </div>
    <div class="spread" data-enter role="region" aria-label="Воспоминание из архива">
      <div id="featured-day"></div>
      <div class="spread-nav" role="group" aria-label="Листать воспоминания">
        <button id="previous-feature" aria-label="Предыдущий день">${icon('back',16)}</button>
        <span id="spread-position" aria-live="polite"></span>
        <button id="next-feature" aria-label="Следующий день">${icon('arrow',16)}</button>
      </div>
    </div>
    </section>
    <section class="collection"><div class="collection-head"><h2>Папки дней</h2><span id="day-count" class="count" role="status"></span>
      <div class="collection-actions"><button class="btn secondary" type="button" id="random-day">${icon('shuffle',16)} Случайный день</button>
      <button class="btn secondary" type="button" id="import-day">${icon('folder',16)} Открыть файл дня</button></div></div>
      <input type="file" id="day-file" accept=".json,application/json" aria-label="Файл копии дня" hidden>
      <p id="err-import" class="error" role="alert"></p><div id="folders"></div></section>`;
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
        filter='mine';archiveQuery='';toast('Копия дня добавлена в архив');
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
  function showFeature(index) {
    featureIndex = (index + visible.length) % visible.length;
    $('#featured-day').innerHTML = featurePage(visible[featureIndex]);
    $('#spread-position').textContent = (featureIndex + 1) + ' / ' + visible.length;
  }
  $('#previous-feature').onclick = () => showFeature(featureIndex - 1);
  $('#next-feature').onclick = () => showFeature(featureIndex + 1);
  $('#random-day').onclick=()=>{
    const alternatives=visible.filter((day,index)=>index!==featureIndex);
    const day=alternatives[Math.floor(Math.random()*alternatives.length)] ?? visible[featureIndex];
    if(!day)return;
    playOnOpen=day.id;
    location.hash='day/'+encodeURIComponent(day.id);
  };
  function draw(preferOwn=false){
    visible=matchingDays(days,filter,archiveQuery);
    $('.spread').hidden=!visible.length;
    $('.spread-nav').hidden=visible.length<2;
    $('#random-day').hidden=visible.length<2;
    if(visible.length)showFeature(preferOwn ? Math.max(0,visible.findIndex(day=>!day.example)) : 0);
    else $('#featured-day').replaceChildren();
    const forms={one:'запись',few:'записи',many:'записей',other:'записи'};
    $('#day-count').textContent=visible.length+' '+forms[new Intl.PluralRules('ru').select(visible.length)];
    $('#clear-query').hidden=!archiveQuery;
    main.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));
    let content;
    if(visible.length)content='<div class="grid">'+visible.map(card).join('')+'</div>';
    else if(archiveQuery.trim())content='<div class="empty">'+icon('search',28)+'<h3>Совпадений пока нет</h3><p>Попробуйте другое название, песню или дату.</p><button id="reset-search" class="btn secondary">Сбросить поиск</button></div>';
    else if(unavailable)content='';
    else content='<div class="empty">'+icon('folder',29)+'<h3>Ваш первый день</h3><p>Добавьте снимок, музыку и пару строк о том, что запомнилось.</p><a class="btn primary" href="#new">Новый день</a></div>';
    $('#folders').innerHTML=(unavailable?'<p class="error" role="alert">Личный архив недоступен в этом браузере. Вы можете посмотреть три примера.</p>':'')+content;
    if($('#reset-search'))$('#reset-search').onclick=clearQuery;
  }
  const input=$('#archive-query');
  function clearQuery(){archiveQuery=input.value='';draw();input.focus();}
  input.value=archiveQuery;
  input.oninput=()=>{archiveQuery=input.value;draw();};
  $('#clear-query').onclick=clearQuery;
  main.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;draw();});
  draw(true);
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
  main.innerHTML=heading(pageName,'Добавьте фотографии, несколько строк о дне и музыку.')+
  '<div class="form-wrap"><form novalidate><div class="form-line"><h2>Материалы дня</h2><button type="button" class="textbtn" id="fill-demo">'+icon('folder',15)+' Взять материалы примера</button></div>'+
  '<div class="field"><label for="date">Дата дня</label><input type="date" id="date" required aria-describedby="err-date"><p id="err-date" class="error" role="alert"></p></div>'+
  '<div class="field"><label for="story">Как прошёл день?</label><textarea id="story" required rows="4" placeholder="Запомнилось, как…" aria-describedby="err-story"></textarea><p id="err-story" class="error" role="alert"></p></div>'+
  '<div class="field"><label for="photos">Фотографии</label><span class="hint" id="photo-hint">От 1 до 5 фото в JPEG, PNG или WebP, до 8 МиБ каждое. Нажмите на снимок, чтобы сделать его обложкой.</span><div class="drop">'+icon('image')+' Добавить фотографии<input type="file" multiple id="photos" accept="image/jpeg,image/png,image/webp" aria-describedby="photo-hint err-photos"></div><div class="attachments" id="photo-list" role="group" aria-label="Выбор обложки"></div><p id="err-photos" class="error" role="alert"></p></div>'+
  '<div class="field"><label for="song">Песня дня</label><span class="hint" id="song-hint">Фрагмент MP3 или WAV от 3 до 60 секунд, до 12 МиБ.</span><div class="drop">'+icon('music')+' Выбрать песню<input type="file" id="song" accept=".mp3,.wav,.wave,audio/mpeg,audio/wav" aria-describedby="song-hint err-song"></div><div class="attachments" id="audio-list"></div><audio id="song-audition" controls preload="metadata" aria-label="Послушать выбранную песню" hidden></audio><p id="err-song" class="error" role="alert"></p></div>'+
  '<div class="field"><label for="soundtrack">Или музыка из примеров</label><select id="soundtrack"><option value="">Выбрать композицию</option>'+demos.map(x=>'<option value="'+x.id+'">'+h(x.audioName)+'</option>').join('')+'</select></div>'+
  '<div class="actions"><button class="btn primary" type="submit" id="prepare">Посмотреть сцену '+icon('arrow',16)+'</button><span class="subtle" id="busy" role="status"></span></div><p class="subtle" id="draft-status" role="status"></p></form></div>';
  if(editing){
    $('.page-heading .back').href='#day/'+encodeURIComponent(editing.id);
    $('.page-heading .back').lastChild.textContent=' К записи';
  }
  if(d.revision)draftStatus('Черновик открыт');
  $('#photo-list').closest('.field').insertAdjacentHTML('afterend', `
    <aside class="cover-proof" aria-label="Обложка новой записи">
      <h2>Обложка дня</h2>
      <figure class="proof-sheet">
        <div class="proof-window"><img id="proof-image" alt="Выбранная обложка" hidden>
          <span id="proof-placeholder">${icon('image',32)}Здесь появится ваш снимок</span></div>
        <figcaption id="proof-date"></figcaption>
      </figure>
      <p class="proof-song">${icon('music',16)}<span id="proof-song"></span></p>
      <ul class="draft-progress" aria-label="Материалы дня">
        <li data-material="story"><span></span>Запись</li>
        <li data-material="photos"><span></span>Фотографии</li>
        <li data-material="song"><span></span>Музыка</li>
      </ul>
    </aside>`);
  let formBusy=false,pending=0, sampleRequest=0, audioRequest=0;
  const thumbURLs=new Map();
  let auditionFile=null;
  const current=()=>turn===stamp && d===draft;
  function syncButton(){if(!current())return;$('#prepare').disabled=formBusy||pending>0;$('#busy').textContent=formBusy?'Готовим воспоминание…':pending?'Загружаем материалы…':'';}
  function updateProgress(){
    const ready={story:words(d.text).length,photos:d.photos.length,song:d.audio};
    for(const item of main.querySelectorAll('[data-material]')){
      const complete=Boolean(ready[item.dataset.material]);
      item.toggleAttribute('data-ready',complete);
      item.querySelector('span').textContent=complete?'✓':'○';
      item.querySelector('span').setAttribute('aria-label',complete?'Добавлено':'Ожидает');
    }
  }
  function changed(){d.revision++;formBusy=false;syncButton();updateProgress();persistDraft(d);}
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
      d.coverIndex=next;changed();picks();
      $('[data-cover="'+next+'"]').focus({preventScroll:true});
    });
    main.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{
      const index=Number(b.dataset.remove);
      d.photos.splice(index,1);
      if(index===d.coverIndex)d.coverIndex=0;
      else if(index<d.coverIndex)d.coverIndex--;
      changed();picks();errorText('photos','');
      ($('[data-remove="'+Math.min(index,d.photos.length-1)+'"]') || $('#photos')).focus({preventScroll:true});
    });
    if($('#remove-song'))$('#remove-song').onclick=()=>{audioRequest++;d.audio=null;d.audioName='';d.trackId='';d.cues=null;$('#soundtrack').value='';changed();picks();errorText('song','');};
    const cover = $('#proof-image');
    cover.hidden = !d.photos.length;
    $('#proof-placeholder').hidden = !!d.photos.length;
    if (d.photos.length) cover.src = thumbURLs.get(d.photos[d.coverIndex]);
    else cover.removeAttribute('src');
    $('#proof-date').textContent = d.dayDate ? dateLabel(d.dayDate) : '';
    $('#proof-song').textContent = d.audioName || 'Песня ещё не выбрана';
    if(d.audio!==auditionFile){
      const audition=$('#song-audition');
      audition.pause();
      auditionFile=d.audio;
      audition.hidden=!auditionFile;
      if(auditionFile)audition.src=objectURL(auditionFile);
      else audition.removeAttribute('src');
      audition.load();
    }
    $('#soundtrack').value=d.trackId||'';
  }
  $('#date').value=d.dayDate;$('#story').value=d.text;picks();updateProgress();
  $('#date').oninput=e=>{d.dayDate=e.target.value;$('#proof-date').textContent=d.dayDate?dateLabel(d.dayDate):'';changed();errorText('date','');};
  $('#story').oninput=e=>{d.text=e.target.value;changed();errorText('story','');};
  function filesFor(type,files){
    if(!files.length)return;
    try{
      if(type==='photos'){const next=[...d.photos,...files];checkPhotos(next);d.photos=next;}
      else {checkAudio(files[0]);audioRequest++;d.audio=files[0];d.audioName=d.audio.name.replace(/\.[^.]+$/,'');d.trackId='';d.cues=null;}
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
      const sample=demos[0], files=await Promise.all([...sample.photos,sample.audio].map(exampleFile));
      if(!current() || req!==sampleRequest || revision!==d.revision)return;
      d.photos=files.slice(0,-1);d.coverIndex=0;d.audio=files.at(-1);d.audioName=sample.audioName;d.trackId=sample.id;d.text=sample.text;d.dayDate=sample.dayDate;d.cues=null;
      $('#story').value=d.text;$('#date').value=d.dayDate;
      for(const name of ['story','date','photos','song'])errorText(name,'');
      picks();changed();
    }catch{if(current())errorText('photos','Не удалось загрузить материалы примера.');}
    finally{pending--;syncButton();}
  }
  $('#fill-demo').onclick=()=>{
    if(!editing && !(d.text.trim() || d.photos.length || d.audio)){loadExample();return;}
    popup('<h2>Заменить материалы?</h2><p>Текст, фотографии и музыка в форме будут заменены примером.</p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Отмена</button><button type="button" class="btn primary" data-confirm>Взять пример</button></div>','Заменить материалы');
    dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
    dialog.querySelector('[data-confirm]').onclick=()=>{dialog.close();loadExample();};
    dialog.querySelector('[data-cancel]').focus();
  };
  $('#soundtrack').onchange=async e=>{
    const item=demos.find(x=>x.id===e.target.value);const req=++audioRequest;
    if(!item){picks();return;}
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
    if(!d.dayDate || !$('#date').validity.valid)problems.date='Выберите дату дня.';
    try{composition=composeText(d.text);}catch(err){problems.story=err.message;}
    try{checkPhotos(d.photos);}catch(err){problems.photos=err.message;}
    try{checkAudio(d.audio);}catch(err){problems.song=err.message;}
    for(const name of ['date','story','photos','song'])errorText(name,problems[name]||'');
    const first=Object.keys(problems)[0];if(first){$('#'+first).focus();return;}
    const rev=d.revision;formBusy=true;syncButton();
    const [photo,audio]=await Promise.allSettled([analyzePhotos(d.photos,d.coverIndex),analyzeAudio(d.audio)]);
    if(!current()||rev!==d.revision)return;
    formBusy=false;syncButton();
    if(photo.status==='rejected')errorText('photos',photo.reason.message);
    if(audio.status==='rejected')errorText('song',audio.reason.message);
    if(photo.status==='rejected'||audio.status==='rejected'){ $('#'+(photo.status==='rejected'?'photos':'song')).focus();return;}
    const preservedQuote=d.quote && d.text.includes(d.quote) ? d.quote : composition.quote;
    const timing=audio.value;
    const scene={version:1,coverPhotoIndex:d.coverIndex,quote:preservedQuote,palette:photo.value.palette,...timing,...(validCues(d.cues,timing.endAtSec)?d.cues:{})};
    preview={entry:{id:d.id,dayDate:d.dayDate,title:d.title||composition.title,text:d.text,audioName:d.audioName,photoFiles:[...d.photos],audioFile:d.audio,scene},quotes:composition.quotes,thumbnail:photo.value.thumbnail,revision:rev,timing};
    location.hash=editing?'preview/'+encodeURIComponent(editing.id):'preview';
  };
}
function previewPage(stamp,editingId){
  const materials=editingId?'#edit/'+encodeURIComponent(editingId):'#new';
  if(!preview || draft?.key!==(editingId??'new') || preview.revision!==draft.revision){
    location.replace(materials);return;
  }
  title('Предпросмотр');const {entry,quotes,thumbnail}=preview,view=displayDay(entry);
  const state=draft;
  main.innerHTML='<div class="page-heading"><a class="back" href="'+h(materials)+'">'+icon('back',16)+' К материалам</a><h1>Предпросмотр</h1><p>'+h(dateLabel(entry.dayDate))+' · '+h(entry.audioName)+'</p></div><div class="preview-grid"><section class="player-box" aria-label="Сцена дня"></section><section class="editor"><h2>Ваша папка</h2>'+
  '<div class="field"><label for="entry-title">Название дня</label><input id="entry-title" maxlength="120" aria-describedby="err-title"><p class="error" id="err-title" role="alert"></p></div>'+
  '<div class="field quote-field"><label for="choice">Фраза за кадром</label><blockquote class="quote-print" id="chosen-quote"></blockquote><div class="quote-picker"><span aria-hidden="true">Сменить фразу '+icon('down',16)+'</span><select id="choice">'+quotes.map((x,i)=>'<option value="'+i+'">'+h(x)+'</option>').join('')+'<option value="custom">Ввести свой фрагмент…</option></select></div><div id="own-quote" hidden><label for="custom-quote">Дословный фрагмент записи</label><textarea id="custom-quote" rows="3" aria-describedby="err-quote"></textarea><details class="quote-source"><summary>Прочитать исходную запись</summary><p>'+h(entry.text)+'</p></details></div><p class="error" id="err-quote" role="alert"></p></div>'+
  '<details class="timing-editor"><summary>'+icon('wave',18)+' Переходы под музыку</summary><div class="timing-fields">'+
  '<div><label for="quote-cue">Появление фразы</label><output for="quote-cue"></output><input id="quote-cue" type="range" step="0.01" min="0.3"></div>'+
  '<div><label for="return-cue">Возврат кадра</label><output for="return-cue"></output><input id="return-cue" type="range" step="0.01"></div>'+
  '<button class="textbtn" type="button" id="reset-cues">Вернуть музыкальные акценты</button></div></details>'+
  '<div class="actions"><button class="btn primary" id="save">'+icon('folder',17)+(editingId?' Сохранить изменения':' Сохранить день')+'</button><span class="subtle" id="draft-status" role="status"></span></div><p class="error" id="err-save" role="alert"></p></section></div>';
  player=mountPlayer($('.player-box'),view);
  const quoteCue=$('#quote-cue'),returnCue=$('#return-cue'),resetCues=$('#reset-cues');
  const timingFields=[quoteCue,returnCue,resetCues];
  const roundCue=value=>Math.round(value*100)/100;
  function drawCues(){
    const {quoteAtSec,returnAtSec,endAtSec}=entry.scene;
    quoteCue.max=roundCue(returnAtSec-0.6);
    returnCue.min=roundCue(quoteAtSec+0.6);
    returnCue.max=Math.floor((endAtSec-0.3)*100+1e-6)/100;
    quoteCue.value=quoteAtSec;
    returnCue.value=returnAtSec;
    for(const [input,value] of [[quoteCue,quoteAtSec],[returnCue,returnAtSec]]){
      const seconds=value.toLocaleString('ru',{maximumFractionDigits:2})+' с';
      input.previousElementSibling.value=seconds;
      input.setAttribute('aria-valuetext',seconds);
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
  quoteCue.oninput=returnCue.oninput=modifyCues;
  resetCues.onclick=()=>{
    const {quoteAtSec,returnAtSec}=preview.timing;
    applyCues({quoteAtSec,returnAtSec},false);
  };
  drawCues();
  const titleField=$('#entry-title'),choice=$('#choice'),custom=$('#custom-quote');
  titleField.value=entry.title;const idx=quotes.indexOf(entry.scene.quote);choice.value=idx<0?'custom':String(idx);
  custom.value=entry.scene.quote;$('#own-quote').hidden=idx>=0;
  $('#chosen-quote').textContent='«'+entry.scene.quote+'»';
  $('#chosen-quote').hidden=idx<0;
  function checkTitle(){
    const value=titleField.value.trim();
    const valid=value.length>0 && value.length<=120;
    errorText('title',valid?'':'Введите название до 120 знаков.');
    if(valid){
      entry.title=value;
      if(state.title!==value){state.title=value;persistDraft(state);}
    }
    return valid;
  }
  function checkQuote(){
    const value=(choice.value==='custom'?custom.value:quotes[Number(choice.value)]).trim();
    const valid=words(value).length>0 && entry.text.includes(value) && value.length<=200;
    errorText('quote',valid?'':'Выберите до 200 знаков, точно как в исходном тексте.');
    if(valid){
      entry.scene.quote=value;player.setQuote(value);$('#chosen-quote').textContent='«'+value+'»';
      if(state.quote!==value){state.quote=value;persistDraft(state);}
    }
    return valid;
  }
  titleField.oninput=checkTitle;custom.oninput=checkQuote;
  choice.onchange=()=>{
    const isCustom=choice.value==='custom';
    $('#own-quote').hidden=!isCustom;$('#chosen-quote').hidden=isCustom;
    if(isCustom)custom.focus();
    else custom.value=quotes[Number(choice.value)];
    checkQuote();
  };
  let saving=false;
  $('#save').onclick=async()=>{
    if(saving)return;
    if(!checkTitle()){titleField.focus();return;}if(!checkQuote()){custom.focus();return;}
    saving=true;$('#save').disabled=true;errorText('save','');
    for(const field of [titleField,choice,custom,...timingFields])field.disabled=true;
    draftStatus('Сохраняем день…');
    try{
      await draftWrites;
      await saveDay(entry,thumbnail,state.key);
      if(draft===state){draft=null;preview=null;}
      if(stamp===turn){filter='mine';archiveQuery='';toast(editingId?'Изменения сохранены':'День сохранён в вашем архиве');location.replace('#day/'+encodeURIComponent(entry.id));}
    }catch{
      if(stamp===turn){
        errorText('save','Не удалось сохранить день. Проверьте свободное место и доступ к хранилищу браузера.');
        draftStatus('');
        $('#save').disabled=false;
        for(const field of [titleField,choice,custom,...timingFields])field.disabled=false;
        $('#save').focus();
      }
    }finally{saving=false;}
  };
}
function dayPage(entry,autoplay){
  const view=displayDay(entry);title(entry.title);
  main.innerHTML=heading(entry.title,dateLabel(entry.dayDate)+(entry.example?' · День из примеров':' · Личный день'))+
    '<div class="preview-grid"><section class="player-box" aria-label="Сцена дня"></section><aside><section class="day-notes"><span class="micro">'+icon('music',16)+' Песня дня</span><h2>'+h(entry.audioName)+'</h2><audio controls preload="metadata" aria-label="Исходный трек"></audio></section><details class="materials"><summary>Материалы дня</summary><h3>Запись</h3><p class="original">'+h(entry.text)+'</p><h3>Фотографии</h3><div class="source-photos">'+view.photos.map((src,i)=>'<button type="button" data-photo="'+i+'" aria-label="Открыть снимок '+(i+1)+'"><img src="'+h(src)+'" alt="'+h(view.alts?.[i]||'Снимок '+(i+1))+'"></button>').join('')+'</div></details></aside></div>';
  player=mountPlayer($('.player-box'),view,autoplay);
  const original=$('.day-notes audio');original.src=view.audio;original.onplay=()=>player?.pause();
  if(!entry.example){
    $('.page-heading').insertAdjacentHTML('beforeend',`<div class="day-actions">
      <a class="btn secondary" href="#edit/${encodeURIComponent(entry.id)}">Редактировать день</a>
      <button class="btn secondary" type="button" id="export-day">Скачать копию</button>
      <button class="btn quiet-danger" type="button" id="remove-day">Удалить день</button>
    </div><p class="error" id="err-export" role="alert"></p>`);
    const exportButton=$('#export-day');
    exportButton.onclick=async()=>{
      exportButton.disabled=true;
      exportButton.textContent='Готовим копию…';
      errorText('export','');
      try{
        const file=await exportDay(entry);
        if(!exportButton.isConnected)return;
        const url=URL.createObjectURL(file);
        const link=document.createElement('a');
        link.href=url;link.download='ThroughTheLense-'+entry.dayDate+'.json';
        document.body.append(link);
        link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
      }catch{
        if(exportButton.isConnected)errorText('export','Не удалось скачать копию дня. Попробуйте ещё раз.');
      }finally{
        exportButton.disabled=false;exportButton.textContent='Скачать копию';
      }
    };
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
  main.innerHTML='<div class="loading-state" role="status">Открываем дневник…</div>';
  document.querySelector('#nav-archive').toggleAttribute('aria-current',hash==='archive');
  if(hash==='archive')document.querySelector('#nav-archive').setAttribute('aria-current','page');
  try{
    if(hash==='archive')await archive(stamp);
    else if(hash==='new')await formPage(stamp);
    else if(hash==='preview')previewPage(stamp);
    else if(hash.startsWith('preview/'))previewPage(stamp,decodeURIComponent(hash.slice(8)));
    else if(hash.startsWith('edit/')){
      const entry=await getDay(decodeURIComponent(hash.slice(5)));
      if(turn!==stamp)return;
      if(entry)await formPage(stamp,entry);
      else missing('Эта запись не найдена в текущем браузере.');
    }
    else if(hash.startsWith('day/')){
      const id=decodeURIComponent(hash.slice(4));const entry=demos.find(x=>x.id===id)||await getDay(id);
      if(turn!==stamp)return;
      if(entry)dayPage(entry,auto===id);else missing('Эта запись не найдена в текущем браузере.');
    }else missing('Проверьте адрес или выберите день в архиве.');
  }catch{if(stamp===turn)missing('Не удалось открыть запись. Попробуйте вернуться в архив.');}
  if(turn!==stamp)return;
  window.scrollTo(0,0);if(visited)main.focus({preventScroll:true});visited=true;
}
route();
