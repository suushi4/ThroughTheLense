import * as local from './journal.mjs?v=2';
import {account,currentUser,localDiary} from './account.mjs';
import {cloudDiary} from './cloud-diary.mjs';
import {exportDay,importDay} from './transfer.mjs';

let storage;
export async function connectDiary() {
  const provider = await account();
  const user = await currentUser();
  if (!user) return null;
  local.selectArchive(provider.mode+'-'+user.id);
  storage = provider.mode === 'supabase' ? cloudDiary(provider.client,user.id) : localDiary;
  return user;
}
export const {getDraft,saveDraft} = local;
export async function listDays() {
  if (!storage) return local.listDays();
  const rows = await storage.list();
  return Promise.all(rows.map(async row => {
    const thumbnail = /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(row.thumbnail)
      ? await (await fetch(row.thumbnail)).blob() : new Blob();
    return {...row,thumbnail};
  }));
}
export async function getDay(id) {
  if (!storage) return local.getDay(id);
  const copy = await storage.open(id);
  return copy ? (await importDay(copy,id)).entry : undefined;
}
export async function saveDay(entry,thumbnail,draftKey) {
  if (!storage) return local.saveDay(entry,thumbnail,draftKey);
  const cover = new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(thumbnail);
  });
  const [copy,image] = await Promise.all([exportDay(entry),cover]);
  const {id,dayDate,title,audioName,photoFiles,scene} = entry;
  await storage.save(id,{dayDate,title,audioName,photoCount:photoFiles.length,thumbnail:image,duration:scene.endAtSec},copy,draftKey===id);
  if (draftKey) await local.removeDraft(draftKey).catch(() => {});
}
export async function removeDay(id) {
  if (!storage) return local.removeDay(id);
  await storage.remove(id);
  await local.removeDraft(id).catch(() => {});
}
