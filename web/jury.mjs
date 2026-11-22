import {demos} from './demo.mjs';
import {mountPlayer} from './player.mjs';

const play=document.querySelector('#jury-play');
const host=document.querySelector('#jury-player');
let player;

play.addEventListener('click',event=>{
  if(event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
  player ??= mountPlayer(host,{...demos[0],audioPreload:'none'});
  event.preventDefault();
  document.querySelector('.jury-video').pause();
  player.screen(play);
});

addEventListener('pagehide',()=>player?.pause());
