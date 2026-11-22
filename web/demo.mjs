const examples = [
  {key:'street',warmth:0.063,dayDate:'2026-11-17',title:'Домой без спешки', audioName:'Вечерний маршрут', photos:['street','rain'], alts:['Мокрая дорога на фоне гор в вечернем свете','Свет фонаря в луже у перехода'], text:'После сдачи проекта мы вышли на улицу. Мы впервые за неделю шли домой без спешки. На перекрёстке пропустили зелёный, чтобы дослушать песню.',quote:'Мы впервые за неделю шли домой без спешки.',montage:{mode:'detail',detailIndex:1},ambience:[{id:'wet-asphalt',gain:.23},{id:'street-traffic',gain:.22}],palette:'#d7d1c6',quoteAtSec:2.7,returnAtSec:7.8},
  {key:'cocoa',warmth:0.133,dayDate:'2026-11-12',title:'Какао у остановки',audioName:'Два стаканчика',photos:['cocoa'],alts:['Два стаканчика какао у мокрого стекла остановки'],text:'Утро началось с двух стаканчиков какао. Она всё ждала, пока я договорю. Мы даже не заметили, как уехал наш автобус.',quote:'Она всё ждала, пока я договорю.',ambience:[{id:'street-traffic',gain:.19}],palette:'#e7d7be',quoteAtSec:4.6,returnAtSec:9.7},
  {key:'stage',warmth:0.086,dayDate:'2026-11-08',title:'Свет после репетиции',audioName:'После занавеса',photos:['stage'],alts:['Деревянный стул на пустой сцене в полосе тёплого света'],text:'На сцене остался один стул. Через дверь мы услышали, как зал хлопает. Мы стояли за кулисами, и никто не хотел уходить первым.',quote:'Через дверь мы услышали, как зал хлопает.',montage:{mode:'quiet'},ambience:[{id:'crowd-talk',gain:.21}],palette:'#d9cfc1',quoteAtSec:3.8,returnAtSec:7.7}
];
export const demos=examples.map(({key,photos,quote,palette,quoteAtSec,returnAtSec,montage,ambience,...rest})=>({
 ...rest,id:'demo-'+key,example:true,photos:photos.map(p=>'media/'+p+'.jpg'),thumbnail:'media/'+photos[0]+'.jpg',
 audio:'media/'+key+'.wav',photoCount:photos.length,
 scene:{version:1,coverPhotoIndex:0,montage,ambience,quote,palette,quoteAtSec,returnAtSec,endAtSec:12}
}));
export async function exampleFile(path) {
  const response=await fetch(path,{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Не удалось загрузить материалы примера.');
  const blob=await response.blob(); return new File([blob],path.split('/').pop(),{type:blob.type});
}
