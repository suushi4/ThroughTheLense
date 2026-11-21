// End-to-end against the Go build, with a fresh test database.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');

const base=process.env.TTL_TEST_URL || 'http://127.0.0.1:8080';

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
    await p.locator('#song-trim summary').click();
    await p.locator('#trim-length').selectOption('6');
    await p.locator('#trim-start').fill('1');
    await p.locator('#apply-trim').click();
    await p.locator('#audio-list').getByText('Вечерний маршрут · фрагмент').waitFor();
    await p.locator('#prepare').click();
    assert.match(await p.locator('#chosen-quote').innerText(),/шины шуршат/);
    await p.locator('#scene-montage').selectOption('');
    await p.locator('#scene-montage').selectOption('1');
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
    await p.locator('.day-management summary').click();
    const [zip]=await Promise.all([p.waitForEvent('download'),p.locator('#export-folder').click()]);
    assert.match(zip.suggestedFilename(),/шорох-шин\.zip$/u);
    const bytes=await fs.readFile(await zip.path());
    assert.equal(bytes.readUInt32LE(0),0x04034b50);
    assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);
    assert.equal(bytes.readUInt16LE(bytes.length-12),5);
    for(const name of ['photo-1.jpg','photo-2.jpg','song.wav','day.txt','day.json']){
      assert.ok(bytes.includes(Buffer.from(name)),name);
    }

    await p.locator('#share-day').click();
    await p.locator('.share-state').filter({hasText:'полный рассказ'}).waitFor();
    await p.locator('[data-create]').click();
    await p.locator('.share-url').waitFor();
    const url=await p.locator('.share-url').inputValue();
    const guest=await browser.newContext();
    const shared=await guest.newPage();
    assert.equal((await shared.goto(url)).status(),200);
    await shared.getByRole('button',{name:/^За кадром/}).click();
    await shared.locator('.stage[data-detail]').waitFor();
    await p.locator('[data-revoke]').click();
    await p.locator('[data-create]').waitFor();
    assert.equal((await guest.request.get(url)).status(),404);
    assert.deepEqual(errors,[]);
    console.log('Passed: hero playback, exact phrase, trim, second look, ambience A/B, ZIP, Go persistence, public scene and revocation.');
  }finally{await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
