const preferenceKey = 'ttl-analytics-v1';
let preference;
try { preference = localStorage.getItem(preferenceKey); } catch {}
let started = false;
let trigger;
const home = location.pathname === '/' || location.pathname === '/index.html';
const sharedLink = /^#(?:archive|new|preview|day|edit)(?:\/|$)/.test(location.hash);

const banner = document.createElement('aside');
banner.className = 'consent-banner';
banner.hidden = true;
banner.setAttribute('aria-labelledby','consent-title');
banner.innerHTML = '<h2 id="consent-title">Аналитика сайта</h2><p>Мы считаем посещения главной с вашего согласия. Дневник работает при любом выборе. <a href="/privacy.html#analytics">Подробнее</a></p>'+
  '<div class="consent-actions"><button type="button" data-choice="no">Отклонить</button><button type="button" data-choice="yes">Разрешить</button></div>';
const story = home && document.querySelector('#story');
if (story) {
  banner.classList.add('home-consent');
  story.before(banner);
} else document.body.append(banner);

async function countVisit() {
  if (!home || sharedLink || started || preference !== 'yes') return;
  started = true;
  try {
    const response = await fetch('/api/runtime', {cache:'no-store'});
    if (!response.ok || preference !== 'yes') return;
    const {analytics} = await response.json();
    if (preference !== 'yes') return;
    if (analytics === 'local') {
      await fetch('/api/analytics',{
        method:'POST', keepalive:true, credentials:'omit',
        headers:{'Content-Type':'application/json','X-Diary-Request':'1'},
        body:JSON.stringify({event:'home_view'})
      });
    } else if (analytics === 'vercel' && !location.search) {
      window.va ||= (...args) => (window.vaq ||= []).push(args);
      window.va('beforeSend', event => preference === 'yes' ? {...event,url:location.origin+'/'} : null);
      const script = document.createElement('script');
      script.src = '/_vercel/insights/script.js';
      document.head.append(script);
    }
  } catch { /* Analytics never interrupts the diary. */ }
}

for (const button of document.querySelectorAll('[data-consent-settings]')) {
  button.hidden = false;
  button.addEventListener('click', () => {
    trigger = button;
    banner.hidden = false;
    banner.querySelector('button').focus();
  });
}
const inlineChoices = [...document.querySelectorAll('#account-agreements [data-choice]')];
function showPreference() {
  for (const button of inlineChoices) {
    button.setAttribute('aria-pressed', String(preference === button.dataset.choice));
  }
  const status = document.querySelector('.consent-status');
  if (status) status.textContent = preference === 'yes' ? 'Аналитика разрешена.' :
    preference === 'no' ? 'Аналитика отклонена.' : 'Аналитика выключена, пока вы не разрешите её.';
}
showPreference();
for (const button of [...banner.querySelectorAll('[data-choice]'), ...inlineChoices]) {
  button.addEventListener('click', () => {
    const hadFocus = banner.contains(document.activeElement);
    preference = button.dataset.choice;
    try { localStorage.setItem(preferenceKey, preference); } catch {}
    banner.hidden = true;
    showPreference();
    if (hadFocus) (trigger || document.querySelector('main a, main button'))?.focus({preventScroll:true});
    countVisit();
  });
}

banner.hidden = !home || sharedLink || preference === 'yes' || preference === 'no';
addEventListener('storage', event => {
  if (event.key !== preferenceKey && event.key !== null) return;
  preference = event.newValue;
  if (preference) banner.hidden = true;
  showPreference();
});
countVisit();
