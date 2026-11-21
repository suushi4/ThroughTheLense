# Как правка дизайна попадает на сайт

Сайт: <https://throughthelense-production.up.railway.app>. Railway собирает его из `Dockerfile` и запускает Go-сервер, который раздаёт `dist/`.

## Путь правки

1. Правите HTML, CSS, картинки, шрифты и `.mjs` в `web/`. Новые файлы в `web/` попадают на сайт автоматически, отдельно их подключать не нужно.
2. Перед push проверяете локально:
   ```sh
   npm ci
   npm run build
   node scripts/check-dist.mjs   # те же проверки, что при деплое
   npm test
   ```
   Посмотреть результат можно через `python3 serve.py` (раздаёт `web/`) или через Go-сервер, как на проде: `cd backend && WEB_DIR=../dist DATA_DIR=../data go run ./cmd/server`, затем открыть <http://127.0.0.1:8080>.
3. Push или merge в `main`. Railway сам собирает и выкатывает новую версию примерно за 3–4 минуты. Во время сборки работает прежняя версия. В момент переключения сайт может быть недоступен несколько секунд, потому что база лежит на томе, который подключён только к одному контейнеру.

Внутри сборки выполняются `npm ci`, `npm run build` и `node scripts/check-dist.mjs`. Проверка останавливает деплой в трёх случаях:
- не хватает обязательной страницы или сборки (`index.html`, `journal.html`, `account.html`, `404.html`, `privacy.html`, `terms.html`, `assets/scene-effects.mjs`, `vendor/supabase.js`);
- в `.mjs`-файле синтаксическая ошибка;
- HTML, CSS или `import` ссылаются на локальный файл, которого нет.

Затем собирается Go-сервер. После старта Railway проверяет `/api/runtime`. Если сервер не отвечает, деплой помечается неудачным.

Пока PR #5 не смержен и автодеплой не подключён, новую версию выкладывает Азат командой `railway up --ci`.

## Логи сборки

Railway → проект **throughthelense** → сервис **throughthelense** → вкладка **Deployments** → нужный деплой. **Build Logs** показывают сборку образа (npm, проверку `dist/`, Go), **Deploy Logs** — работу сервера. Доступ к проекту выдаёт Азат: Project Settings → Members. После подключения GitHub статус деплоя виден и у коммита в GitHub.

## Если деплой упал

- **Упала сборка** (Build Logs заканчиваются ошибкой). Сайт продолжает работать на предыдущей версии. Найдите в логе строку `dist/ check failed:` или ошибку npm и исправьте её:
  - `home.mjs: … SyntaxError` — синтаксическая ошибка в этом файле;
  - `index.html → /images/x.webp (no such file)` — неверный путь или файл не добавлен в git;
  - `npm ci` ругается на lock-файл — после изменения зависимостей выполните `npm install` и закоммитьте `package-lock.json`.

  Исправление отправьте новым push, локально его проверит `node scripts/check-dist.mjs`.
- **Сборка прошла, но сервер не поднялся** (Deploy Logs, healthcheck failed). Напишите Азату. Это обычно касается переменных или сервера, а не дизайна.
- **Нужно срочно вернуть прежнюю версию.** В Deployments откройте последний успешный деплой и нажмите **Redeploy**. Либо сделайте `git revert` проблемного коммита и push в `main`.

## Что нельзя менять без Азата

- **Контракт `/api/*`**: пути, тела запросов и ответов, коды ошибок, cookie `ttl_session`, заголовок `X-Diary-Request`. Go-сервер повторяет его байт в байт. Описание в [backend-integration.md](backend-integration.md).
- **Выбор хранилища и вход** в `web/diary.mjs` и `web/account.mjs` (`connectDiary`, `localDiary`, `currentUser`, `login`, `logout`, чтение `/api/runtime`), а также формат копии дня `ThroughTheLense/day` v1 в `web/transfer.mjs`.
- **Сборку и деплой**: `Dockerfile`, `.dockerignore`, `railway.toml`, `scripts/check-dist.mjs`, раскладку `dist/` из `scripts/build.mjs` (`vendor/supabase.js`, `assets/scene-effects.mjs`) и каталог `backend/`.
- **Переименование или удаление страниц** из списка выше и `shared.html`. На них ссылаются сервер и проверка сборки.

Остальное можно менять свободно: вёрстку, стили, тексты, картинки, шрифты, новые модули и страницы в `web/`.
