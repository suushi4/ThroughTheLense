const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const baseURL = process.env.TTL_TEST_URL || 'http://127.0.0.1:8000';

async function noOverflow(page, label) {
  await page.evaluate(() => document.fonts.ready);
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(widths[0] <= widths[1], label + ': ' + widths.join(' > '));
}

async function run() {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const mobile = width < 500;
      const context = await browser.newContext({baseURL, viewport: {width, height: 900}, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce', timezoneId:'America/Los_Angeles'});
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date('2026-12-01T00:02:00Z'));
      const failures = [];
      page.on('pageerror', error => failures.push(error.message));
      page.on('response', response => {
        if (response.url().startsWith(baseURL + '/media/') && response.status() >= 400) failures.push(response.url());
      });
      await page.goto('/');
      const decline = page.getByRole('button', {name: 'Отклонить', exact: true});
      if (await decline.isVisible()) await decline.click();
      await noOverflow(page, 'home ' + width);
      await page.getByRole('link', {name: 'Посмотреть примеры', exact: true}).click();
      await page.waitForURL('**/gallery.html');
      await page.locator('.gallery-card').last().click();
      assert.equal(await page.locator('.gallery-card[aria-pressed="true"]').count(), 1);
      await noOverflow(page, 'gallery ' + width);
      for (const selector of ['#gallery-play', '#gallery-editor']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box && box.y >= 0 && box.y + box.height <= 900, selector + ' should fit in the first viewport');
      }
      await page.locator('#gallery-play').click();
      await page.getByRole('button', {name: 'Пауза', exact: true}).waitFor();
      await page.getByRole('button', {name: 'Закрыть', exact: true}).click();
      await page.locator('#gallery-editor').click();
      await page.waitForURL('**?example=demo-stage#new');
      await page.locator('#fill-demo').click();
      await page.locator('#photo-list img').first().waitFor();
      await page.getByText('Как подбираются звуки?', {exact: true}).click();
      await page.getByRole('link', {name: 'Как используется фото'}).waitFor();
      await noOverflow(page, 'editor ' + width);
      assert.ok(await page.locator('.track-options').evaluate(panel=>panel.scrollHeight>panel.clientHeight));
      await page.locator('#track-query').fill('колокольчики');
      assert.equal(await page.locator('[data-track]:visible').count(),1);
      await page.locator('[data-track="track-paper-lanterns"]').click();
      await page.locator('[data-track="track-paper-lanterns"][aria-pressed="true"]').waitFor();
      const date=page.locator('#date');
      assert.equal(await date.getAttribute('max'),'2026-11-30');
      await date.fill('2026-12-01');
      await page.locator('#prepare').click();
      await page.locator('#err-date').filter({hasText:'Выберите сегодняшний или прошедший день.'}).waitFor();
      assert.match(page.url(),/#new$/);
      await date.fill('2026-11-08');
      await page.locator('#prepare').click();
      await page.locator('#save').waitFor();
      await noOverflow(page, 'preview ' + width);
      await page.locator('#save').click();
      await page.waitForURL('**#day/*');
      await page.goto('/journal.html?mode=guest#archive');
      await page.getByRole('button', {name: 'Все дни', exact: true}).click();
      await page.getByRole('button', {name: 'Календарь', exact: true}).click();
      const calendar = page.getByRole('region', {name: 'Календарь записей'});
      const stageDay = calendar.getByRole('button', {name: /8 ноября.*Свет после репетиции/});
      await stageDay.click();
      assert.equal(await calendar.locator('.day-card').count(), 2);
      await noOverflow(page, 'calendar ' + width);
      await calendar.locator('.day-card').first().click();
      await page.waitForURL('**#day/*');
      await page.getByRole('link', {name: 'К архиву'}).first().click();
      assert.equal(await stageDay.getAttribute('aria-pressed'), 'true');
      const nextMonth=calendar.getByRole('button', {name: 'Следующий месяц'});
      assert.equal(await nextMonth.isDisabled(),true);
      assert.equal(await calendar.locator('[aria-current="date"]').textContent(),'30');
      await calendar.getByRole('button', {name: 'Предыдущий месяц'}).click();
      await calendar.getByText('В этом месяце записей нет.').waitFor();
      await nextMonth.click();
      assert.equal(await nextMonth.isDisabled(),true);
      await page.getByRole('button', {name: 'Список', exact: true}).click();
      assert.equal(await calendar.count(), 0);
      await page.goto('/privacy.html#account-deletion');
      await page.getByRole('heading', {name: 'Удаление аккаунта', exact: true}).waitFor();
      await noOverflow(page, 'privacy ' + width);
      await page.goto('/terms.html');
      await page.getByRole('heading', {name: 'Публичные ссылки', exact: true}).waitFor();
      await noOverflow(page, 'terms ' + width);
      await page.goto('/account.html');
      await page.locator('#account-heading').waitFor();
      await noOverflow(page, 'account ' + width);
      await page.getByRole('link', {name: 'Помощь',exact:true}).click();
      await page.getByRole('heading', {name: 'Как перенести день'}).waitFor();
      await noOverflow(page, 'help ' + width);
      await page.locator('main a[href="/sounds.html"]').click();
      const sound = page.locator('#place-sounds [data-listen]').first();
      await sound.click();
      await page.locator('#place-sounds [aria-pressed="true"]').waitFor();
      await sound.click();
      assert.equal(await sound.getAttribute('aria-pressed'),'false');
      await noOverflow(page, 'sounds ' + width);
      await page.goto('/cabinet.html');
      await page.locator('#cabinet-guest:not([hidden])').waitFor();
      assert.equal(await page.locator('#personal-shelf .home-shelf-day').count(), 0);
      await noOverflow(page, 'guest cabinet ' + width);
      assert.deepEqual(failures, []);
      console.log('Passed gallery, player, editor, calendar, and public pages at ' + width + 'px');
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
