import {hasDraft,listDays as listGuestDays} from './journal.mjs?v=2';
import {dateLabel} from './ui.mjs';
import {icon} from './icons.mjs';


const guestJournal='/journal.html?mode=guest';

// shelfSource picks the archive the visitor actually writes to: the account
// once signed in, otherwise this browser's guest archive.
async function shelfSource(user) {
  if (user) {
    try {
      const diary=await import('./diary.mjs');
      if (await diary.connectDiary()) return {
        journal:'/journal.html', title:'Ваш архив', place:'В вашем аккаунте',
        loading:'Открываем ваш архив…', failure:'Не удалось прочитать архив аккаунта.',
        list:diary.listDays, draft:()=>diary.getDraft('new')
      };
    } catch {}
    return {journal:'/journal.html', title:'Ваш архив', place:'В вашем аккаунте',
      loading:'Открываем ваш архив…', failure:'Не удалось прочитать архив аккаунта.',
      list:async()=>{throw Error('Account unavailable');}, draft:async()=>false};
  }
  return {
    journal:guestJournal, title:'Гостевой архив', place:'В этом браузере',
    loading:'Открываем гостевой архив…', failure:'Не удалось прочитать записи браузера.',
    list:listGuestDays, draft:()=>hasDraft('new')
  };
}

function dayCard(day,journal) {
  const row=document.createElement('li');
  const link=document.createElement('a');
  link.className='home-shelf-day';
  link.href=journal+'#day/'+encodeURIComponent(day.id);

  const print=document.createElement('span');
  print.className='home-shelf-print';
  print.setAttribute('aria-hidden','true');
  print.innerHTML=icon('image',22);
  if(day.thumbnail?.size && /^image\/(jpeg|png|webp)$/i.test(day.thumbnail.type)) {
    const photo=document.createElement('img');
    const url=URL.createObjectURL(day.thumbnail);
    photo.alt='';
    photo.loading='lazy';
    photo.decoding='async';
    photo.onload=()=>URL.revokeObjectURL(url);
    photo.onerror=()=>{URL.revokeObjectURL(url);photo.remove();};
    photo.src=url;
    print.append(photo);
  }

  const details=document.createElement('span');
  details.className='home-shelf-details';
  const title=document.createElement('strong');
  title.textContent=day.title;
  const date=document.createElement('time');
  date.dateTime=day.dayDate;
  date.textContent=dateLabel(day.dayDate);
  details.append(title,date);
  link.append(print,details);
  row.append(link);
  return row;
}

export async function mountHomeShelf(host, user = null) {
  const source=await shelfSource(user);
  const {journal}=source;
  host.innerHTML=`<section class="home-shelf" aria-labelledby="home-shelf-title">
    <div class="home-shelf-head">
      <div><h3 id="home-shelf-title">${source.title}</h3><p>${source.place}</p></div>
      <a class="home-shelf-all" href="${journal}#archive">Открыть архив ${icon('arrow',17)}</a>
    </div>
    <p class="home-shelf-status" role="status">${source.loading}</p>
    <ul class="home-shelf-list" role="list" hidden></ul>
    <a class="home-shelf-next" href="${journal}#new" hidden></a>
  </section>`;
  const status=host.querySelector('.home-shelf-status');
  const [entries,draft]=await Promise.allSettled([source.list(),source.draft()]);
  if(!host.contains(status))return;

  const recent=(entries.value ?? [])
    .sort((a,b)=>b.dayDate.localeCompare(a.dayDate)||b.id.localeCompare(a.id))
    .slice(0,3);
  if(recent.length) {
    const list=host.querySelector('.home-shelf-list');
    list.append(...recent.map(day=>dayCard(day,journal)));
    list.hidden=false;
  }
  status.textContent=entries.status==='rejected' ? source.failure :
    recent.length ? '' : 'Здесь появится первый сохранённый день.';
  if(draft.value || (!user && entries.status==='fulfilled' && !recent.length)) {
    const action=host.querySelector('.home-shelf-next');
    action.innerHTML=draft.value ? icon('book',18)+' Продолжить черновик' : icon('plus',18)+' Записать первый день';
    action.hidden=false;
  }
}
