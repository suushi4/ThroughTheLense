const assert = require('node:assert/strict');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('../gstack/node_modules/playwright')); }
const base = 'http://127.0.0.1:8000/journal.html';
const media = file => path.join(__dirname, '../web/media', file);
async function run() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({viewport:{width:1440,height:970}});
    const page = await context.newPage();
    page.setDefaultTimeout(7500);
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const snap=async(file)=>{if(process.env.TTL_EVIDENCE)await page.screenshot({path:path.join(process.env.TTL_EVIDENCE,file)});};
    // Chrome can retain a pre-draft module under its original, unversioned URL.
    const staleJournal=url=>url.pathname==='/journal.mjs' && !url.search;
    await page.route(staleJournal,route=>route.fulfill({
      contentType:'text/javascript',
      body:'export const getDay=()=>{},listDays=()=>[],saveDay=()=>{};'
    }));
    await page.goto(base);
    await page.locator('.day-card').first().waitFor();
    await page.unroute(staleJournal);
    assert.equal(await page.locator('.day-card').count(),3);
    const search=page.getByRole('searchbox');
    await search.fill(' СТАКАНЧИКА ');
    assert.equal(await page.locator('.day-card').count(),1);
    assert.equal(await page.locator('.feature').getAttribute('href'),'#day/demo-cocoa');
    assert.equal(await page.locator('#next-feature').isVisible(),false);
    await search.fill('08.11.2026 свет');
    await page.locator('.day-card').click();
    await page.locator('.back').click();
    assert.equal(await search.inputValue(),'08.11.2026 свет');
    assert.equal(await page.locator('.feature').getAttribute('href'),'#day/demo-stage');
    await search.fill('нет таких дней');
    await page.getByRole('heading',{name:'Совпадений пока нет'}).waitFor();
    assert.equal(await page.locator('.feature').count(),0);
    await page.getByRole('button',{name:'Сбросить поиск'}).click();
    assert.equal(await search.evaluate(el=>el===document.activeElement),true);
    await snap('archive.png');
    await page.locator('.feature').click();
    await page.getByRole('button',{name:'Пауза',exact:true}).waitFor();
    const firstPhoto=await page.locator('.stage img').getAttribute('src');
    await page.waitForSelector('.stage[data-phase="1"]');
    assert.match(await page.locator('.reveal').innerText(),/без спешки/);
    await page.getByRole('button',{name:'Пауза',exact:true}).click();
    await page.getByRole('button',{name:'Воспроизвести',exact:true}).waitFor();
    const paused=await page.locator('.meter').inputValue();
    await page.getByRole('button',{name:'Развернуть сцену'}).click();
    const screening=page.getByRole('dialog',{name:'Просмотр воспоминания'});
    assert.equal(await screening.locator('.meter').inputValue(),paused);
    await page.keyboard.press('Escape');
    await screening.waitFor({state:'hidden'});
    await page.waitForTimeout(350);assert.equal(await page.locator('.meter').inputValue(),paused);
    await page.getByRole('button',{name:'Воспроизвести',exact:true}).click();
    await page.waitForSelector('.stage[data-phase="2"]');
    assert.equal(await page.locator('.stage img').getAttribute('src'),firstPhoto);
    await page.getByRole('button',{name:'Повторить',exact:true}).waitFor();
    await page.getByRole('button',{name:'С начала',exact:true}).click();
    await page.waitForSelector('.stage[data-phase="0"]');
    await page.getByRole('button',{name:'Выключить звук'}).click();
    assert.equal(await page.getByRole('button',{name:'Включить звук'}).count(),1);
    await page.getByRole('link',{name:'Записать день',exact:true}).click();
    await page.getByRole('button',{name:'Посмотреть сцену'}).click();
    assert.ok(await page.locator('#err-story').innerText());
    await page.locator('#story').fill('Сегодня мы гуляли. Мы впервые шли домой без спешки.');
    await page.locator('#date').fill('2026-11-18');
    await page.locator('#photos').setInputFiles(media('street.jpg'));
    await page.locator('#song').setInputFiles({name:'bad.wav',mimeType:'audio/wav',buffer:Buffer.from('broken')});
    await page.locator('#prepare').click();
    await page.waitForFunction(()=>document.querySelector('#err-song')?.textContent.includes('прочитать'));
    assert.match(await page.locator('#story').inputValue(),/гуляли/);
    await page.locator('#song').setInputFiles(media('street.wav'));
    // Delay the first decode to reproduce a track change while preparation is running.
    await page.evaluate(()=>{
      const native=OfflineAudioContext.prototype.decodeAudioData;
      OfflineAudioContext.prototype.decodeAudioData=async function(...args){
        OfflineAudioContext.prototype.decodeAudioData=native;
        const decoded=await native.apply(this,args);
        await new Promise(resolve=>{window.releaseFirstDecode=resolve;});
        return decoded;
      };
    });
    await page.locator('#prepare').click();
    await page.waitForFunction(()=>typeof window.releaseFirstDecode==='function');
    await page.locator('#soundtrack').selectOption('demo-stage');
    await page.waitForFunction(()=>document.querySelector('#audio-list').innerText.includes('После занавеса'));
    await page.evaluate(()=>window.releaseFirstDecode());
    await page.waitForTimeout(100);
    assert.equal(new URL(page.url()).hash,'#new');
    await page.locator('#prepare').click();
    await page.locator('#save').waitFor();
    assert.match(await page.locator('.page-heading p').innerText(),/После занавеса/);
    await page.locator('#entry-title').fill('Наш день у гор');
    await page.locator('#choice').selectOption('custom');
    await page.locator('#custom-quote').fill('Чужая фраза.');
    await page.locator('#save').click();
    assert.ok(await page.locator('#err-quote').innerText());
    assert.equal(await page.locator('#custom-quote').getAttribute('aria-invalid'),'true');
    await page.locator('#custom-quote').fill('мы гуляли');
    await page.getByRole('link',{name:'К материалам'}).click();
    await page.locator('#soundtrack').selectOption('demo-cocoa');
    await page.waitForFunction(()=>document.querySelector('#audio-list').innerText.includes('Два стаканчика'));
    await page.locator('#prepare').click();
    await page.locator('#save').waitFor();
    assert.equal(await page.locator('#entry-title').inputValue(),'Наш день у гор');
    assert.equal(await page.locator('#custom-quote').inputValue(),'мы гуляли');
    const quoteBeforeCompare=await page.locator('#chosen-quote').innerText();
    const coverBeforeCompare=await page.locator('.stage img').getAttribute('src');
    await page.locator('.track-comparison summary').click();
    await page.locator('#compare-track').click();
    await page.getByRole('button',{name:'Вернуть «Два стаканчика»'}).waitFor();
    assert.equal(await page.locator('#quote-cue').inputValue(),'2.7');
    assert.equal(await page.locator('#chosen-quote').innerText(),quoteBeforeCompare);
    assert.equal(await page.locator('.stage img').getAttribute('src'),coverBeforeCompare);
    await page.locator('#compare-track').click();
    await page.getByRole('button',{name:'Поставить «Вечерний маршрут»'}).waitFor();
    assert.equal(await page.locator('#quote-cue').inputValue(),'4.6');
    // Abort after the first write and before the second write can finish.
    await page.evaluate(()=>{
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){
        if(this.name==='content'){
          IDBObjectStore.prototype.put=put;
          this.transaction.abort();
        }
        return put.apply(this,args);
      };
    });
    await page.locator('#save').click();
    await page.waitForFunction(()=>document.querySelector('#err-save')?.textContent.includes('сохранить'));
    const aborted=await page.evaluate(async()=>{
      const db=await new Promise(resolve=>{const r=indexedDB.open('ThroughTheLense');r.onsuccess=()=>resolve(r.result);});
      const tx=db.transaction(['entries','content']);
      const counts=await Promise.all(['entries','content'].map(name=>new Promise(resolve=>{const r=tx.objectStore(name).count();r.onsuccess=()=>resolve(r.result);})));
      db.close();return counts;
    });
    assert.deepEqual(aborted,[0,0]);
    await page.locator('#save').dblclick();
    await page.waitForURL('**#day/*');
    const savedURL=page.url();
    await page.reload();
    await page.getByRole('heading',{name:'Наш день у гор'}).waitFor();
    const originalAudio=page.getByRole('main').locator('audio[aria-label="Исходный трек"]');
    assert.equal(await originalAudio.getAttribute('src'),null);
    await page.locator('.materials summary').click();
    assert.equal(await page.locator('.original').innerText(),'Сегодня мы гуляли. Мы впервые шли домой без спешки.');
    assert.equal(await page.locator('.source-photos img').count(),1);
    await page.locator('.materials audio[src^="blob:"]').waitFor();
    await page.getByRole('button',{name:'Открыть снимок 1'}).click();
    assert.ok(await page.getByRole('dialog',{name:'Фотография дня'}).isVisible());await page.keyboard.press('Escape');
    const readStored=()=>page.evaluate(async()=>{
      const db=await new Promise((res,rej)=>{const r=indexedDB.open('ThroughTheLense');r.onsuccess=()=>res(r.result);r.onerror=rej;});
      const tx=db.transaction(['content','entries']);
      const read=s=>new Promise((res,rej)=>{const r=tx.objectStore(s).getAll();r.onsuccess=()=>res(r.result);r.onerror=rej;});
      const [content,entries]=await Promise.all([read('content'),read('entries')]);db.close();
      return {count:entries.length,rows:content.map(c=>({title:c.title,dayDate:c.dayDate,quote:c.scene.quote,cue:c.scene.quoteAtSec}))};
    });
    const first=await readStored();assert.equal(first.count,1);assert.equal(first.rows[0].cue,4.6);assert.equal(first.rows[0].quote,'мы гуляли');
    await page.locator('.create-link').click();
    await page.locator('#fill-demo').click();
    await page.waitForFunction(()=>document.querySelector('#photo-list')?.children.length===2);
    await page.locator('#date').fill('2026-11-18');
    await page.locator('#prepare').click();await page.locator('#save').click();
    await page.waitForURL('**#day/*');assert.notEqual(page.url(),savedURL);
    const second=await readStored();assert.equal(second.count,2);
    assert.deepEqual(second.rows.map(x=>x.dayDate),['2026-11-18','2026-11-18']);
    assert.ok(second.rows.some(x=>x.cue===2.7));
    await page.locator('.back').click();
    await page.getByRole('button',{name:'Мои дни',exact:true}).click();
    assert.equal(await page.locator('.day-card').count(),2);
    // Earlier builds kept native File/Blob values in both stores.
    await page.evaluate(async id=>{
      const {getDay}=await import('./journal.mjs');
      const content=await getDay(id);
      const db=await new Promise(resolve=>{const r=indexedDB.open('ThroughTheLense');r.onsuccess=()=>resolve(r.result);});
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(['content','entries'],'readwrite');
        tx.oncomplete=resolve;tx.onabort=reject;
        tx.objectStore('content').put(content);
        const summaries=tx.objectStore('entries'),r=summaries.get(id);
        r.onsuccess=()=>{const row=r.result;delete row.duration;row.thumbnail=new Blob([row.thumbnail.bytes],{type:row.thumbnail.type});summaries.put(row);};
      });
      db.close();
    },new URL(savedURL).hash.split('/')[1]);
    await page.reload();await page.locator('.day-card').first().waitFor();
    await page.goto(savedURL);await page.locator('.materials summary').click();
    await page.waitForFunction(()=>document.querySelector('.source-photos img')?.naturalWidth>0);
    assert.equal(await page.locator('.original').innerText(),'Сегодня мы гуляли. Мы впервые шли домой без спешки.');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Desktop passed: three demos, actual audio and phases, pause/replay/mute, file errors and replacement, custom edit, music A/B, stale audio, atomic rollback, double save, reload, legacy file storage, two days with the same date.');
    const mobile=await browser.newContext({viewport:{width:360,height:800},isMobile:true,deviceScaleFactor:1,reducedMotion:'reduce'});
    const phone=await mobile.newPage();await phone.goto(base);
    await phone.locator('.day-card').first().waitFor();
    assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth),360);
    if(process.env.TTL_EVIDENCE)await phone.screenshot({path:path.join(process.env.TTL_EVIDENCE,'mobile.png')});
    await phone.getByRole('button',{name:'Мои дни',exact:true}).click();
    await phone.getByRole('heading',{name:'Ваш первый день'}).waitFor();
    assert.equal(await phone.locator('.spread').isVisible(),false);
    await phone.getByRole('link',{name:'Записать день',exact:true}).click();await phone.locator('#fill-demo').click();
    await phone.waitForFunction(()=>document.querySelector('#photo-list')?.children.length===2);
    await phone.locator('[data-cover="1"]').click();
    assert.equal(await phone.locator('#proof-image').getAttribute('src'),await phone.locator('[data-cover="1"] img').getAttribute('src'));
    await phone.locator('#prepare').click();await phone.locator('#save').waitFor();
    await phone.locator('.timing-editor summary').click();
    await phone.locator('#quote-cue').fill('3.5');
    await phone.locator('#return-cue').fill('8.4');
    assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth),360);
    await phone.locator('#save').click();await phone.waitForURL('**#day/*');await phone.reload();
    const savedCover=await phone.evaluate(async()=>{
      const {getDay}=await import('./journal.mjs');
      const entry=await getDay(location.hash.slice(5));
      return [entry.scene.coverPhotoIndex,entry.photoFiles.map(file=>file.name),entry.scene.quoteAtSec,entry.scene.returnAtSec];
    });
    assert.deepEqual(savedCover,[1,['street.jpg','rain.jpg'],3.5,8.4]);
    await phone.getByRole('button',{name:'Воспроизвести',exact:true}).click();
    await phone.waitForSelector('.stage[data-phase="1"]');
    await phone.locator('.back').click();
    await phone.getByRole('button',{name:'Примеры',exact:true}).click();
    const featured=await phone.locator('.feature').getAttribute('href');
    await phone.getByRole('button',{name:'Случайный день'}).click();
    await phone.getByRole('button',{name:'Пауза',exact:true}).waitFor();
    assert.notEqual(new URL(phone.url()).hash,featured);
    console.log('Mobile passed: 360 px, reduced motion, manual cues saved across reload, real playback and random day.');
  } finally {await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
