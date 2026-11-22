import {exportDay} from './transfer.mjs';
import {ambienceItem,sanitizeAmbience} from './ambience.mjs';

const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,i)=>{
  for(let j=0;j<8;j++)i=(i>>>1)^((i&1)?0xedb88320:0);
  return i;
});

function crc32(bytes){
  let value=0xffffffff;
  for(const byte of bytes)value=(value>>>8)^crcTable[(value^byte)&255];
  return (value^0xffffffff)>>>0;
}

function fields(values){
  const bytes=new Uint8Array(values.reduce((sum,[size])=>sum+size,0));
  const view=new DataView(bytes.buffer);
  let offset=0;
  for(const [size,value] of values){
    if(size===2)view.setUint16(offset,value,true);
    else view.setUint32(offset,value,true);
    offset+=size;
  }
  return bytes;
}

function archive(files){
  const local=[], directory=[];
  let offset=0, directorySize=0;
  for(const [name,bytes] of files){
    const path=encoder.encode(name);
    const common=[[2,20],[2,0x800],[2,0],[2,0],[2,33],[4,crc32(bytes)],[4,bytes.length],[4,bytes.length],[2,path.length],[2,0]];
    const header=fields([[4,0x04034b50],...common]);
    const record=fields([[4,0x02014b50],[2,20],...common,[2,0],[2,0],[2,0],[4,0],[4,offset]]);
    local.push(header,path,bytes);
    directory.push(record,path);
    offset+=header.length+path.length+bytes.length;
    directorySize+=record.length+path.length;
  }
  const end=fields([[4,0x06054b50],[2,0],[2,0],[2,files.length],[2,files.length],[4,directorySize],[4,offset],[2,0]]);
  return new Blob([...local,...directory,end],{type:'application/zip'});
}

async function fetchSoundFile({file}){
  try{
    const response=await fetch('/media/ambience/'+file,{signal:AbortSignal.timeout(4000)});
    if(!response.ok || !response.headers.get('content-type')?.startsWith('audio/'))return null;
    const bytes=new Uint8Array(await response.arrayBuffer());
    return bytes.length?bytes:null;
  }catch{
    return null;
  }
}

export async function exportFolder(entry){
  const title=entry.title.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join('-').slice(0,60).replace(/-$/,'') || 'day';
  const folder=entry.dayDate+'-'+title;
  const assets=entry.photoFiles.map((file,index)=>{
    const extension=file.type==='image/webp' || /\.webp$/i.test(file.name)?'webp':
      file.type==='image/png' || /\.png$/i.test(file.name)?'png':'jpg';
    return [`photo-${index+1}.${extension}`,file];
  });
  assets.push([/wav|wave/i.test(entry.audioFile.type) || /\.wave?$/i.test(entry.audioFile.name)?'song.wav':'song.mp3',entry.audioFile]);
  const sounds=sanitizeAmbience(entry.scene.ambience).map(({id,gain})=>({...ambienceItem(id),gain}));
  const [copy,...soundFiles]=await Promise.all([exportDay(entry),...sounds.map(fetchSoundFile)]);
  assets.push(['day.json',copy]);
  const files=await Promise.all(assets.map(async ([name,blob])=>[folder+'/'+name,new Uint8Array(await blob.arrayBuffer())]));
  const {quote,coverPhotoIndex,quoteAtSec,returnAtSec,montage}=entry.scene;
  const soundNotes=sounds.map(({title,file,gain},index)=>{
    const path='ambience/'+file;
    if(soundFiles[index])files.push([folder+'/'+path,soundFiles[index]]);
    return `- ${title} · ${Math.round(gain*100)}% · ${soundFiles[index]?path:'файл недоступен при скачивании'}`;
  });
  const details=montage?.mode==='detail'?`\nДеталь — фото ${montage.detailIndex+1}.`:
    montage?.mode==='quiet' && sounds.length?'\nЗвуки места затихают во время фразы.':'';
  const ambience=sounds.length
    ?'\n\nЗвуки места\n'+soundNotes.join('\n')+'\n\nПри открытии day.json дневник воспроизводит встроенные звуки с указанными настройками. Для воспроизведения нужна доступная библиотека сайта.'
    :'';
  files.push([folder+'/day.txt',encoder.encode(
    `${entry.title}\n${entry.dayDate}\n\n${entry.text}\n\nФраза — «${quote}»\nОбложка — фото ${coverPhotoIndex+1}.${details}\nПесня — ${entry.audioName}\nФраза — ${quoteAtSec} с. Возврат кадра — ${returnAtSec} с.${ambience}\n\nЧтобы восстановить сцену, распакуйте ZIP и выберите day.json через «Открыть файл дня» в архиве ThroughTheLense.\n`
  )]);
  const warning=soundFiles.includes(null)
    ?'Папка скачана. Часть файлов звуков места недоступна. Настройки записаны в day.json.'
    :'';
  return {blob:archive(files),name:folder+'.zip',warning};
}
