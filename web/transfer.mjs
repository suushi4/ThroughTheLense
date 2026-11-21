import {analyzeAudio,analyzePhotos,checkAudio,checkPhotos,validCues,words,sceneMontage} from './scene.mjs';
import {sanitizeAmbience} from './ambience.mjs';

const format='ThroughTheLense/day';
const maxArchiveBytes=76*1024*1024;

async function encodeMedia(file,fallbackName){
  const bytes=new Uint8Array(await file.arrayBuffer());
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=16384){
    binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
  }
  return {name:file.name || fallbackName,type:file.type,data:btoa(binary)};
}

export async function exportDay(entry){
  const {dayDate,title,text,audioName,scene}=entry;
  const photos=await Promise.all(entry.photoFiles.map((photo,index)=>encodeMedia(photo,'Фото '+(index+1))));
  const audio=await encodeMedia(entry.audioFile,audioName);
  const {quoteAtSec,returnAtSec}=scene;
  const contents={format,version:1,dayDate,title,text,audioName,quote:scene.quote,coverIndex:scene.coverPhotoIndex,photos,audio,cues:{quoteAtSec,returnAtSec}};
  // Optional and still version 1: older readers ignore it.
  const ambience=sanitizeAmbience(scene.ambience);
  if(ambience.length)contents.ambience=ambience;
  const montage=sceneMontage(scene.montage,photos.length,scene.coverPhotoIndex);
  if(montage)contents.montage=montage;
  return new Blob([JSON.stringify(contents)],{type:'application/json'});
}

function decodeMedia(value,limit){
  if(typeof value?.data!=='string' || value.data.length>Math.ceil(limit/3)*4 ||
    typeof value.name!=='string' || typeof value.type!=='string')throw Error('Некорректный файл в копии дня.');
  const binary=atob(value.data);
  if(binary.length>limit)throw Error('Файл в копии дня слишком большой.');
  return new File([Uint8Array.from(binary,char=>char.charCodeAt(0))],value.name,{type:value.type});
}

export async function importDay(file,id){
  if(file.size>maxArchiveBytes)throw Error('Файл копии дня слишком большой.');
  let data;
  try{data=JSON.parse(await file.text());}
  catch{throw Error('Выберите файл копии дня ThroughTheLense.');}
  if(data?.format!==format || data.version!==1)throw Error('Формат копии дня не поддерживается.');
  const {dayDate,title,text,audioName,quote,coverIndex}=data;
  const validDate=typeof dayDate==='string' && /^\d{4}-\d{2}-\d{2}$/.test(dayDate) &&
    Number.isFinite(Date.parse(dayDate)) && new Date(dayDate).toISOString().slice(0,10)===dayDate;
  if(!validDate || typeof title!=='string' || !title.trim() || title.length>120 ||
    typeof audioName!=='string' || typeof text!=='string' || typeof quote!=='string' ||
    !quote || quote.length>200 || !words(quote).length || !text.includes(quote) ||
    !Array.isArray(data.photos) || data.photos.length<1 || data.photos.length>5 ||
    !Number.isInteger(coverIndex) || coverIndex<0 || coverIndex>=data.photos.length){
    throw Error('В копии дня не хватает данных для восстановления.');
  }
  const photoFiles=data.photos.map(photo=>decodeMedia(photo,8*1024*1024));
  const audioFile=decodeMedia(data.audio,12*1024*1024);
  checkPhotos(photoFiles);checkAudio(audioFile);
  const [{thumbnail,palette},timing]=await Promise.all([analyzePhotos(photoFiles,coverIndex),analyzeAudio(audioFile)]);
  const ambience=sanitizeAmbience(data.ambience);
  const montage=sceneMontage(data.montage,photoFiles.length,coverIndex);
  const cues=validCues(data.cues,timing.endAtSec)
    ? {quoteAtSec:data.cues.quoteAtSec,returnAtSec:data.cues.returnAtSec} : {};
  return {
    thumbnail,
    entry:{id,dayDate,title,text,audioName,photoFiles,audioFile,scene:{version:1,coverPhotoIndex:coverIndex,quote,palette,...timing,...cues,
      ...(ambience.length?{ambience}:{}),...(montage?{montage}:{})}}
  };
}
