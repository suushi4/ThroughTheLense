import {account, login, logout, currentUser, profileSupported, saveProfile, changePassword} from './account.mjs';
import {avatarPresets, avatarHTML, displayName} from './avatar.mjs';
import {escapeHTML as h, dateLabel} from './ui.mjs';
import {recordedDates, daysLabel} from './diary-stats.mjs';
import {connectDiary,listDays} from './diary.mjs';

const form = document.querySelector('#credentials');
const heading = document.querySelector('#account-heading');
const intro = document.querySelector('#account-intro');
const status = document.querySelector('#auth-status');
const password = document.querySelector('#password');
const passwordHint = document.querySelector('#password-hint');
const retry = document.querySelector('#auth-retry');
const switchMode = document.querySelector('#auth-mode');
const submit = document.querySelector('#auth-submit');
const profile = document.querySelector('#signed-in');
const signOut = document.querySelector('#sign-out');
const drawerLink = document.querySelector('.guest-link');
const terms = document.querySelector('#accept-terms');
let register = false;

function message(text, error = false) {
  status.textContent = text;
  status.toggleAttribute('data-error', error);
}

function renderForm() {
  heading.textContent = register ? 'Создать аккаунт' : 'Войти в дневник';
  intro.textContent = register ? 'Заведите аккаунт, чтобы сохранять свои дни.' : 'Ваши дни доступны в вашем аккаунте.';
  intro.hidden = false;
  switchMode.textContent = register ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт';
  submit.textContent = register ? 'Создать аккаунт' : 'Войти';
  password.autocomplete = register ? 'new-password' : 'current-password';
  password.minLength = register ? 8 : 1;
  passwordHint.hidden = !register;
  document.querySelector('#registration-terms').hidden = !register;
  terms.required = register;
  terms.checked = false;
  document.querySelector('.profile-stats').hidden = true;
  document.querySelector('#account-days').textContent = '';
  if (register) password.setAttribute('aria-describedby', passwordHint.id);
  else password.removeAttribute('aria-describedby');
  form.hidden = false;
  profile.hidden = true;
  profileUser = null;
  profileForm.hidden = passwordBox.hidden = true;
  passwordBox.querySelector('form')?.remove();
  drawerLink.hidden = false;
  message('');
}

const profileForm = document.querySelector('#profile-form');
const passwordBox = document.querySelector('#password-box');
let profileUser = null;


async function showDiaryStats(user) {
  try {
    if (!(await connectDiary())) return;
    const days = await listDays();
    if (profileUser?.id !== user.id) return;
    document.querySelector('#account-days').textContent = daysLabel(days.length) + ' в дневнике';
    const dates = recordedDates(days);
    document.querySelector('#profile-first-day').textContent = dates.length ? dateLabel(dates[0]) : 'Пока нет';
    document.querySelector('#profile-last-day').textContent = dates.length ? dateLabel(dates.at(-1)) : 'Пока нет';
    document.querySelector('.profile-stats').hidden = false;
  } catch {
    if (profileUser?.id === user.id) document.querySelector('#account-days').textContent = 'Статистика пока недоступна.';
  }
}

function drawIdentity(user) {
  document.querySelector('#profile-avatar').innerHTML = avatarHTML(user, 64);
  document.querySelector('#profile-title').textContent = displayName(user);
}

async function showProfileTools(user) {
  const supported = await profileSupported();
  showDiaryStats(user);
  if (!supported || profileUser !== user) return;
  document.querySelector('#profile-name').value = user.name || '';
  const options = [{id: '', label: 'Буква на цвете'}, ...avatarPresets];
  document.querySelector('#avatar-options').innerHTML = options.map(option =>
    `<label class="avatar-option" title="${h(option.label)}"><input type="radio" name="avatar" value="${option.id}"${(user.avatar || '') === option.id ? ' checked' : ''} aria-label="${h(option.label)}">${avatarHTML({...user, avatar: option.id}, 44)}</label>`).join('');
  mountPasswordForm();
  profileForm.hidden = passwordBox.hidden = false;
}

profileForm.onsubmit = async event => {
  event.preventDefault();
  const save = document.querySelector('#profile-save');
  save.disabled = true;
  message('Сохраняем профиль…');
  try {
    const user = await saveProfile({
      name: document.querySelector('#profile-name').value,
      avatar: profileForm.querySelector('input[name="avatar"]:checked')?.value ?? ''
    });
    profileUser = {...profileUser, ...user};
    drawIdentity(profileUser);
    document.querySelector('#profile-name').value = user.name || '';
    message('Профиль сохранён.');
  } catch (error) { message(error.message, true); }
  finally { save.disabled = false; }
};

// The password form exists only while a signed-in user sees the profile,
// so the sign-in form stays the only «Пароль» field on the page.
function mountPasswordForm() {
  if (passwordBox.querySelector('form')) return;
  passwordBox.append(document.querySelector('#password-template').content.cloneNode(true));
  passwordBox.querySelector('form').onsubmit = submitPassword;
}

const submitPassword = async event => {
  const passwordForm = event.currentTarget;
  event.preventDefault();
  const save = document.querySelector('#password-save');
  save.disabled = true;
  message('Меняем пароль…');
  try {
    await changePassword(document.querySelector('#password-current').value, document.querySelector('#password-new').value);
    passwordForm.reset();
    passwordBox.open = false;
    message('Пароль изменён. На других устройствах нужно войти заново.');
  } catch (error) { message(error.message, true); }
  finally { save.disabled = false; }
};

function renderProfile(user) {
  heading.textContent = 'Ваш дневник';
  intro.textContent = 'Приватные дни доступны в этом аккаунте.';
  intro.hidden = false;
  profileUser = user;
  drawIdentity(user);
  showProfileTools(user);
  profile.querySelector('.account-email').textContent = user.email;
  profile.hidden = false;
  form.hidden = true;
  drawerLink.hidden = true;
  message('');
}

function showUnavailable(text, error = false) {
  intro.hidden = true;
  drawerLink.hidden = false;
  retry.hidden = false;
  message(text, error);
}

retry.onclick = () => location.reload();
switchMode.onclick = () => { register = !register; renderForm(); };
form.onsubmit = async event => {
  event.preventDefault();
  submit.disabled = switchMode.disabled = true;
  message(register ? 'Создаём аккаунт…' : 'Входим…');
  try {
    const user = await login(document.querySelector('#email').value, password.value, register);
    if (user) {
      password.value = '';
      renderProfile(user);
      heading.focus();
    } else {
      password.value = '';
      message('Проверьте почту и подтвердите адрес. Затем войдите в дневник.');
    }
  } catch (error) {
    message(error.message, true);
  } finally {
    submit.disabled = switchMode.disabled = false;
  }
};
signOut.onclick = async () => {
  signOut.disabled = true;
  try {
    await logout();
    register = false;
    renderForm();
    heading.focus();
  } catch (error) { message(error.message, true); }
  finally { signOut.disabled = false; }
};
try {
  if (!(await account()).available) {
    showUnavailable('Вход пока недоступен. Можно открыть гостевой дневник.');
  } else {
    const user = await currentUser();
    if (user) renderProfile(user);
    else renderForm();
  }
} catch { showUnavailable('Не удалось загрузить вход. Попробуйте ещё раз.', true); }
