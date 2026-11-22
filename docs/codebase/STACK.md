# Стек ThroughTheLense

## Среда выполнения

HTML, CSS и ES-модули JavaScript образуют сайт. Go-приложение на Railway раздаёт статические файлы, аккаунты, архив и публичные ссылки. Go-модуль требует 1.26.0, а образ Railway собирает его на Go 1.27. Node.js 22 используется для сборки сайта.

## Библиотеки приложения

- Go. Стандартный HTTP-сервер, SQLite через `modernc.org/sqlite`, Argon2id через `golang.org/x/crypto` и SDK Anthropic для опционального анализа фотографии.
- Браузер. Web Audio для анализа и смешивания звука, Canvas для палитры и превью, IndexedDB для гостевого архива.
- `package.json` объявляет библиотеки в `devDependencies`, но часть входит в сборку. React, React DOM, Three.js, React Three Fiber, ShaderGradient и LiquidGlass собирают эффект света. UMD Supabase используется только при альтернативной конфигурации входа.

## Инструменты разработки

npm с `package-lock.json`, Go Modules, esbuild, Node test runner и Playwright. Python 3 раздаёт локальную версию по `serve.py`.

## Основные команды

```sh
npm ci
npm run build
node scripts/check-dist.mjs
npm test
go -C backend test ./...
go -C backend run ./cmd/server
```

## Конфигурация

`Dockerfile` использует Node Bookworm и Go Alpine при сборке и Distroless Debian 12 при запуске. `WEB_DIR` задаёт расположение сайта, `DATA_DIR` — файлы копий и SQLite. Railway подключает том для данных. Проверка здоровья обращается к `/api/runtime`.

## Подтверждение

- [Манифест JavaScript](../../package.json) и [Go](../../backend/go.mod).
- [Dockerfile](../../Dockerfile), [Railway](../../railway.toml), [сборка эффекта](../../scripts/build-visuals.mjs) и [код эффекта](../../web/scene-effects.jsx).
- [Сборка сайта](../../scripts/build.mjs), [локальный запуск](../../README.md#запуск-локально).
