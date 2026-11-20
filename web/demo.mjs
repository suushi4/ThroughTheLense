const examples = [
  {key:'street',dayDate:'2026-11-17',title:'Домой без спешки', audioName:'Вечерний маршрут', photos:['street','rain'], alts:['Мокрая дорога на фоне гор в вечернем свете','Свет фонаря в луже у перехода'], text:'После сдачи проекта мы вышли на улицу. Мы впервые за неделю шли домой без спешки. На перекрёстке пропустили зелёный, чтобы дослушать песню.',quote:'Мы впервые за неделю шли домой без спешки.',palette:'#d7d1c6',quoteAtSec:2.7,returnAtSec:7.8},
  {key:'cocoa',dayDate:'2026-11-12',title:'Какао у остановки',audioName:'Два стаканчика',photos:['cocoa'],alts:['Два стаканчика какао у мокрого стекла остановки'],text:'Утро началось с двух стаканчиков какао. Она всё ждала, пока я договорю. Мы даже не заметили, как уехал наш автобус.',quote:'Она всё ждала, пока я договорю.',palette:'#e7d7be',quoteAtSec:4.6,returnAtSec:9.7},
  {key:'stage',dayDate:'2026-11-08',title:'Свет после репетиции',audioName:'После занавеса',photos:['stage'],alts:['Деревянный стул на пустой сцене в полосе тёплого света'],text:'На сцене остался один стул. Через дверь мы услышали, как зал хлопает. Мы стояли за кулисами, и никто не хотел уходить первым.',quote:'Через дверь мы услышали, как зал хлопает.',palette:'#d9cfc1',quoteAtSec:3.8,returnAtSec:7.7}
];
export const demos=examples.map(({key,photos,quote,palette,quoteAtSec,returnAtSec,...rest})=>({
 ...rest,id:'demo-'+key,example:true,photos:photos.map(p=>'media/'+p+'.jpg'),thumbnail:'media/'+photos[0]+'.jpg',
 audio:'media/'+key+'.wav',photoCount:photos.length,
 scene:{version:1,coverPhotoIndex:0,quote,palette,quoteAtSec,returnAtSec,endAtSec:12}
}));
export async function exampleFile(path) {
  const response=await fetch(path); if(!response.ok)throw Error('Не удалось загрузить материалы примера.');
  const blob=await response.blob(); return new File([blob],path.split('/').pop(),{type:blob.type});
}
