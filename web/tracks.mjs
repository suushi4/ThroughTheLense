// Built-in songs and their sources are listed in docs/music-licenses.md.
// warmth is the mood on the scale coverWarmth() gives photos (≈0.06 cool,
// ≈0.13 warm), so «подходит к фото» can point at the closest one.
import {demos} from './demo.mjs';

export const libraryTracks = [
  {id:'track-morning-light', audioName:'Утренний свет', mood:'светлое, спокойное', audio:'media/music/morning-light.mp3', warmth:0.12},
  {id:'track-light-steps', audioName:'Лёгкие шаги', mood:'игривое, быстрое', audio:'media/music/light-steps.mp3', warmth:0.13},
  {id:'track-long-look', audioName:'Долгий взгляд', mood:'грустное, медленное', audio:'media/music/long-look.mp3', warmth:0.065},
  {id:'track-night-talk', audioName:'Ночной разговор', mood:'нежное, вечернее', audio:'media/music/night-talk.mp3', warmth:0.075},
  {id:'track-last-waltz', audioName:'Последний вальс', mood:'ностальгия', audio:'media/music/last-waltz.mp3', warmth:0.07},
  {id:'track-room-dance', audioName:'Танец в комнате', mood:'загадочное, танцевальное', audio:'media/music/room-dance.mp3', warmth:0.095},
  {id:'track-steppe-road', audioName:'Дорога в степи', mood:'простор, дорога', audio:'media/music/steppe-road.mp3', warmth:0.105},
  {id:'track-quiet-comfort', audioName:'Тихое утешение', mood:'тёплое, утешающее', audio:'media/music/quiet-comfort.mp3', warmth:0.09},
  {id:'track-square-festival', audioName:'Праздник на площади', mood:'яркое, праздничное', audio:'media/music/square-festival.mp3', warmth:0.14},
  {id:'track-wind-window', audioName:'Ветер в окно', mood:'тревожное, порывистое', audio:'media/music/wind-window.mp3', warmth:0.06},
  {id:'track-soft-morning', audioName:'Тихое утро', mood:'спокойное фортепиано', audio:'media/music/soft-morning.mp3', warmth:0.115},
  {id:'track-open-window', audioName:'Открытое окно', mood:'светлая гитара', audio:'media/music/open-window.mp3', warmth:0.126},
  {id:'track-blue-hour', audioName:'Синий час', mood:'медленное, задумчивое', audio:'media/music/blue-hour.mp3', warmth:0.048},
  {id:'track-paper-lanterns', audioName:'Бумажные фонари', mood:'игривое, колокольчики', audio:'media/music/paper-lanterns.mp3', warmth:0.137},
  {id:'track-late-platform', audioName:'Поздняя платформа', mood:'ностальгия, дорога', audio:'media/music/late-platform.mp3', warmth:0.079},
  {id:'track-beyond-hills', audioName:'За холмами', mood:'простор, мягкий синтезатор', audio:'media/music/beyond-hills.mp3', warmth:0.1},
];

export const diaryTracks = [
  ...demos.map(({id, audioName, audio, warmth}) => ({id, audioName, audio, warmth, mood:'из примеров'})),
  ...libraryTracks,
];
