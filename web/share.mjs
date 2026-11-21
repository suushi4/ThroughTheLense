// «Поделиться»: a public read-only link to one account day (Go server only).
import {escapeHTML as h} from './ui.mjs';

async function call(id, method) {
  const response = await fetch('/api/days/' + encodeURIComponent(id) + '/share', {
    method, cache: 'no-store', headers: {'X-Diary-Request': '1'}
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.message || 'Сервис ссылок недоступен.');
  return data;
}

// openShare fills the journal dialog via popup(contents,label) and wires it.
export async function openShare(entry, popup, dialog) {
  popup('<h2>Поделиться днём</h2><p class="share-state" role="status">Проверяем ссылку…</p>' +
    '<div class="share-link" hidden><input class="share-url" type="url" readonly aria-label="Публичная ссылка">' +
    '<div class="dialog-actions"><button class="btn secondary" type="button" data-copy>Скопировать</button>' +
    '<button class="btn quiet-danger" type="button" data-revoke>Отозвать ссылку</button></div></div>' +
    '<div class="dialog-actions" data-create-row hidden><button class="btn primary" type="button" data-create>Создать ссылку</button></div>' +
    '<p class="error" role="alert"></p>', 'Поделиться днём');
  const $ = selector => dialog.querySelector(selector);
  const state = $('.share-state'), box = $('.share-link'), url = $('.share-url'), error = $('.error');
  const createRow = $('[data-create-row]'), create = $('[data-create]'), copy = $('[data-copy]'), revoke = $('[data-revoke]');
  const show = link => {
    error.textContent = '';
    box.hidden = !link.url; createRow.hidden = Boolean(link.url);
    if (link.url) url.value = link.url;
    state.innerHTML = link.url
      ? 'По этой ссылке день «' + h(entry.title) + '» откроется у любого, кто её получит. Остальные дни и ваша почта не видны.'
      : 'Ссылки пока нет. Сцену дня увидит любой, у кого будет ссылка, пока вы её не отзовёте.';
  };
  const busy = async (button, action) => {
    button.disabled = true; error.textContent = '';
    try { show(await action()); }
    catch (failure) { if (dialog.contains(button)) error.textContent = failure.message; }
    finally { button.disabled = false; }
  };
  create.onclick = () => busy(create, () => call(entry.id, 'POST'));
  revoke.onclick = () => busy(revoke, async () => { await call(entry.id, 'DELETE'); return {url: null}; });
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(url.value); copy.textContent = 'Скопировано'; }
    catch { url.select(); copy.textContent = 'Выделено, скопируйте вручную'; }
    setTimeout(() => { if (copy.isConnected) copy.textContent = 'Скопировать'; }, 2500);
  };
  try { show(await call(entry.id, 'GET')); }
  catch (failure) { state.textContent = ''; error.textContent = failure.message; }
}
