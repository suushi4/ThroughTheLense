import {account, login, logout, currentUser} from './account.mjs';

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
const goToJournal = '/journal.html#archive';
let register = false;

function message(text, error = false) {
  status.textContent = text;
  status.toggleAttribute('data-error', error);
}

function renderForm() {
  heading.textContent = register ? 'Создать аккаунт' : 'Войти в дневник';
  intro.textContent = register ? 'Заведите аккаунт, чтобы сохранять свои дни.' : 'Ваши дни доступны в вашем аккаунте.';
  switchMode.textContent = register ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт';
  submit.textContent = register ? 'Создать аккаунт' : 'Войти';
  password.autocomplete = register ? 'new-password' : 'current-password';
  password.minLength = register ? 8 : 1;
  passwordHint.hidden = !register;
  if (register) password.setAttribute('aria-describedby', passwordHint.id);
  else password.removeAttribute('aria-describedby');
  form.hidden = false;
  profile.hidden = true;
  drawerLink.hidden = false;
  message('');
}

function renderProfile(user) {
  heading.textContent = 'Ваш дневник';
  intro.textContent = 'Приватные дни доступны в этом аккаунте.';
  profile.querySelector('.account-email').textContent = user.email;
  profile.hidden = false;
  form.hidden = true;
  drawerLink.hidden = true;
  message('');
}

function showUnavailable(text, error = false) {
  intro.hidden = true;
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
    if (user) location.replace(goToJournal);
    else {
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
