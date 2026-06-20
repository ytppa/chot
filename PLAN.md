# Nothing Chat - Development Plan

Дата актуализации: 2026-06-20

Этот файл нужен как живой план разработки. Он должен отражать текущее состояние проекта, ближайший фокус и статус крупных этапов.

## Правила Ведения

- Обновлять план при начале, завершении или блокировке значимого этапа.
- Не оставлять выполненные пункты в статусе `TODO`.
- Если решение меняет архитектуру, стек или принципиальный подход, обновлять не только план, но и `agents.MD`.
- Не превращать план в подробный changelog; здесь важны этапы, статусы и ближайшие действия.
- После крупных задач переносить новые выводы в соответствующий раздел плана.

## Статусы

- `DONE` - завершено.
- `IN PROGRESS` - сейчас в работе.
- `TODO` - запланировано.
- `BLOCKED` - заблокировано внешним решением или недостающим доступом.
- `DEFERRED` - осознанно отложено.

## Текущее Состояние

- `DONE` README с контекстом проекта создан и принят как исходная база.
- `DONE` `agents.MD` создан с ключевыми правилами для агентов.
- `DONE` `nothing-chat` выделен в отдельный Git-репозиторий.
- `DONE` Remote `origin` указывает на `https://github.com/ytppa/chot.git`.
- `DONE` Основная ветка нового репозитория: `main`.
- `DONE` Ведение плана разработки заведено через `PLAN.md`.
- `DONE` Этап 1: каркас проекта, npm workspaces и базовые TypeScript configs.
- `DONE` Этап 2: backend основа на Fastify и WebSocket.
- `DONE` Этап 3: frontend основа на Vite и native Web Components.
- `IN PROGRESS` Этап 4: Drizzle schema, migration и admin seed готовы; выбор PostgreSQL runtime ожидает решения.

## Ближайший Фокус

1. `DONE` Инициализировать npm workspace в корне проекта.
2. `DONE` Создать каркас `apps/server` на Fastify.
3. `DONE` Добавить health endpoint и базовый `/ws` ping/echo.
4. `DONE` Создать каркас `apps/web` на Vite + TypeScript без React.
5. `DONE` Создать `packages/shared` для общих типов и протокола.
6. `BLOCKED` Выбрать PostgreSQL runtime: Docker Compose или Open Server Panel.

## Этап 1 - Каркас Проекта

- `DONE` Создать root `package.json` с workspaces.
- `DONE` Добавить базовые TypeScript configs.
- `DONE` Добавить `.gitignore`.
- `DONE` Настроить единые scripts для build, dev, typecheck.
- `DONE` Подготовить структуру `apps/web`, `apps/server`, `packages/shared`.

## Этап 2 - Backend Основа

- `DONE` Поднять Fastify server.
- `DONE` Добавить `/health`.
- `DONE` Подключить `@fastify/websocket`.
- `DONE` Добавить `/ws` с базовым ping/pong.
- `DONE` Добавить server config через env.
- `DONE` Ограничить WebSocket payload.

## Этап 3 - Frontend Основа

- `DONE` Поднять Vite + TypeScript app без React.
- `DONE` Создать `x-app-shell`.
- `DONE` Создать базовые auth components.
- `DONE` Создать базовые chat/message components.
- `DONE` Добавить простой app store.
- `DONE` Добавить services для HTTP API и WebSocket client.

## Этап 4 - База Данных

- `BLOCKED` Определиться: PostgreSQL через Docker Compose или Open Server Panel.
- `DONE` Подключить PostgreSQL к server app через `DATABASE_URL` и typed database client.
- `DONE` Описать Drizzle schema.
- `DONE` Создать первую миграцию.
- `DONE` Добавить seed admin из env.

## Этап 5 - Auth И Admin Flow

- `TODO` Реализовать регистрацию пользователя со статусом `pending`.
- `TODO` Реализовать login/logout/me.
- `TODO` Хранить hash session token в БД.
- `TODO` Подключить cookie-based sessions.
- `TODO` Реализовать список pending users для админа.
- `TODO` Реализовать approve/reject пользователей.

## Этап 6 - Direct Chats

- `TODO` Реализовать список личных чатов.
- `TODO` Реализовать создание direct chat.
- `TODO` Проверять membership на каждом HTTP и WS действии.
- `TODO` Добавить загрузку истории сообщений с пагинацией.

## Этап 7 - Realtime Messages

- `TODO` Описать WebSocket protocol в `packages/shared`.
- `TODO` Реализовать `message.send`.
- `TODO` Реализовать `message.created`.
- `TODO` Реализовать `message.ack`.
- `TODO` Использовать `clientNonce` для идемпотентности.
- `TODO` Реализовать read marks и unread counters.

## Этап 8 - Message Rendering

- `TODO` Добавить linkify parser.
- `TODO` Хранить сообщения как plain text.
- `TODO` Рендерить пользовательский текст через `TextNode`.
- `TODO` Рендерить ссылки отдельными `<a>` элементами.
- `TODO` Не использовать `innerHTML` для пользовательского текста.

## Этап 9 - Context Menu

- `TODO` Создать единый `x-context-menu-root`.
- `TODO` Добавить событие `app-context-menu`.
- `TODO` Добавить `menu-registry.ts`.
- `TODO` Реализовать закрытие по Escape, outside click, scroll и resize.
- `TODO` Добавить keyboard navigation.
- `TODO` Добавить long press для touch.

## Этап 10 - Проверки И Стабилизация MVP

- `TODO` Добавить targeted tests для auth, sessions и message send.
- `TODO` Добавить typecheck во все workspace packages.
- `TODO` Проверить базовый user flow вручную.
- `TODO` Проверить, что пользовательский текст не рендерится через `innerHTML`.
- `TODO` Проверить WebSocket reconnect сценарии.

## Отложено

- `DEFERRED` Email notifications.
- `DEFERRED` Password reset.
- `DEFERRED` Email verification.
- `DEFERRED` Groups and channels.
- `DEFERRED` Attachments and images.
- `DEFERRED` Replies, quotes and forwards.
- `DEFERRED` Markdown and rich text formatting.
- `DEFERRED` Message list virtualization.
- `DEFERRED` Open Server Panel HTTPS/WSS proxy setup.

## Открытые Решения

- `BLOCKED` Выбрать PostgreSQL: Docker Compose или Open Server Panel.
- `TODO` Выбрать локальный домен для OSP: `nothing-chat.local`, `chat.local` или другой.
- `TODO` Решить, нужен ли Lit после первого MVP.
- `TODO` Определить момент, когда нужна виртуализация сообщений.
