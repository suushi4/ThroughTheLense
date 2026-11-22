# Карта репозитория ThroughTheLense

## Каталоги верхнего уровня

| Путь | Назначение |
| --- | --- |
| `web/` | HTML-страницы, CSS, JavaScript-модули, медиа, шрифты и материалы для жюри |
| `backend/` | Сервер Go, SQLite, файлы копий, проверка медиа и тесты HTTP |
| `tests/` | Сквозные сценарии Playwright |
| `scripts/` | Сборка, проверка ссылок в сборке, подготовка аудио и операции Railway |
| `docs/` | Интеграция, архитектурные и дизайнерские решения, лицензии, сдача |
| `api/`, `supabase/` | Альтернативный запуск со входом через Supabase |
| `.agents/skills/` | Локальные навыки проекта, загружаемые Codex |

## Точки входа

Главная — `web/index.html` и `home.mjs`. `journal.html` открывает `app.mjs`, где маршруты `#new`, `#preview`, `#day/…` и `#archive` управляют состоянием дневника. Для публичной ссылки существуют `shared.html` и `shared.mjs`. Галерея и страница жюри имеют отдельные страницы и небольшие модули. Go стартует из `backend/cmd/server`, Python — из `serve.py`.

## Границы модулей

`scene.mjs` вычисляет палитру, выбор фразы и музыкальные метки. `player.mjs` воспроизводит уже подготовленную сцену. `diary.mjs` выбирает слой хранения, `web/journal.mjs` обслуживает IndexedDB, `cloud-diary.mjs` обслуживает Supabase. `transfer.mjs` собирает и читает JSON, `day-folder.mjs` формирует ZIP.

Go разделён на `internal/httpapi`, `auth`, `store`, `copies`, `copycheck`, `mediacheck`, `vision` и `config`. Статическая сборка находится в `dist/` и производится из исходников `web/`.

## Имена и организация

Для модулей сайта из нескольких слов используются имена вроде `archive-calendar.mjs` и `sound-samples.mjs`. Файл `scene.test.mjs` лежит в корне рядом с конфигурацией Node. Go-тесты `*_test.go` размещены рядом с проверяемым кодом.

## Подтверждение

- [Карта в README](../../README.md#структура), [маршруты дневника](../../web/app.mjs), [вход Go](../../backend/cmd/server/main.go).
- [Обработка сцен](../../web/scene.mjs), [плеер](../../web/player.mjs), [экспорт папки](../../web/day-folder.mjs).
- [Страница жюри](../../web/jury.html) и [материалы сдачи](../submission/).
