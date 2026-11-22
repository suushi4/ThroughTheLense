// Tracks a person can take from the diary when they have no song of their
// own: the three example songs and ten CC0 recordings (docs/music-licenses.md).
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
];

export const diaryTracks = [
  ...demos.map(({id, audioName, audio, warmth}) => ({id, audioName, audio, warmth, mood:'из примеров'})),
  ...libraryTracks,
];
