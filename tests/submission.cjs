// End-to-end against the Go build, with a fresh test database.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');

const base=process.env.TTL_TEST_URL || 'http://127.0.0.1:8080';

function storedZipFiles(bytes){
  const files=new Map();
  for(let start=0;bytes.readUInt32LE(start)===0x04034b50;){
    assert.equal(bytes.readUInt16LE(start+8),0,'ZIP entry must be stored');
    const nameLength=bytes.readUInt16LE(start+26), extraLength=bytes.readUInt16LE(start+28);
    const name=bytes.toString('utf8',start+30,start+30+nameLength);
    const begin=start+30+nameLength+extraLength;
    start=begin+bytes.readUInt32LE(start+18);
    files.set(name.slice(name.indexOf('/')+1),bytes.subarray(begin,start));
  }
  assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length-12),files.size);
  return files;
}

async function run(){
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext({baseURL:base,viewport:{width:1360,height:900},reducedMotion:'reduce'});
    const p=await context.newPage(), errors=[];
    p.on('pageerror',error=>errors.push(error.message));
    await p.goto('/');
    const decline=p.getByRole('button',{name:'Отклонить',exact:true});
    if(await decline.isVisible())await decline.click();
    const hero=p.locator('.hero-play');
    await hero.click();
    await p.locator('#home-player dialog[open] .stage').waitFor();
    await p.locator('#home-player dialog[open] .stage[data-detail]').waitFor();
    await p.getByRole('button',{name:'Закрыть',exact:true}).click();
    await p.waitForFunction(()=>document.activeElement?.classList.contains('hero-play'));

    await p.goto('/jury.html');
    const juryPlay=p.getByRole('link',{name:'Смотреть сцену · 12 с'});
    await juryPlay.click();
    const juryScreen=p.locator('#jury-player dialog[open]');
    await juryScreen.locator('.stage[data-detail]').waitFor();
    await juryScreen.getByRole('button',{name:'Закрыть',exact:true}).click();
    await p.waitForFunction(()=>document.activeElement?.id==='jury-play');
    assert.equal(await p.getByRole('link',{name:'Сравнить три песни'}).getAttribute('href'),'/#experiment');

    const register=await context.request.post('/api/register',{
      headers:{'X-Diary-Request':'1'},
      data:{email:'submission-'+Date.now()+'@example.org',password:'Test-day-scenes-2026'}
    });
    assert.equal(register.status(),200);
    await p.goto('/journal.html?example=demo-street#new');
    await p.locator('#fill-demo').click();
    await p.waitForFunction(()=>document.querySelector('#photo-list')?.children.length===2);
    const detail='На секунду стало слышно, как шины шуршат по мокрой дороге.';
    await p.locator('#memory-detail').fill(detail);
    assert.equal(await p.locator('#proof-quote').innerText(),'«'+detail+'»');
    await p.locator('#song-trim summary').click();
    await p.locator('#trim-length').selectOption('6');
    await p.locator('#trim-start').fill('1');
    await p.locator('#apply-trim').click();
    await p.locator('#audio-list').getByText('Вечерний маршрут · фрагмент').waitFor();
    await p.locator('#prepare').click();
    assert.match(await p.locator('#chosen-quote').innerText(),/шины шуршат/);
    await p.locator('[data-pace="late"]').click();
    assert.equal(await p.locator('[data-pace="late"]').getAttribute('aria-pressed'),'true');
    const chosenPause=Number(await p.locator('#quote-cue').inputValue());
    await p.locator('[data-montage="cover"]').click();
    assert.equal(await p.locator('#recipe-detail').isHidden(),true);
    await p.locator('[data-montage="quiet"]').click();
    assert.equal(await p.locator('[data-montage="quiet"]').getAttribute('aria-pressed'),'true');
    await p.locator('[data-montage="detail"]').click();
    assert.match(await p.locator('#recipe-detail').innerText(),/Снимок 2/);
    const stage=p.locator('.stage');
    assert.equal(await stage.getAttribute('data-detail'),'');
    const second=await stage.locator('img').getAttribute('src');
    await p.getByRole('button',{name:/^Второй взгляд/}).click();
    assert.notEqual(await stage.locator('img').getAttribute('src'),second);
    const ambience=p.locator('#compare-ambience');
    await ambience.click();
    assert.equal(await ambience.getAttribute('aria-pressed'),'false');
    assert.equal(await p.locator('.ambience-toggle').getAttribute('aria-pressed'),'false');
    await p.locator('#entry-title').fill('Шорох шин');
    await p.locator('#save').click();
    await p.waitForURL('**#day/*');
    await p.reload();
    await p.getByRole('button',{name:/^За кадром/}).click();
    assert.equal(await stage.getAttribute('data-detail'),'');
    assert.ok(Math.abs(Number(await p.locator('.meter').inputValue())-chosenPause)<0.02);
    await p.getByRole('button',{name:/^Послушать «/}).first().click();
    await p.waitForFunction(()=>document.querySelector('.sample-audio').currentTime>0.12);
    assert.equal(await stage.getAttribute('data-phase'),'1');
    await p.getByRole('button',{name:/^Послушать «/}).first().click();
    await p.locator('.day-management summary').click();
    const sounds=await p.locator('.day-sounds [data-listen]').evaluateAll(elements=>
      elements.map(({dataset})=>({id:dataset.listen,gain:Number(dataset.gain)})));
    assert.ok(sounds.length);
    const [zip]=await Promise.all([p.waitForEvent('download'),p.locator('#export-folder').click()]);
    assert.match(zip.suggestedFilename(),/шорох-шин\.zip$/u);
    const files=storedZipFiles(await fs.readFile(await zip.path()));
    const soundPaths=sounds.map(({id})=>'ambience/'+id+'.mp3');
    assert.deepEqual([...files.keys()].sort(),['photo-1.jpg','photo-2.jpg','song.wav','day.txt','day.json',...soundPaths].sort());
    for(const name of soundPaths)assert.ok(files.get(name).length>0,name);
    assert.match(files.get('day.txt').toString('utf8'),/встроенные звуки/);
    const copy=JSON.parse(files.get('day.json'));
    assert.deepEqual(copy.ambience,sounds);

    const guest=await browser.newContext({baseURL:base,reducedMotion:'reduce'});
    const restored=await guest.newPage();
    restored.on('pageerror',error=>errors.push(error.message));
    await restored.goto('/journal.html?mode=guest#archive');
    await restored.locator('#day-file').setInputFiles({name:'day.json',mimeType:'application/json',buffer:files.get('day.json')});
    await restored.waitForURL('**#day/*');
    await restored.getByRole('heading',{name:'Шорох шин',exact:true}).waitFor();
    await restored.getByRole('button',{name:/^За кадром/}).click();
    await restored.locator('.stage[data-detail]').waitFor();
    await restored.locator('.day-management summary').click();
    const [recovered]=await Promise.all([restored.waitForEvent('download'),restored.locator('#export-day').click()]);
    assert.deepEqual(JSON.parse(await fs.readFile(await recovered.path())),copy);

    const missingSound='**/media/'+soundPaths[0];
    await p.route(missingSound,route=>route.fulfill({status:404}));
    const [partial]=await Promise.all([p.waitForEvent('download'),p.locator('#export-folder').click()]);
    const partialFiles=storedZipFiles(await fs.readFile(await partial.path()));
    assert.equal(partialFiles.has(soundPaths[0]),false);
    assert.match(partialFiles.get('day.txt').toString('utf8'),/файл недоступен при скачивании/);
    assert.deepEqual(JSON.parse(partialFiles.get('day.json')),copy);
    await p.getByRole('status').filter({hasText:'Часть файлов звуков места недоступна'}).waitFor();
    await p.unroute(missingSound);

    await p.locator('#share-day').click();
    await p.locator('.share-state').filter({hasText:'полный рассказ'}).waitFor();
    await p.locator('[data-create]').click();
    await p.locator('.share-url').waitFor();
    const url=await p.locator('.share-url').inputValue();
    const shared=await guest.newPage();
    assert.equal((await shared.goto(url)).status(),200);
    await shared.getByRole('button',{name:/^За кадром/}).click();
    await shared.locator('.stage[data-detail]').waitFor();
    await shared.locator('.day-sounds [data-listen]').first().click();
    await shared.waitForFunction(()=>document.querySelector('.sample-audio').currentTime>0.1);
    await p.locator('[data-revoke]').click();
    await p.locator('[data-create]').waitFor();
    assert.equal((await guest.request.get(url)).status(),404);
    assert.deepEqual(errors,[]);
    console.log('Passed: hero playback, exact phrase, trim, second look, ambience A/B, ZIP, Go persistence, public scene and revocation.');
  }finally{await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
