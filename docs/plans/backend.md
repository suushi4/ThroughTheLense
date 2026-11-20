# Бэкенд ThroughTheLense: согласованный план

Хакатон Genesis, трек ArtTech. Владелец бэкенда: Алихан. Фронтенд и визуал: suushi4.
Дедлайн сдачи: 22.11, 23:59 (Астана). Бэкенд задеплоен и стабилен к **22.11, 18:00**.

## Цель MVP

Один Go-сервис:

1. Отдаёт статику `web/`: один бинарь или контейнер, одна команда запуска, один URL для жюри.
2. Хранит дни через REST API вместо IndexedDB. Метаданные лежат в SQLite, медиа отдельно на диске.
3. Даёт публичную ссылку на день `/d/{slug}` в режиме только для просмотра.
4. Сохраняет фолбэк: без API (`serve.py`, офлайн) фронт работает на IndexedDB как раньше.

## Принятые решения

| Вопрос | Решение |
|---|---|
| Сид демо-дней | **Не сеем.** Демо статичны в `web/demo.mjs` и подмешиваются на клиенте. Сид в БД дал бы дубли. На проде нужно проверить, что в чистом браузере архив не пустой и демо открываются. |
| `getDay` | **Вариант A:** адаптер скачивает медиа и отдаёт настоящие `File`. `app.mjs` для этого не меняется. Если вариант A во что-то упрётся, сначала обсуждаем. |
| Auth | Клиент генерирует 256-битный токен в `localStorage['ttl-owner']` и шлёт `Authorization: Bearer …`. Сервер хранит только `sha256`. Отдельного эндпоинта выдачи нет. |
| Идемпотентность | id генерирует клиент (`crypto.randomUUID`), поэтому `PUT /api/days/{id}` идемпотентен сам по себе. Отдельный `Idempotency-Key` не нужен. |
| Зависимости | Единственная внешняя: `modernc.org/sqlite` (без CGO). |
| Порт | По умолчанию **8080**. На машине разработки порт 8000 занят службой CHUWI Universal Service (HTTP.sys). |
| Статика | Читается с диска (`WEB_DIR`), а не через `embed`: `go:embed` не достаёт до родительской папки, и правки друга подхватываются без пересборки. |
| Сборка на Windows | Smart App Control блокирует неподписанные `go.exe`, тестовые бинарники и `server.exe`. Выключать его нельзя (это необратимо), поэтому **Go собираем и запускаем в WSL2 Ubuntu**. Сервер доступен из Windows-браузера на `localhost:8080`. |

### Изменения во фронте (согласовано с suushi4)

- `web/storage-api.mjs`: новый модуль с той же сигнатурой `listDays/getDay/saveDay/removeDay`.
- `web/journal.mjs`: минимальное переключение. Старые функции переименованы в `idb*`, добавлен ленивый `probe()` на `GET /api/health` с таймаутом 1.5 с. Режим выбирается **один раз за загрузку страницы**, тихого перехода на IndexedDB посреди сессии нет. Черновики остаются в IndexedDB.
- `web/app.mjs`: **отдельный коммит** для ревью другом. Он включает ветку `/d/{slug}` в `route()`, флаг `readonly` в `dayPage` (без «Редактировать»/«Удалить», подпись «Общая папка») и кнопку «Поделиться» в API-режиме.
- `tests/browser.cjs`: `BASE_URL` из env с дефолтом `http://127.0.0.1:8000/`.
- Текст «О дневнике» («Личные дни хранятся в этом браузере»): готовим вариант, **не коммитим без одобрения друга**.

## Приоритеты

- **P0 к вечеру 21.11:** задеплоено и работает end-to-end. Это каркас и статика → PUT/GET/LIST/DELETE и `/media` с Range → адаптер в `journal.mjs` → деплой.
- **P0 к 12:00 22.11:** share, `/d/{slug}`, режим просмотра.
- **P1:** sweep сирот, per-day mutex, квоты, OG-теги, `tests/api-browser.cjs`.
- **P2:** всё остальное (S3 и т.п.).

Упрощения, если поджимает время:

- MP3 duration: WAV парсим точно. MP3 через Xing/VBRI, при неудаче подсчётом фреймов. Если не укладываемся в ~1 час, проверяем у MP3 только сигнатуру и размер.
- `ref` для медиа: если усложнит адаптер, при редактировании сначала перезаливаем всё, а `ref` переносим в P1.

## Схема БД (SQLite, WAL, `foreign_keys=on`)

```sql
CREATE TABLE days (
  id          TEXT PRIMARY KEY,          -- клиентский UUID
  owner_hash  BLOB NOT NULL,             -- sha256(owner token)
  slug        TEXT UNIQUE,               -- NULL, пока не поделились
  day_date    TEXT NOT NULL,             -- 'YYYY-MM-DD'
  title       TEXT NOT NULL,
  text        TEXT NOT NULL,
  audio_name  TEXT NOT NULL,
  scene_json  TEXT NOT NULL,             -- {version,coverPhotoIndex,quote,palette,quoteAtSec,returnAtSec,endAtSec}
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX days_owner ON days (owner_hash, day_date DESC, id DESC);

CREATE TABLE media (
  key           TEXT PRIMARY KEY,        -- 32 hex, случайный; это и есть имя файла
  day_id        TEXT NOT NULL REFERENCES days (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('photo', 'audio', 'thumb')),
  position      INTEGER NOT NULL,
  mime          TEXT NOT NULL,           -- по сигнатуре, не от клиента
  size          INTEGER NOT NULL,
  name          TEXT NOT NULL,
  last_modified INTEGER NOT NULL,
  UNIQUE (day_id, kind, position)
);
```

- `scene` хранится JSON целиком, поэтому контракт с `player.mjs` совпадает и не дрейфует.
- Миграции лежат в `embed`, версия в `PRAGMA user_version`.
- Репозиторий спрятан за интерфейсом `days.Repo`, так что переход на Postgres = новая реализация.
- Одно соединение (`SetMaxOpenConns(1)`), так что `SQLITE_BUSY` не возникает.

## Объект «день» во фронте (IndexedDB `ThroughTheLense` v2)

```js
// content (ключ id)
{ id, dayDate: 'YYYY-MM-DD', title /*≤120*/, text, audioName,
  photoFiles: File[1..5], audioFile: File,
  scene: { version: 1, coverPhotoIndex, quote /*≤200, дословно из text*/,
           palette: 'rgb(r,g,b)', quoteAtSec, returnAtSec, endAtSec /*≤12*/ } }
// entries: {id, dayDate, title, audioName, photoCount, thumbnail: Blob(JPEG ≤650px), duration: endAtSec}
// drafts (ключ 'new' | id дня): {key, id, dayDate, text, photos, coverIndex, audio, audioName, title, quote, cues|null, revision}
```

`saveDay(entry, thumbnail, draftKey)`: миниатюру генерирует клиент. Если `draftKey === id`, это редактирование, и оно падает, если дня уже нет.

## Контракт API

Ошибки приходят как `{"error":{"code":"…","message":"…"}}`, сообщения на русском, теми же словами, что в `scene.mjs`.

| Метод | Путь | Auth | Ответ |
|---|---|---|---|
| GET | `/api/health` | — | `200 {"ok":true,"version":"…"}` |
| GET | `/api/days` | owner | `200 [{id,dayDate,title,audioName,photoCount,duration,thumbnail{key,url,…}}]` |
| GET | `/api/days/{id}` | owner | `200 Day` / `404` |
| PUT | `/api/days/{id}` | owner | `200 Day` (upsert, multipart). `If-Match: *` = только редактирование, иначе `412` |
| DELETE | `/api/days/{id}` | owner | `204` (повторный и чужой тоже `204`) |
| POST | `/api/days/{id}/share` | owner | `200 {"slug","url"}`, повтор возвращает тот же slug |
| DELETE | `/api/days/{id}/share` | owner | `204`, ссылка отзывается |
| GET | `/api/public/{slug}` | — | `200 Day` / `404` |
| GET | `/media/{key}` | — | файл, Range/ETag, `nosniff`, `immutable` |
| GET | `/d/{slug}` | — | `index.html` с `<base href="/">` и OG-тегами |
| GET | `/*` | — | статика `web/`, для html/js/mjs/css `no-store` |

`?q=&filter=` не делаем: поиск и фильтры `app.mjs` выполняет на клиенте вместе с демо.

### PUT multipart

Первым полем идёт `meta`, затем файлы:

```
meta = {"dayDate":"2026-11-21","title":"…","text":"…","audioName":"…",
        "scene":{"version":1,"coverPhotoIndex":0,"quote":"…","palette":"rgb(…)",
                 "quoteAtSec":2.7,"returnAtSec":7.8,"endAtSec":12},
        "photos":[{"part":"photo0","name":"street.jpg","lastModified":1732…},{"ref":"9f2c…"}],
        "audio":{"ref":"a41b…"}, "thumbnail":{"part":"thumbnail"}}
photo0 = <file>   thumbnail = <file>
```

`ref` означает неизменённый файл этого же дня: при редактировании медиа заново не заливается. Адаптер помнит `File → key` в `WeakMap`.

### Day (ответ)

```json
{"id":"…","slug":null,"dayDate":"…","title":"…","text":"…","audioName":"…","scene":{…},
 "photos":[{"key":"9f2c…","url":"/media/9f2c…","name":"street.jpg","type":"image/jpeg","size":123,"lastModified":1732…}],
 "audio":{…},"thumbnail":{…},"createdAt":…,"updatedAt":…}
```

### Коды ошибок

| Код | Что значит | HTTP |
|---|---|---|
| `invalid_meta` | битые или невалидные метаданные | 400 |
| `invalid_photo_count` | меньше 1 или больше 5 фото | 400 |
| `unsupported_photo` | фото не JPEG/PNG/WebP по сигнатуре | 400 |
| `photo_too_large` | фото больше 8 МиБ | 400 |
| `unsupported_audio` | трек не WAV/MP3 по сигнатуре | 400 |
| `audio_too_large` | трек больше 12 МиБ | 400 |
| `audio_duration` | трек короче 3 или длиннее 60 с | 400 |
| `payload_too_large` | запрос больше лимита | 413 |
| `unauthorized` | нет или невалиден owner-токен | 401 |
| `not_found` | дня нет (или он чужой) | 404 |
| `precondition_failed` | редактирование уже удалённого дня | 412 |
| `id_conflict` | id занят другим владельцем | 409 |
| `quota_exceeded` | превышен лимит дней на токен | 403 |
| `busy` | все слоты загрузки заняты | 503 |
| `internal` | ошибка сервера | 500 |

## Сохранение: атомарность

1. Части multipart стримятся (`multipart.Reader`) во временные файлы `DATA_DIR/blobs/tmp/`, у каждой своя `LimitReader`-квота. Сигнатура и длительность проверяются по ходу.
2. Всё валидно → `rename` в `blobs/ab/abcd…`.
3. Одна SQL-транзакция: upsert `days` (`ON CONFLICT … WHERE owner_hash = excluded.owner_hash`), затем замена строк `media`.
4. Commit прошёл → удаляются файлы, на которые больше нет ссылок. Commit упал → удаляются только что записанные.
5. Фаза commit сериализована mutex-ом. Загрузка идёт вне блокировки.
6. P1: sweep при старте удаляет файлы без строки в `media` старше 1 часа (на случай падения между шагами 2 и 3).

## Валидация (повторяет фронт)

- **Фото:** 1–5 штук, каждое ≤ 8 МиБ. Тип JPEG/PNG/WebP определяется через `http.DetectContentType`, имя и `Content-Type` клиента игнорируются.
- **Аудио:** ≤ 12 МиБ, сигнатура `RIFF…WAVE` или ID3/MPEG frame sync. Длительность 3–60 с (допуск ±0.05). WAV по `fmt`/`data`, MP3 через Xing/VBRI или подсчётом фреймов.
- **Миниатюра:** только JPEG, ≤ 1 МиБ.
- **meta:**
  - id по `^[A-Za-z0-9-]{1,64}$`, валидная календарная дата, `title` 1–120 после trim, `text` 1–50 000 и содержит хотя бы одно слово, `audioName` ≤ 255;
  - `quote` ≤ 200 и дословно входит в `text`, `palette` в виде `rgb(…)` или `#rrggbb`, `coverPhotoIndex` в диапазоне фото;
  - cues по правилам `validCues`, `0 < endAtSec ≤ 12`, сцена не длиннее трека.
  - Неизвестные поля отклоняются.
- **Лимиты:** запрос ≤ ~57 МиБ (`MaxBytesReader`), не больше 4 загрузок одновременно, не больше 50 дней на токен.

## Структура Go-проекта

```
backend/
  go.mod                       # module throughthelense/backend, зависимость modernc.org/sqlite
  cmd/server/main.go           # конфиг, wiring, graceful shutdown (SIGINT/SIGTERM)
  internal/config/             # env: PORT=8080, DATA_DIR, WEB_DIR, PUBLIC_BASE_URL, API=on|off, MAX_DAYS_PER_OWNER, MAX_CONCURRENT_UPLOADS
  internal/httpapi/            # ServeMux (Go 1.22 patterns), хендлеры, ошибки, middleware (slog, recover, request-id), статика, /d/{slug}
  internal/days/               # домен: типы, валидация meta, Service.Save/Get/List/Delete/Share
  internal/mediacheck/         # сниффинг фото, длительность WAV/MP3
  internal/store/sqlite/       # Repo + migrations (embed)
  internal/blob/               # BlobStore interface + fs-реализация
  internal/fixture/            # JPEG/PNG/WAV/MP3 для тестов, собираются в коде
Dockerfile                     # golang:1.23-alpine → distroless/static, COPY web/
docker-compose.yml             # сервис + volume journal-data:/data
```

## Edge cases

| Кейс | Поведение |
|---|---|
| Двойной клик «Сохранить», повтор после таймаута | PUT идемпотентен, итог один и тот же |
| Редактирование дня, удалённого в другой вкладке | `If-Match: *` → 412 → ошибка сохранения |
| Подменённый файл (`.jpg` с текстом или exe) | `unsupported_photo`, на диске ничего не остаётся |
| Падение на любом файле / ошибка БД | откат, временные и новые блобы удаляются |
| Падение процесса между rename и commit | sweep при старте (P1) |
| `ref` на чужой ключ | `invalid_meta` |
| Две записи на одну дату | разные id; сортировка `day_date DESC, id DESC`, как на клиенте |
| DELETE повторный / чужой | `204`, существование дня не раскрываем |
| Чужой токен пишет в занятый id | `409 id_conflict` |
| Отозванный slug | `/api/public` → 404, страница «Папка недоступна» |
| Токен потерян | дни недоступны; страховка: «Скачать копию» → импорт |
| Старые IndexedDB-дни | на проде их нет (новый origin), автомиграцию не делаем |
| API недоступен при загрузке страницы | IndexedDB на всю сессию |
| localStorage недоступен | IndexedDB-режим |
| Заполнение диска на публичном демо | лимит 50 дней на токен, ~57 МиБ на запрос, 4 параллельные загрузки |
| Перебор slug | 10 символов из 32-символьного алфавита (~50 бит), случайный, не из названия |

## Тесты

- **Go** (table-driven + `httptest` на временной SQLite):
  - сниффинг и длительность;
  - полный цикл CRUD, Range 206, изоляция токенов;
  - идемпотентность, редактирование через ref, 412/409;
  - 15 кейсов невалидного ввода с проверкой «на диске пусто»;
  - квота, share;
  - откат при ошибке БД.
- **`npm test`:** без изменений.
- **`npm run test:browser`:** в IndexedDB-режиме через `serve.py` и через Go с `API=off`. Четыре проверки там читают IndexedDB напрямую, поэтому в API-режиме тест в исходном виде не проходит.
- **`tests/api-browser.cjs`** (P1, после деплоя): те же пользовательские пути в API-режиме.
- **Ручной `/qa`:** Новый день → сохранить → перезагрузка → открыть из архива → смена трека → публичная ссылка в чистом профиле.
- **Перед мержем:** `/review` и быстрый `/cso` по загрузке файлов.

## Деплой

`Dockerfile` подходит и для Fly.io (volume на `/data`), и для VPS с `docker compose up -d`. Образ запускается от root, потому что тома Fly монтируются root-owned. Аккаунт и платформу выбирает Алихан. На проде проверяем загрузку, Range-перемотку, публичную ссылку и демо в чистом браузере.

## Статус на 21.11

- Код P0 бэкенда, адаптер фронта, Docker и Go-тесты написаны в ветке `backend`. **Ещё не скомпилированы:** Smart App Control блокирует `go.exe`.
- Следующий шаг: WSL2 Ubuntu (`wsl --install -d Ubuntu`) → `go mod tidy && go vet ./... && go test ./...` → запуск → ручная проверка → коммиты по шагам.
