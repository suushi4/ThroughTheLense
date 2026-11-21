// Account state across pages, the home shelf, the journal account menu and
// the diary track hint. Run against a local server with a throwaway
// database: TTL_TEST_URL=http://127.0.0.1:8080 npm run test:account
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {chromium} = require('playwright');

const base = process.env.TTL_TEST_URL || 'http://127.0.0.1:8000';
const password = 'ThroughThe-Lense-26';

async function accountLinks(page) {
  const texts = {};
  for (const path of ['/', '/privacy.html', '/terms.html', '/missing-page']) {
    await page.goto(path);
    const link = page.locator('[data-account-link]');
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.waitForTimeout(300);
    texts[path] = (await link.innerText()).trim();
  }
  return texts;
}

async function run() {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const context = await browser.newContext({baseURL: base, viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
    await context.addInitScript(() => localStorage.setItem('ttl-consent', 'denied'));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));

    // Visitors see «Войти» everywhere and a guest shelf.
    for (const [path, text] of Object.entries(await accountLinks(page))) assert.equal(text, 'Войти', path);
    await page.goto('/');
    await page.locator('#collection').scrollIntoViewIfNeeded();
    await page.getByRole('heading', {name: 'Гостевой архив'}).waitFor();

    // Register.
    const email = 'state-' + randomUUID() + '@example.org';
    await page.goto('/account.html');
    await page.getByRole('button', {name: 'Создать аккаунт', exact: true}).click();
    await page.getByLabel('Электронная почта').fill(email);
    await page.getByLabel('Пароль').fill(password);
    await page.getByRole('button', {name: 'Создать аккаунт', exact: true}).click();
    await page.waitForURL('**/journal.html#archive');

    // Signed in: «Мой аккаунт» on every page.
    for (const [path, text] of Object.entries(await accountLinks(page))) assert.equal(text, 'Мой аккаунт', path);

    // The account page never shows the sign-in heading to a signed-in user.
    await page.goto('/account.html', {waitUntil: 'commit'});
    const headings = new Set();
    for (const started = Date.now(); Date.now() - started < 5000;) {
      const heading = await page.locator('h1').first().innerText().catch(() => '');
      headings.add(heading);
      if (heading === 'Ваш дневник') break;
      await page.waitForTimeout(25);
    }
    assert.ok(headings.has('Ваш дневник'), [...headings].join(', '));
    assert.ok(![...headings].some(h => /Войти/.test(h)), 'sign-in heading flashed: ' + [...headings].join(', '));
    assert.equal(await page.locator('.guest-link').isVisible(), false);

    // Track hint: the cover suggests a diary track, but nothing is chosen.
    await page.goto('/journal.html#new');
    await page.locator('#fill-demo').click();
    await page.waitForFunction(() => document.querySelector('#photo-list')?.children.length === 2);
    await page.locator('#remove-song').click();
    await page.locator('.track-fit:not([hidden])').waitFor();
    assert.equal(await page.locator('.track-fit:not([hidden])').count(), 1);
    assert.equal(await page.locator('[data-track="demo-street"] .track-fit').isVisible(), true);
    assert.equal(await page.locator('[data-track][aria-pressed="true"]').count(), 0);
    assert.match(await page.locator('#track-hint').innerText(), /Выбор за вами/);
    await page.locator('[data-track="demo-cocoa"]').click();
    await page.waitForFunction(() => document.querySelector('#audio-list').innerText.includes('Два стаканчика'));
    assert.equal(await page.locator('[data-track="demo-cocoa"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-track="demo-street"]').getAttribute('aria-pressed'), 'false');

    // Save the day into the account.
    await page.locator('#prepare').click();
    await page.locator('#save').waitFor();
    await page.locator('#entry-title').fill('День для полки');
    await page.locator('#save').click();
    await page.waitForURL('**#day/*');

    // Journal header: initial letter and a menu with «Выйти».
    const icon = page.locator('#journal-account');
    await page.waitForFunction(() => document.querySelector('#journal-account').classList.contains('signed-in'));
    assert.equal((await icon.innerText()).trim(), 'S');
    assert.match(await icon.getAttribute('aria-label'), new RegExp(email.replace(/[.+-]/g, '\\$&')));

    // Home shelf shows the account archive and links into it.
    await page.goto('/');
    await page.locator('#collection').scrollIntoViewIfNeeded();
    await page.getByRole('heading', {name: 'Ваш архив'}).waitFor();
    const shelfDay = page.locator('.home-shelf-day').filter({hasText: 'День для полки'});
    await shelfDay.waitFor();
    assert.doesNotMatch(await shelfDay.getAttribute('href'), /mode=guest/);
    for (const href of await page.locator('.home-shelf a').evaluateAll(links => links.map(a => a.getAttribute('href'))))
      assert.doesNotMatch(href, /mode=guest/);

    // Signed-in header fits narrow phones.
    for (const width of [320, 360]) {
      const phone = await browser.newContext({baseURL: base, viewport: {width, height: 800}, isMobile: true,
        storageState: await context.storageState()});
      const narrow = await phone.newPage();
      await narrow.goto('/');
      await narrow.waitForFunction(() => document.querySelector('[data-account-link]')?.hasAttribute('data-signed-in'));
      assert.equal((await narrow.locator('[data-account-link]').innerText()).trim(), 'Аккаунт');
      assert.equal(await narrow.evaluate(() => document.documentElement.scrollWidth), width);
      await phone.close();
    }

    // Sign out from the journal menu.
    await page.goto('/journal.html#archive');
    await page.waitForFunction(() => document.querySelector('#journal-account').classList.contains('signed-in'));
    await icon.click();
    await page.locator('#dialog').getByText(email).waitFor();
    await page.locator('#dialog').getByRole('button', {name: 'Выйти'}).click();
    await page.waitForURL('**/account.html');
    await page.getByRole('heading', {name: 'Войти в дневник'}).waitFor();
    assert.equal((await page.request.get('/api/session')).ok(), true);
    assert.equal((await (await page.request.get('/api/session')).json()).user, null);
    for (const [path, text] of Object.entries(await accountLinks(page))) assert.equal(text, 'Войти', path);

    assert.deepEqual(errors, []);
    console.log('Passed: account state on every page, no sign-in flash, journal menu and sign-out, account shelf, track hint without auto-choice, narrow phones.');
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
