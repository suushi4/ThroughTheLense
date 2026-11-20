// Server storage for days. Same contract as the IndexedDB functions in journal.mjs:
// days come back with real File objects, so editing and export keep working.

const tokenKey='ttl-owner';
const serverKeys=new WeakMap(); // File/Blob -> media key, so unchanged files are not uploaded again

function ownerToken(){
  let token=localStorage.getItem(tokenKey);
  if(!token){
    token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem(tokenKey,token);
  }
  return token;
}

// API mode needs a durable owner token; without localStorage the journal stays local.
export function ready(){
  try{ return ownerToken()===localStorage.getItem(tokenKey); }
  catch{ return false; }
}

async function call(method,path,{body,headers}={}){
  const response=await fetch(path,{method,body,cache:'no-store',headers:{Authorization:'Bearer '+ownerToken(),...headers}});
  if(response.status===204)return null;
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const error=Error(data?.error?.message || 'Сервер дневника не ответил.');
    error.code=data?.error?.code; error.status=response.status;
    throw error;
  }
  return data;
}

async function download(media,asFile){
  const response=await fetch(media.url);
  if(!response.ok)throw Error('Не удалось загрузить материалы дня.');
  const blob=await response.blob();
  const file=asFile ? new File([blob],media.name,{type:media.type,lastModified:media.lastModified}) : blob;
  serverKeys.set(file,media.key);
  return file;
}

export async function listDays(){
  const rows=await call('GET','/api/days');
  return Promise.all(rows.map(async row=>({
    id:row.id,dayDate:row.dayDate,title:row.title,audioName:row.audioName,
    photoCount:row.photoCount,duration:row.duration,
    thumbnail:await download(row.thumbnail,false).catch(()=>new Blob([],{type:'image/jpeg'}))
  })));
}

export async function getDay(id){
  let day;
  try{ day=await call('GET','/api/days/'+encodeURIComponent(id)); }
  catch(error){ if(error.status===404)return undefined; throw error; }
  const [photoFiles,audioFile]=await Promise.all([
    Promise.all(day.photos.map(photo=>download(photo,true))),
    download(day.audio,true)
  ]);
  return {id:day.id,dayDate:day.dayDate,title:day.title,text:day.text,audioName:day.audioName,slug:day.slug,photoFiles,audioFile,scene:day.scene};
}

// editing=true refuses to recreate a day that was deleted meanwhile.
export async function saveDay(entry,thumbnail,editing){
  const parts=[];
  function describe(file,part){
    const key=serverKeys.get(file);
    if(key)return {ref:key};
    parts.push([part,file]);
    return {part,name:file.name || part,lastModified:file.lastModified || Date.now()};
  }
  const {dayDate,title,text,audioName,scene}=entry;
  const meta={dayDate,title,text,audioName,scene,
    photos:entry.photoFiles.map((file,index)=>describe(file,'photo'+index)),
    audio:describe(entry.audioFile,'audio'),
    thumbnail:describe(thumbnail,'thumbnail')};
  const body=new FormData();
  body.append('meta',JSON.stringify(meta));
  for(const [part,file] of parts)body.append(part,file,file.name || part);
  const saved=await call('PUT','/api/days/'+encodeURIComponent(entry.id),{body,headers:editing?{'If-Match':'*'}:{}});
  // Saving again in this session can now refer to the stored copies.
  entry.photoFiles.forEach((file,index)=>serverKeys.set(file,saved.photos[index].key));
  serverKeys.set(entry.audioFile,saved.audio.key);
  return saved;
}

export async function removeDay(id){
  await call('DELETE','/api/days/'+encodeURIComponent(id));
}

export async function shareDay(id){
  return call('POST','/api/days/'+encodeURIComponent(id)+'/share');
}

export async function getPublicDay(slug){
  let day;
  try{ day=await fetch('/api/public/'+encodeURIComponent(slug),{cache:'no-store'}); }
  catch{ throw Error('Сервер дневника не ответил.'); }
  if(day.status===404)return undefined;
  if(!day.ok)throw Error('Не удалось открыть папку.');
  return day.json();
}
