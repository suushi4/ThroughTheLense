// «Звуки места» in the editor, the player, export/import and old copies.
// Run against a local server: TTL_TEST_URL=http://127.0.0.1:8080 npm run test:ambience
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

const base = process.env.TTL_TEST_URL || 'http://127.0.0.1:8000';

async function editor(page) {
  await page.goto('/journal.html?mode=guest#new');
  await page.locator('#fill-demo').click();
  await page.waitForFunction(() => document.querySelector('#photo-list')?.children.length >= 1);
}
const chips = async page => (await page.locator('.ambience-chip').allInnerTexts()).map(text => text.trim());

async function run() {
  const browser = await chromium.launch({args: ['--autoplay-policy=no-user-gesture-required']});
  const errors = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-ambience-'));
  try {
    const context = await browser.newContext({baseURL: base, viewport: {width: 1280, height: 900}, acceptDownloads: true});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const fetched = [];
    page.on('request', request => { if (request.url().includes('/media/ambience/')) fetched.push(path.basename(request.url())); });

    // Without a vision key the words of the entry choose the sounds.
    await editor(page);
    await page.locator('.ambience-chip').first().waitFor();
    assert.deepEqual(await chips(page), ['Улица']);
    assert.match(await page.locator('#ambience-hint').innerText(), /по словам записи — решаете вы/);

    // A person's change sticks: add, set the volume, remove.
    await page.locator('#ambience-add').selectOption('wind');
    await page.locator('#ambience-add').selectOption('rain');
    await page.locator('[data-ambience-remove="street-traffic"]').click();
    await page.locator('#ambience-gain').fill('80');
    await page.locator('#ambience-gain').dispatchEvent('change');
    assert.deepEqual(await chips(page), ['Ветер', 'Дождь']);
    assert.match(await page.locator('#ambience-hint').innerText(), /выбраны вами/);
    await page.locator('#story').fill(await page.locator('#story').inputValue() + ' В кафе было тепло.');
    await page.locator('#story').dispatchEvent('change');
    await page.waitForTimeout(300);
    assert.deepEqual(await chips(page), ['Ветер', 'Дождь'], 'suggestions must not override a choice');

    // Preview plays the bed; it can be switched off.
    await page.locator('#prepare').click();
    await page.locator('#save').waitFor();
    await page.getByRole('button', {name: 'Воспроизвести', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('.ambience-toggle') && !document.querySelector('.ambience-toggle').hidden);
    await page.waitForTimeout(1500);
    assert.deepEqual([...new Set(fetched)].sort(), ['rain.mp3', 'wind.mp3']);
    await page.locator('.ambience-toggle').click();
    assert.equal(await page.locator('.ambience-toggle').getAttribute('aria-pressed'), 'false');

    // Saved day keeps the sounds; export writes them; import restores them.
    await page.locator('#save').click();
    await page.waitForURL('**#day/*');
    await page.reload();
    await page.locator('.ambience-toggle:not([hidden])').waitFor();
    await page.locator('.day-management summary').click();
    const download = page.waitForEvent('download');
    await page.locator('#export-day').click();
    const file = path.join(dir, 'day.json');
    await (await download).saveAs(file);
    const copy = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(copy.version, 1);
    assert.deepEqual(copy.ambience, [{id: 'wind', gain: 0.8}, {id: 'rain', gain: 0.8}]);

    const importCopy = async (name, data) => {
      const target = path.join(dir, name);
      fs.writeFileSync(target, JSON.stringify(data));
      await page.goto('/journal.html?mode=guest#archive');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#import-day').click()]);
      await chooser.setFiles(target);
      await page.waitForURL('**#day/*');
      await page.locator('.stage img').waitFor();
    };
    await importCopy('with-sounds.json', {...copy, ambience: [...copy.ambience, {id: 'unknown-sound', gain: 1}]});
    await page.locator('.ambience-toggle:not([hidden])').waitFor();

    // An older copy without the field opens and plays without a bed.
    const {ambience, ...old} = copy;
    await importCopy('old.json', old);
    assert.equal(await page.locator('.ambience-toggle').isHidden(), true);
    await page.getByRole('button', {name: /^За кадром/}).click();
    await page.locator('.stage[data-phase="1"] .reveal').waitFor();

    // With a vision key the cover decides, and the hint says so.
    const vision = await context.newPage();
    vision.on('pageerror', error => errors.push(error.message));
    let sent = null;
    await vision.route('**/api/runtime', route => route.fulfill({json: {mode: 'local', analytics: 'local', share: true, ambience: 'vision'}}));
    await vision.route('**/api/ambience/suggest', async route => {
      sent = route.request();
      await route.fulfill({json: {tags: [{id: 'wet-asphalt', confidence: 0.92}, {id: 'park-birds', confidence: 0.3}, {id: 'nope', confidence: 1}]}});
    });
    await editor(vision);
    await vision.locator('.ambience-chip').first().waitFor();
    assert.deepEqual(await chips(vision), ['Мокрый асфальт']);
    assert.match(await vision.locator('#ambience-hint').innerText(), /Подобрано по фото — решаете вы/);
    assert.equal(sent.headers()['content-type'], 'image/jpeg');
    assert.equal(sent.headers()['x-diary-request'], '1');
    assert.ok(sent.postDataBuffer().length < 700 * 1024);

    // If the service fails, the words of the entry take over.
    const fallback = await context.newPage();
    fallback.on('pageerror', error => errors.push(error.message));
    await fallback.route('**/api/runtime', route => route.fulfill({json: {mode: 'local', analytics: 'local', ambience: 'vision'}}));
    await fallback.route('**/api/ambience/suggest', route => route.fulfill({status: 503, json: {message: 'Не удалось подобрать звуки по фото.'}}));
    await editor(fallback);
    await fallback.locator('.ambience-chip').first().waitFor();
    assert.deepEqual(await chips(fallback), ['Улица']);
    assert.match(await fallback.locator('#ambience-hint').innerText(), /по словам записи/);

    // Diary tracks: the ten CC0 recordings work like the examples.
    const tracks = await context.newPage();
    tracks.on('pageerror', error => errors.push(error.message));
    await editor(tracks);
    assert.equal(await tracks.locator('[data-track]').count(), 13);
    assert.equal(await tracks.locator('.track-fit:not([hidden])').count(), 1);
    await tracks.locator('[data-track="track-night-talk"]').click();
    await tracks.waitForFunction(() => document.querySelector('#audio-list').innerText.includes('Ночной разговор'));
    await tracks.locator('#prepare').click();
    await tracks.locator('#save').waitFor();
    assert.match(await tracks.locator('.page-heading p').innerText(), /Ночной разговор/);
    await tracks.getByRole('button', {name: 'Воспроизвести', exact: true}).click();
    await tracks.getByRole('button', {name: 'Пауза', exact: true}).waitFor();

    assert.deepEqual(errors, []);
    console.log('Passed: diary tracks, text suggestions, manual choice sticks, player bed and switch, save and reload, export and import, unknown ids dropped, old copies, photo suggestions, service failure fallback.');
  } finally {
    await browser.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
