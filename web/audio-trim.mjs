// A short PCM WAV works with the same player, day copy and server validator.
export async function trimSong(file,startSeconds,lengthSeconds){
  const Offline=window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const rate=24000;
  const source=await new Offline(1,1,rate).decodeAudioData(await file.arrayBuffer());
  const start=Math.round(startSeconds*rate);
  const frames=Math.min(Math.round(lengthSeconds*rate),source.length-start);
  if(frames<rate*3)throw Error('Оставьте во фрагменте хотя бы 3 секунды.');
  const channels=Math.min(2,source.numberOfChannels);
  const samples=Array.from({length:channels},(_,i)=>source.getChannelData(i));
  const size=frames*channels*2;
  const view=new DataView(new ArrayBuffer(44+size));
  for(const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']]){
    for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));
  }
  view.setUint32(4,36+size,true);
  view.setUint32(16,16,true);
  view.setUint16(20,1,true);
  view.setUint16(22,channels,true);
  view.setUint32(24,rate,true);
  view.setUint32(28,rate*channels*2,true);
  view.setUint16(32,channels*2,true);
  view.setUint16(34,16,true);
  view.setUint32(40,size,true);
  const fade=Math.floor(rate*0.012);
  for(let frame=0;frame<frames;frame++){
    const gain=Math.min(1,frame/fade,(frames-1-frame)/fade);
    for(let ch=0;ch<channels;ch++){
      const value=Math.max(-1,Math.min(1,samples[ch][start+frame]))*gain;
      view.setInt16(44+2*(frame*channels+ch),Math.round(value*32767),true);
    }
  }
  return new File([view.buffer],file.name.replace(/\.[^.]+$/,'')+'-фрагмент.wav',{type:'audio/wav'});
}
