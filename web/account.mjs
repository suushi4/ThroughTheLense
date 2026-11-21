let setup;

async function api(path, options = {}) {
  const response = await fetch('/api/' + path, {
    ...options,
    headers: {'X-Diary-Request': '1', ...options.headers},
    cache: 'no-store'
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw Object.assign(new Error(failure.message || 'Сервис дневника недоступен.'), {status: response.status});
  }
  return response;
}

async function loadAccount() {
  let config;
  try { config = await (await api('runtime')).json(); }
  catch (error) {
    if (error.status === 404) return {available:false};
    throw error;
  }
  if (config.mode === 'local') return {available:true, mode:'local'};
  if (config.mode !== 'supabase' || !config.url || !config.key) return {available:false};
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/supabase.js';
    script.onload = resolve;
    script.onerror = () => reject(Error('Библиотека входа не загрузилась.'));
    document.head.append(script);
  });
  return {available:true, mode:'supabase', client:window.supabase.createClient(config.url, config.key)};
}
export function account() { return setup ??= loadAccount(); }

export async function currentUser() {
  const provider = await account();
  if (!provider.available) return null;
  if (provider.mode === 'local') return (await (await api('session')).json()).user;
  const {data, error} = await provider.client.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError') throw error;
  return data.user;
}

export async function login(email, password, register) {
  const provider = await account();
  if (provider.mode === 'local') {
    const response = await api(register ? 'register' : 'login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password})
    });
    return (await response.json()).user;
  }
  const auth = provider.client.auth;
  const result = register
    ? await auth.signUp({email,password,options:{emailRedirectTo:location.origin+'/account.html'}})
    : await auth.signInWithPassword({email,password});
  if (result.error) {
    const messages = {
      invalid_credentials:'Неверная почта или пароль.',
      email_not_confirmed:'Сначала подтвердите адрес из письма.',
      over_email_send_rate_limit:'Подождите немного и попробуйте снова.',
      over_request_rate_limit:'Слишком много попыток. Попробуйте позже.',
      weak_password:'Выберите более сложный пароль.',
      user_already_exists:'Этот адрес уже зарегистрирован.'
    };
    throw Error(messages[result.error.code] || 'Не удалось '+(register ? 'создать аккаунт' : 'войти')+'. Попробуйте снова.');
  }
  return result.data.session?.user ?? null;
}

export async function logout() {
  const provider = await account();
  if (provider.mode === 'local') await api('logout',{method:'POST'});
  else {
    const {error} = await provider.client.auth.signOut({scope:'local'});
    if (error) throw Error('Не удалось выйти. Попробуйте ещё раз.');
  }
}

export const localDiary = {
  async list() { return (await (await api('days')).json()).days; },
  async open(id) {
    try { return await (await api('days/'+encodeURIComponent(id))).blob(); }
    catch (error) { if (error.status === 404) return undefined; throw error; }
  },
  async save(id, summary, copy, editing) {
    await api('days/'+encodeURIComponent(id), {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({summary,copy:JSON.parse(await copy.text()),editing})
    });
  },
  async remove(id) { await api('days/'+encodeURIComponent(id),{method:'DELETE'}); }
};
