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
      const context = await browser.newContext({baseURL, viewport: {width, height: 900}, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce'});
      const page = await context.newPage();
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
      await page.getByRole('button', {name: 'Воспроизвести', exact: true}).click();
      await page.getByRole('button', {name: 'Пауза', exact: true}).waitFor();
      await page.locator('#gallery-editor').click();
      await page.waitForURL('**?example=demo-stage#new');
      await page.locator('#fill-demo').click();
      await page.locator('#photo-list img').first().waitFor();
      await page.getByText('Как подбираются звуки?', {exact: true}).click();
      await page.getByRole('link', {name: 'Как используется фото'}).waitFor();
      await noOverflow(page, 'editor ' + width);
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
      await calendar.getByRole('button', {name: 'Следующий месяц'}).click();
      await calendar.getByText('В этом месяце записей нет.').waitFor();
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
      assert.deepEqual(failures, []);
      console.log('Passed gallery, player, editor, calendar, and public pages at ' + width + 'px');
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
