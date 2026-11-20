import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {composeText,words,rhythm,phaseAt,checkPhotos,checkAudio} from './web/scene.mjs';
import {demos} from './web/demo.mjs';
test('a quoted detail stays verbatim, titles contain 3–7 words',()=>{
  for(const text of ['Әдемі!','Тихий двор. Слышно, как скрипит дверь.','Там   мой  самый лучший друг и мама и папа.','Сегодня шёл дождь. Мы впервые за неделю шли домой без спешки.']){
    const {quote,quotes,title}=composeText(text); assert.ok(text.includes(quote));
    assert.ok(quotes.every(q=>text.includes(q)));assert.ok(words(title).length>=3 && words(title).length<=7);
  }
  assert.throws(()=>composeText('...'));
  assert.equal(composeText(demos[0].text).quote,demos[0].scene.quote);
});
test('quiet and shortest valid tracks retain both transitions',()=>{
  for(const duration of [3,12,60]){
    const result=rhythm([new Float32Array(1000*duration)],1000,duration);
    assert.equal(result.endAtSec,Math.min(12,duration));
    assert.ok(result.quoteAtSec>0 && result.quoteAtSec<result.returnAtSec && result.returnAtSec<result.endAtSec);
    assert.equal(phaseAt(result,0),0);assert.equal(phaseAt(result,result.quoteAtSec),1);assert.equal(phaseAt(result,result.returnAtSec),2);
  }
});
function readSound(demo){
  const data=fs.readFileSync(new URL('./web/'+demo.audio,import.meta.url));
  const rate=data.readUInt32LE(24),length=(data.length-44)/2;
  const channel=Float32Array.from({length},(_,i)=>data.readInt16LE(44+i*2)/32768);
  return rhythm([channel],rate,length/rate);
}
test('examples match their actual audio cues and reuse a single cover index',()=>{
  const times=demos.map(d=>{
    const r=readSound(d);
    assert.equal(d.scene.coverPhotoIndex,0);assert.ok(d.text.includes(d.scene.quote));
    assert.deepEqual(r,{quoteAtSec:d.scene.quoteAtSec,returnAtSec:d.scene.returnAtSec,endAtSec:d.scene.endAtSec});
    return r.quoteAtSec;
  });
  assert.ok(Math.abs(times[0]-times[1])>=0.75);
});
test('media file boundaries and counts',()=>{
  const photo={type:'image/jpeg',size:8*1024*1024,name:'1.jpg'}, song={type:'audio/wav',size:12*1024*1024,name:'t.wav'};
  checkPhotos(Array(5).fill(photo));checkAudio(song);
  for(const files of [[],Array(6).fill(photo),[{...photo,size:photo.size+1}],[{...photo,type:'image/gif'}]])assert.throws(()=>checkPhotos(files));
  for(const audio of [null,{...song,size:song.size+1},{...song,name:'t.flac',type:'audio/flac'}])assert.throws(()=>checkAudio(audio));
});
