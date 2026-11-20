let connection;
function openArchive() {
  if (!connection) {
    connection = new Promise((resolve,reject)=>{
      const req=indexedDB.open('ThroughTheLense',2);
      let blocked=false;
      req.onblocked=()=>{
        blocked=true;
        reject(Error('Другая вкладка ещё использует старую версию дневника.'));
      };
      req.onupgradeneeded=event=>{
        if(event.oldVersion===0){
          for(const name of ['entries','content'])req.result.createObjectStore(name,{keyPath:'id'});
        }
        req.result.createObjectStore('drafts',{keyPath:'key'});
      };
      req.onsuccess=()=>{
        const db=req.result;
        if(blocked){db.close();return;}
        db.onversionchange=()=>{ db.close(); connection=null; };
        resolve(db);
      };
      req.onerror=()=>reject(req.error);
    }).catch(error=>{ connection=null; throw error; });
  }
  return connection;
}
async function read(store, method, key) {
  const db=await openArchive();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(store).objectStore(store)[method](key);
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}

// Use byte records so private WebKit stores never need to persist file-backed Blobs.
async function packMedia(blob) {
  return {
    bytes: await blob.arrayBuffer(),
    type: blob.type,
    name: blob.name,
    lastModified: blob.lastModified
  };
}
const draftMedia=new WeakMap();
function packDraftMedia(blob){
  if(!draftMedia.has(blob)){
    draftMedia.set(blob,packMedia(blob).catch(error=>{draftMedia.delete(blob);throw error;}));
  }
  return draftMedia.get(blob);
}
function unpackMedia(stored) {
  if (stored instanceof Blob) return stored; // Entries written by the first demo.
  const options = {type: stored.type, lastModified: stored.lastModified};
  return stored.name === undefined
    ? new Blob([stored.bytes], options)
    : new File([stored.bytes], stored.name, options);
}
async function idbListDays() {
  const rows = await read('entries', 'getAll');
  return rows.map(row => ({...row, thumbnail: unpackMedia(row.thumbnail)}));
}
async function idbGetDay(id) {
  const row = await read('content', 'get', id);
  if (!row) return undefined;
  return {
    ...row,
    photoFiles: row.photoFiles.map(unpackMedia),
    audioFile: unpackMedia(row.audioFile)
  };
}
export async function getDraft(key) {
  const row=await read('drafts','get',key);
  if(!row)return undefined;
  return {...row,photos:row.photos.map(unpackMedia),audio:row.audio && unpackMedia(row.audio)};
}
export async function saveDraft(key,draft) {
  const snapshot={...draft};
  const [photos,audio,db]=await Promise.all([
    Promise.all(snapshot.photos.map(packDraftMedia)),
    snapshot.audio && packDraftMedia(snapshot.audio),
    openArchive()
  ]);
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts','readwrite');
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error || Error('Не удалось сохранить черновик.'));
    tx.objectStore('drafts').put({...snapshot,key,photos,audio});
  });
}
async function idbRemoveDay(id) {
  const db=await openArchive();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['entries','content','drafts'],'readwrite');
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error || Error('Не удалось удалить день.'));
    for(const name of ['entries','content','drafts'])tx.objectStore(name).delete(id);
  });
}
async function idbSaveDay(entry, thumbnail, draftKey) {
  const snapshot = {...entry, scene: {...entry.scene}};
  const {id, dayDate, title, audioName} = snapshot;
  const [photos, audio, cover, db] = await Promise.all([
    Promise.all(snapshot.photoFiles.map(packMedia)),
    packMedia(snapshot.audioFile),
    packMedia(thumbnail),
    openArchive()
  ]);
  const summary = {id, dayDate, title, audioName, photoCount: photos.length, thumbnail: cover, duration: snapshot.scene.endAtSec};
  const content = {...snapshot, photoFiles: photos, audioFile: audio};
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'content', 'drafts'], 'readwrite');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || Error('Сохранение прервано.'));
    function write(){
      tx.objectStore('entries').put(summary);
      tx.objectStore('content').put(content);
      if(draftKey)tx.objectStore('drafts').delete(draftKey);
    }
    try {
      if(draftKey===id){
        const existing=tx.objectStore('content').getKey(id);
        existing.onsuccess=()=>{
          if(existing.result===undefined){tx.abort();return;}
          try{write();}catch{tx.abort();}
        };
      }else write();
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction has already been aborted. */ }
      reject(error);
    }
  });
}

// Server storage when the journal is served by the backend; IndexedDB otherwise
// (serve.py, offline, or no localStorage). Chosen once per page load.
let backend;
function server() {
  backend ??= (async () => {
    try {
      const response = await fetch('/api/health', {cache: 'no-store', signal: AbortSignal.timeout?.(1500)});
      if (!response.ok || (await response.json())?.ok !== true) return null;
      const api = await import('./storage-api.mjs');
      return api.ready() ? api : null;
    } catch { return null; }
  })();
  return backend;
}
export async function usesServer() { return Boolean(await server()); }
async function removeDraft(key) {
  const db=await openArchive();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts','readwrite');
    tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error);
    tx.objectStore('drafts').delete(key);
  });
}
export async function listDays() {
  const api = await server();
  return api ? api.listDays() : idbListDays();
}
export async function getDay(id) {
  const api = await server();
  return api ? api.getDay(id) : idbGetDay(id);
}
export async function saveDay(entry, thumbnail, draftKey) {
  const api = await server();
  if (!api) return idbSaveDay(entry, thumbnail, draftKey);
  await api.saveDay(entry, thumbnail, draftKey === entry.id);
  if (draftKey) await removeDraft(draftKey).catch(() => {});
}
export async function removeDay(id) {
  const api = await server();
  if (!api) return idbRemoveDay(id);
  await api.removeDay(id);
  await removeDraft(id).catch(() => {});
}
