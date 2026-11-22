const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {chromium} = require('playwright');

const base = process.env.TTL_TEST_URL || 'http://127.0.0.1:8000';
const password = 'ThroughThe-Lense-26';
const expectedDay = 'Моя проверочная запись';
const address = () => 'ttl-' + randomUUID() + '@example.org';
const sceneLightPath = '/assets/scene-effects.mjs';

async function run() {
  const browser = await chromium.launch({args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  const errors = [];
  const context = async options => {
    const session = await browser.newContext({baseURL:base,reducedMotion:'reduce',...options});
    session.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    return session;
  };
  const snap = (page, name) => process.env.TTL_EVIDENCE &&
    page.screenshot({path:path.join(process.env.TTL_EVIDENCE,name)});
  const settings = {headers:{'X-Diary-Request':'1'}};

  try {
    const desktop = await context({viewport:{width:1440,height:900}});
    const page = await desktop.newPage();
    const analytics = [];
    let requestedLight = false;
    page.on('request', request => {
      const {pathname} = new URL(request.url());
      if (pathname === '/api/analytics') analytics.push(request);
      if (pathname === sceneLightPath) requestedLight = true;
    });
    await page.goto('/');
    await page.getByRole('heading',{name:'Сохраните, как ощущался день'}).waitFor();
    await page.locator('#home-player .stage img').evaluate(image => image.decode());
    await page.getByRole('button',{name:'Отклонить'}).click();
    assert.equal(analytics.length,0);
    await snap(page,'ThroughTheLense-home.png');
    assert.equal(await page.locator('.hero .solid').count(),1);
    assert.equal(await page.locator('#home-player .stage').isVisible(),true);
    const audioRange = await desktop.request.get('/media/street.wav',{headers:{Range:'bytes=0-43'}});
    assert.equal(audioRange.status(),206);
    assert.match(audioRange.headers()['content-range'],/^bytes 0-43\/\d+$/);
    assert.equal((await audioRange.body()).length,44);
    assert.equal((await desktop.request.get('/media/street.wav',{headers:{Range:'bytes=9999999-'}})).status(),416);
    await page.route('**/media/street.wav',async route=>{
      await new Promise(resolve=>setTimeout(resolve,500));
      await route.continue();
    });
    const mainPlayer = page.locator('#home-player');
    await mainPlayer.getByRole('button',{name:/^За кадром/}).click();
    await mainPlayer.getByRole('button',{name:'Воспроизвести',exact:true}).click();
    await mainPlayer.locator('.playbutton[aria-busy="true"]').waitFor();
    await mainPlayer.getByRole('button',{name:'Пауза',exact:true}).waitFor();
    await page.waitForSelector('#home-player .stage[data-phase="1"] .reveal');
    await mainPlayer.getByRole('button',{name:'Пауза',exact:true}).click();
    await mainPlayer.getByRole('button',{name:'Воспроизвести',exact:true}).waitFor();
    assert.equal(await page.locator('#home-player .stage').getAttribute('data-phase'),'1');
    assert.ok(Number(await page.locator('#home-player .meter').inputValue())>=2.7);
    assert.equal(requestedLight,false,'Reduced motion should not download scene effects');
    await snap(page,'ThroughTheLense-story.png');
    await mainPlayer.getByRole('button',{name:/^Второй взгляд/}).click();
    await page.waitForSelector('#home-player .stage[data-phase="2"]');
    await page.getByRole('button',{name:'Какао у остановки',exact:true}).click();
    await page.getByRole('heading',{name:'Какао у остановки'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Какао у остановки',exact:true}).getAttribute('aria-pressed'),'true');
    await page.locator('.print-window img[src$="cocoa-preview.webp"]').waitFor();
    assert.equal(await page.locator('.print-window img').count(),1);
    assert.equal(await page.locator('.print-title').innerText(),'Какао у остановки');
    await page.locator('.example-link').click();
    await page.locator('.stage img').waitFor();
    assert.match(page.url(),/journal\.html#day\/demo-cocoa$/);

    await page.goto('/');
    const chapters = page.getByRole('navigation',{name:'Главы сайта'});
    await chapters.getByRole('link',{name:'Музыка'}).click();
    const lab = page.locator('#home-lab');
    await lab.getByRole('radio',{name:/Два стаканчика/}).check();
    await lab.getByRole('button',{name:/^За кадром.*4,6/}).click();
    await lab.locator('.stage[data-phase="1"]').waitFor();
    assert.match(await lab.locator('blockquote').first().textContent(),/без спешки/);
    await chapters.getByRole('link',{name:'Мои дни'}).click();
    await page.getByRole('link',{name:'Записать первый день'}).waitFor();
    await page.getByRole('link',{name:'Как сохранить копию дня'}).click();
    assert.equal(await page.locator('#day-copy').getAttribute('open'),'');
    await chapters.getByRole('link',{name:'Сцена',exact:true}).click();
    await page.getByRole('button',{name:'Выбрать сцену «Свет после репетиции»'}).click();
    await page.locator('#use-example').click();
    assert.match(page.url(),/\?example=demo-stage#new$/);
    await page.locator('#fill-demo').click();
    await page.waitForFunction(()=>document.querySelector('#story')?.value.includes('один стул'));
    await page.goto('/privacy.html');
    await page.getByRole('button',{name:'Настройки аналитики'}).click();
    await page.getByRole('button',{name:'Разрешить'}).click();
    await page.getByText('Аналитика разрешена.').waitFor();
    assert.equal(analytics.length,0);
    const visit = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/analytics');
    await page.goto('/');
    assert.equal((await visit).status(),200);
    assert.deepEqual(analytics[0].postDataJSON(),{event:'home_view'});
    await page.getByRole('button',{name:'Настройки аналитики'}).click();
    await page.getByRole('button',{name:'Отклонить'}).click();
    await page.reload({waitUntil:'networkidle'});
    assert.equal(analytics.length,1);
    const broken = await page.goto('/missing-check-page');
    assert.equal(broken.status(),404);
    await page.getByRole('heading',{name:'Страница не найдена'}).waitFor();
    assert.equal((await desktop.request.get('/terms.html')).status(),200);
    assert.match(await (await desktop.request.get('/robots.txt')).text(),/Sitemap:/);
    const sitemap = await (await desktop.request.get('/sitemap.xml')).text();
    assert.ok(sitemap.includes(base+'/privacy.html'));
    assert.ok(!sitemap.includes('journal.html'));
    await page.goto('/#archive');
    await page.waitForURL('**/journal.html#archive');
    await page.locator('.day-card').first().waitFor();
    for (const width of [320,360,390,768]) {
      const mobile = await context({viewport:{width,height:844},isMobile:width<768});
      const phone = await mobile.newPage();
      await phone.goto('/');
      await phone.locator('#home-player .stage img').evaluate(image => image.decode());
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth),width);
      await phone.getByRole('button',{name:'Отклонить'}).click();
      await phone.evaluate(() => scrollTo(0,0));
      if (width===390) await snap(phone,'ThroughTheLense-mobile.png');
      await phone.goto('/journal.html#archive');
      await phone.locator('.day-card').first().waitFor();
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth),width);
      await mobile.close();
    }

    await page.goto('/account.html');
    await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
    const email=address();
    await page.getByLabel('Электронная почта').fill(email);
    await page.getByLabel('Пароль').fill(password);
    await page.getByLabel('Принимаю условия использования').check();
    await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
    await page.locator('#account-agreements').waitFor();
    assert.equal(new URL(page.url()).pathname, '/account.html');
    await page.goto('/journal.html#archive');
    await page.getByRole('link',{name:'Ваш аккаунт'}).waitFor();
    assert.match(await page.locator('#storage-note').innerText(),/вашем аккаунте/);

    await page.goto('/journal.html?example=demo-street#new');
    await page.locator('#fill-demo').click();
    await page.waitForFunction(() => document.querySelector('#photo-list')?.children.length === 2);
    await page.locator('#prepare').click();
    await page.locator('#save').waitFor();
    await page.locator('#entry-title').fill(expectedDay);
    await page.locator('#save').click();
    await page.waitForURL('**#day/*');
    const dayId = page.url().split('#day/')[1];
    await page.locator('.stage').waitFor();
    assert.equal((await desktop.request.get('/api/days/'+dayId)).status(),200);

    await page.goto('/account.html');
    await page.getByRole('button',{name:'Выйти из аккаунта'}).click();
    await page.getByRole('heading',{name:'Войти в дневник'}).waitFor();
    assert.equal((await desktop.request.get('/api/days/'+dayId)).status(),401);

    const other=await context();
    const create=await other.request.post('/api/register',{...settings,data:{email:address(),password}});
    assert.equal(create.status(),200);
    assert.equal((await other.request.get('/api/days/'+dayId)).status(),404);
    assert.deepEqual((await (await other.request.get('/api/days')).json()).days,[]);
    assert.equal((await other.request.delete('/api/days/'+dayId)).status(),403);
    assert.equal((await other.request.delete('/api/days/'+dayId,settings)).status(),200);

    const fresh=await context();
    const freshPage=await fresh.newPage();
    await freshPage.goto('/account.html');
    await freshPage.getByLabel('Электронная почта').fill(email);
    await freshPage.getByLabel('Пароль').fill('incorrect password');
    await freshPage.getByRole('button',{name:'Войти',exact:true}).click();
    await freshPage.getByText('Неверная почта или пароль.').waitFor();
    await freshPage.getByLabel('Пароль').fill(password);
    await freshPage.getByRole('button',{name:'Войти',exact:true}).click();
    await freshPage.locator('#account-agreements').waitFor();
    assert.equal(new URL(freshPage.url()).pathname, '/account.html');
    await freshPage.getByRole('link',{name:'Открыть кабинет'}).click();
    await freshPage.locator('#personal-shelf .home-shelf-day').filter({hasText:expectedDay}).click();
    await freshPage.locator('.stage img').waitFor();
    await freshPage.getByRole('button',{name:/^За кадром/}).click();
    await freshPage.locator('.stage[data-phase="1"] .reveal').waitFor();
    await snap(freshPage,'ThroughTheLense-journal.png');
    let rateLimited;
    for (let attempt=0;attempt<9;attempt++) {
      rateLimited=await other.request.post('/api/login',{...settings,data:{email,password:'invalid password'}});
      if (rateLimited.status()===429) break;
    }
    assert.equal(rateLimited.status(),429);
    assert.equal(rateLimited.headers()['retry-after'],'60');

    if ((await desktop.request.head(sceneLightPath)).ok()) {
      const visual = await context({reducedMotion:'no-preference',viewport:{width:1440,height:900}});
      const scene = await visual.newPage();
      let requests = 0;
      scene.on('request', request => { if (new URL(request.url()).pathname === sceneLightPath) requests++; });
      await scene.goto('/');
      await scene.locator('#home-player .stage img').evaluate(image => image.decode());
      assert.equal(requests,0,'Scene effects should not load before the quote');
      const ambient = scene.locator('.atmosphere');
      const snapshot = () => ambient.evaluate(canvas => canvas.toDataURL());
      const initialFrame = await snapshot();
      await scene.waitForFunction(previous => document.querySelector('.atmosphere').toDataURL() !== previous, initialFrame);
      const contact = scene.locator('.contact-print');
      const stationary = await contact.boundingBox();
      const stageChoice = scene.getByRole('button',{name:'Свет после репетиции',exact:true});
      await stageChoice.focus();
      await scene.keyboard.press('Enter');
      await scene.locator('.print-window img[src$="stage-preview.webp"]').waitFor();
      assert.equal(await stageChoice.evaluate(button=>button===document.activeElement),true);
      await scene.waitForFunction(() => document.querySelector('.print-title').textContent === 'Свет после репетиции' &&
        document.querySelector('.print-window').children.length === 1);
      assert.deepEqual(await contact.boundingBox(),stationary);
      const pause = scene.getByRole('button',{name:'Пауза анимации фона'});
      await pause.click();
      assert.equal(await pause.getAttribute('aria-pressed'),'true');
      const pausedFrame = await snapshot();
      await pause.click();
      await scene.waitForFunction(previous => document.querySelector('.atmosphere').toDataURL() !== previous, pausedFrame);
      const webgl = await scene.evaluate(() => Boolean(document.createElement('canvas')
        .getContext('webgl2',{failIfMajorPerformanceCaveat:true})));
      await scene.getByRole('button',{name:/^За кадром/}).click();
      await scene.locator('#examples[data-phase="1"]').waitFor();
      if (webgl) {
        await scene.locator('.scene-effects[data-ready] canvas').waitFor({state:'attached'});
        assert.equal(requests,1);
        await scene.emulateMedia({reducedMotion:'reduce'});
        await scene.locator('.scene-effects:not([data-ready])').waitFor({state:'attached'});
      } else assert.equal(requests,0);
      await scene.emulateMedia({reducedMotion:'no-preference'});
      await scene.reload();
      const entrance=await scene.locator('#experiment .chapter-heading').evaluate(async heading=>{
        const started=new Promise(resolve=>heading.addEventListener('animationstart',()=>{
          const style=getComputedStyle(heading);
          resolve({delay:style.animationDelay,duration:style.animationDuration,
            opacity:Number(style.opacity),rise:new DOMMatrixReadOnly(style.transform).m42});
        },{once:true}));
        const edge=window.innerHeight*.9-12;
        scrollTo({top:scrollY+heading.getBoundingClientRect().top-edge,behavior:'instant'});
        return Promise.race([started,new Promise(resolve=>setTimeout(()=>resolve(null),1000))]);
      });
      assert.ok(entrance && entrance.opacity<1,'Text should animate upon entering the viewport');
      assert.equal(entrance.delay,'0s');
      assert.ok(entrance.rise>10,'The chapter should visibly rise into place');
      assert.ok(parseFloat(entrance.duration)<=.55,'Entrance should finish promptly');
      await scene.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#experiment .chapter-heading')).opacity)===1);
      const positions=await scene.locator('#story-title').evaluate(async title=>{
        const heading=title.parentElement;
        const chapter=heading.closest('section');
        heading.scrollIntoView({behavior:'instant',block:'center'});
        const samples=[];
        for(let i=0;i<8;i++){
          await new Promise(requestAnimationFrame);
          samples.push({
            opacity:Number(getComputedStyle(heading).opacity),
            offset:heading.getBoundingClientRect().top-chapter.getBoundingClientRect().top
          });
        }
        return samples;
      });
      assert.ok(positions.every(sample=>sample.opacity===1 && Math.abs(sample.offset-positions[0].offset)<1),
        'Jumping into a chapter should show the text immediately without moving it');
      await visual.close();
    }
    assert.deepEqual(errors,[]);
    console.log('Passed: real demo player, responsive landing, analytics consent and revocation, sitemap and 404, registration, persistence, account isolation and rate limiting.');
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode=1; });
