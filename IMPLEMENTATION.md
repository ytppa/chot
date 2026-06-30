# Nothing Shhh - implementation notes

Дата актуализации: 2026-06-28

Этот документ описывает уже реализованную часть проекта: стек, структуру, API, основные правила логики и известные ограничения.
План будущих работ ведется в `PLAN.md`, а архитектурные правила для агентов - в `agents.MD`.

## Реализованный стек

Frontend:

- TypeScript.
- Vite.
- Sass.
- Native Web Components.
- Основные UI-компоненты рендерятся в light DOM и стилизуются через `apps/web/src/styles/index.scss`.
- Shadow DOM оставлен точечно для `x-context-menu-root`, где нужна изоляция overlay-слоя.
- React не используется.

Backend:

- Node.js.
- Fastify.
- `@fastify/websocket` поверх `ws`.
- `@fastify/cookie` для cookie-based sessions.
- PostgreSQL.
- Drizzle ORM.
- `postgres` как PostgreSQL driver.
- Zod для HTTP payload и route params validation.
- `argon2id` через пакет `argon2` для password hashing.

Shared:

- `packages/shared` содержит общие DTO и типы протокола.
- Общие типы импортируются в frontend и backend через `@nothing-chat/shared`.

Локальная инфраструктура:

- Текущий PostgreSQL runtime: portable PostgreSQL 17.10 из official EDB Windows x86-64 binaries.
- Runtime-файлы, data dir, logs и локальные credentials лежат в `.local` и не попадают в Git.
- `npm run db:up`, `db:down`, `db:status`, `db:logs` управляют portable PostgreSQL.
- Docker Compose конфигурация сохранена в `docker-compose.yml` как опциональный будущий путь через `db:docker:*`.
- В текущей установке Open Server Panel нет PostgreSQL-модуля; БД остается на portable PostgreSQL, а OSP используется только как Nginx proxy для локального домена.
- Локальный домен `chat.local` настроен через OSP/Nginx: `/` проксируется на Vite `127.0.0.1:5173`, `/api`, `/health` и `/ws` проксируются на Fastify `127.0.0.1:3000`.
- OSP project лежит в `C:\Games\OSPanel\home\chat.local`, custom Nginx include - в `C:\Games\OSPanel\user\nginx\chat.local.conf`.
- Настройка воспроизводится скриптом `scripts/configure-osp-chat-local.ps1`; скрипт добавляет hosts-блок `NOTHING CHAT`, OSP project, локальный сертификат и include в Nginx template, потому что OSP пересобирает активный `nginx.conf` при рестарте.
- Проверено: `http://chat.local/` отдает Vite, `http://chat.local/health` отдает Fastify health JSON, `ws://chat.local/ws` и `wss://chat.local/ws` доходят до backend WebSocket gateway.
- HTTPS использует локальный сертификат `CN=chat.local`; если браузер не доверяет OSP root certificate, нужно отдельно согласовать добавление OSP root CA в Windows certificate store.
- Установка актуального Docker Desktop 2026-06-20 заблокирована хостом: Windows 10 Pro 21H2 build 19044 и inbox WSL без вывода `wsl --version`; для текущего Docker Desktop нужен Windows 10 22H2 build 19045+ и современный WSL.

## Структура проекта

```text
apps/
  server/
    src/
      config.ts
      app.ts
      index.ts
      db/
      http/
      modules/
      ws/

  web/
    index.html
    vite.config.ts
    src/
      app/
      components/
      services/
      styles/

packages/
  shared/
    src/
```

Ключевые границы:

- `apps/server` отвечает за HTTP API, WebSocket, auth, admin flow, DB access и domain services.
- `apps/web` отвечает за браузерный UI и клиентские service wrappers.
- `packages/shared` отвечает за общие DTO, user types и event envelope types.

## Конфигурация

Пример переменных лежит в `.env.example`.

Основные переменные:

- `NODE_ENV`
- `HOST`
- `PORT`
- `LOG_LEVEL`
- `WS_MAX_PAYLOAD_BYTES`
- `SESSION_COOKIE_NAME`
- `SESSION_TTL_DAYS`
- `DATABASE_URL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_PORT`
- `ADMIN_LOGIN`
- `ADMIN_PASSWORD`
- `ADMIN_DISPLAY_NAME`

Для production `DATABASE_URL` обязателен.
Для local/dev есть fallback:

```text
postgres://nothing_chat:nothing_chat@127.0.0.1:5432/nothing_chat
```

## Команды

Проверки:

```powershell
npm test
npm run typecheck
npm run build --workspace @nothing-chat/web
npm run build --workspace @nothing-chat/server
npm audit --omit=dev
```

Frontend dev:

```powershell
npm run dev:web -- --port 5173
```

Backend dev:

```powershell
npm run dev:server
```

PostgreSQL local portable:

```powershell
npm run db:up
npm run db:status
npm run db:logs
npm run db:down
```

PostgreSQL через Docker Compose, опционально:

```powershell
npm run db:docker:up
npm run db:docker:status
npm run db:docker:logs
npm run db:docker:down
```

Миграции и seed:

```powershell
npm run db:migrate
npm run db:seed:admin
npm run db:seed:date-demo
```

## HTTP API

### Health

```text
GET /health
```

Ответ:

```json
{
  "status": "ok",
  "service": "nothing-chat-server",
  "uptimeSeconds": 1.23,
  "websocket": {
    "path": "/ws",
    "maxPayloadBytes": 65536
  },
  "ts": "2026-06-20T00:00:00.000Z"
}
```

### Auth

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

`POST /api/auth/register`

Request:

```json
{
  "login": "alex",
  "password": "password123",
  "displayName": "Alex"
}
```

Behavior:

- Создает пользователя со статусом `pending`.
- Хеширует пароль через `argon2id`.
- Не логинит пользователя автоматически.
- Если login занят, возвращает `409 login_taken`.

`POST /api/auth/login`

Request:

```json
{
  "login": "alex",
  "password": "password123"
}
```

Behavior:

- Проверяет пароль через `argon2.verify`.
- Пускает только пользователей со статусом `active`.
- Создает opaque session token.
- В БД хранит только SHA-256 hash токена.
- В браузер пишет `HttpOnly` cookie.
- Для HTTPS/production cookie получает `Secure`.
- `SameSite=Lax`.

`POST /api/auth/logout`

Behavior:

- Если cookie есть, сессия помечается `revoked_at`.
- Cookie очищается.
- Возвращает `204`.

`GET /api/auth/me`

Behavior:

- Читает session cookie.
- Находит активную, не истекшую, не revoked сессию.
- Возвращает только public user DTO.
- Без cookie или с невалидной cookie возвращает `401 session_required`.

### Admin

```text
GET  /api/admin/pending-users
POST /api/admin/users/:id/approve
POST /api/admin/users/:id/reject
```

Общие правила:

- Все admin routes требуют активную session cookie.
- Actor должен иметь `role = admin` и `status = active`.
- Не-admin получает `403 forbidden`.

`GET /api/admin/pending-users`

Behavior:

- Возвращает список пользователей со статусом `pending`.
- Сортирует по `created_at`.

`POST /api/admin/users/:id/approve`

Behavior:

- Меняет статус pending user на `active`.
- Заполняет `verified_at` и `verified_by`.
- Если pending user не найден, возвращает `404 pending_user_not_found`.

`POST /api/admin/users/:id/reject`

Behavior:

- Меняет статус pending user на `rejected`.
- Заполняет `verified_at` и `verified_by`.
- Если pending user не найден, возвращает `404 pending_user_not_found`.

### Users

```text
GET /api/users
```

Query:

```text
query=alex
limit=20
```

Behavior:

- Требует активную session cookie.
- Возвращает только пользователей со статусом `active`.
- Исключает текущего пользователя из результата.
- Поддерживает поиск по `login` и `display_name`.
- `limit` ограничен диапазоном 1..50, значение по умолчанию - 20.
- Используется frontend-формой создания личного чата.

### Direct chats

```text
GET  /api/chats/direct
POST /api/chats/direct
GET  /api/chats/:id/messages
POST /api/chats/:id/read
```

Общие правила:

- Все chat routes требуют активную session cookie.
- Пользователь должен иметь `status = active`.
- История сообщений отдается только участникам чата.
- Direct chat хранит ordered pair пользователей и повторное создание возвращает существующий чат.

`GET /api/chats/direct`

Behavior:

- Возвращает список direct chats текущего пользователя.
- Для каждого чата возвращает peer user DTO, unread count, updated timestamp и preview последнего сообщения, если оно есть.
- Сортирует чаты по `chats.updated_at` от новых к старым.

`POST /api/chats/direct`

Request:

```json
{
  "userId": "00000000-0000-0000-0000-000000000000"
}
```

Behavior:

- Создает direct chat с активным target user.
- Запрещает создавать чат с самим собой.
- Если direct chat уже есть, возвращает существующий.
- Если target user не найден или не active, возвращает `404 target_user_not_found`.

`GET /api/chats/:id/messages`

Query:

```text
limit=50
beforeSeq=123
```

Behavior:

- Проверяет membership текущего пользователя.
- Возвращает сообщения в хронологическом порядке.
- Поддерживает пагинацию назад через `beforeSeq`.
- Возвращает `hasMore`, если есть более старые сообщения.

`POST /api/chats/:id/read`

Behavior:

- Проверяет membership текущего пользователя в чате.
- Берет текущий `chats.message_seq` как последнюю прочитанную позицию.
- Обновляет `chat_members.last_read_seq` для текущего пользователя.
- Сбрасывает `chat_members.unread_count` текущего пользователя в `0`.
- Возвращает `chatId`, `lastReadSeq` и `unreadCount`.

## API error envelope

Ошибки HTTP API возвращаются в одном формате:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid request payload."
  }
}
```

Domain errors создаются через `DomainError`.
Неожиданные ошибки не раскрывают внутренние детали и возвращают:

```json
{
  "error": {
    "code": "internal_error",
    "message": "Internal server error."
  }
}
```

## WebSocket API

Endpoint:

```text
/ws
```

Client envelope:

```ts
type ClientEventEnvelope<TPayload = unknown> = {
  id: string;
  type: string;
  payload: TPayload;
  ts?: string;
};
```

Server envelope:

```ts
type ServerEventEnvelope<TPayload = unknown> = {
  id?: string;
  type: string;
  payload: TPayload;
  ts: string;
};
```

Реализовано сейчас:

```text
Client -> server: ping
Server -> client: pong
Client -> server: message.send
Server -> sender: message.ack
Server -> other online participants: message.created
Server -> client: error
```

`ping` example:

```json
{
  "id": "evt_123",
  "type": "ping",
  "payload": {}
}
```

`pong` example:

```json
{
  "id": "evt_123",
  "type": "pong",
  "payload": {
    "ok": true,
    "receivedAt": "2026-06-20T00:00:00.000Z"
  },
  "ts": "2026-06-20T00:00:00.000Z"
}
```

`message.send` example:

```json
{
  "id": "evt_124",
  "type": "message.send",
  "payload": {
    "chatId": "00000000-0000-0000-0000-000000000000",
    "body": "Hello",
    "clientNonce": "11111111-1111-1111-1111-111111111111"
  }
}
```

`message.ack` возвращается на тот socket, который отправил сообщение:

```json
{
  "id": "evt_124",
  "type": "message.ack",
  "payload": {
    "clientNonce": "11111111-1111-1111-1111-111111111111",
    "message": {}
  },
  "ts": "2026-06-20T00:00:00.000Z"
}
```

`message.created` отправляется другим online-сокетам участников чата:

```json
{
  "type": "message.created",
  "payload": {
    "message": {}
  },
  "ts": "2026-06-20T00:00:00.000Z"
}
```

Особенности:

- WebSocket payload size ограничивается через `WS_MAX_PAYLOAD_BYTES`.
- WebSocket соединение требует активную session cookie.
- Невалидный JSON возвращает structured `error`.
- Неизвестный event type возвращает `unknown_event`.
- `message.send` валидирует payload через Zod.
- Сообщения сохраняются как plain text.
- Перед записью сообщения проверяется membership отправителя в чате.
- `clientNonce` используется для идемпотентности повторной отправки.
- После записи обновляются `chats.message_seq`, `chats.last_message_id`, `chats.updated_at` и unread counter для других участников.

## База данных

Схема описана в:

```text
apps/server/src/db/schema.ts
```

Первая миграция:

```text
apps/server/src/db/migrations/0000_initial_mvp.sql
```

Текущие таблицы:

- `users`
- `sessions`
- `chats`
- `chat_members`
- `direct_chats`
- `messages`

Текущие enum:

- `user_role`: `user`, `admin`
- `user_status`: `pending`, `active`, `rejected`, `disabled`
- `chat_type`: `direct`

Важные ограничения:

- `users.login` unique.
- `sessions.token_hash` unique.
- `chat_members(user_id, chat_id)` unique.
- `direct_chats(user_a_id, user_b_id)` unique.
- `direct_chats` хранит ordered user pair через check `user_a_id < user_b_id`.
- `messages(chat_id, seq)` unique.
- `messages(chat_id, client_nonce)` partial unique, только когда `client_nonce IS NOT NULL`.
- `chat_members` используется как главный access check для HTTP history API.
- При `message.send` сервер атомарно увеличивает `chats.message_seq`, создает запись в `messages`, обновляет `chats.last_message_id` и увеличивает unread counter другим участникам.
- При `POST /api/chats/:id/read` сервер записывает `chat_members.last_read_seq = chats.message_seq` и сбрасывает `chat_members.unread_count` текущего пользователя.

## Seed admin

Скрипт:

```text
apps/server/src/db/seed-admin.ts
```

Команда:

```powershell
npm run db:seed:admin
```

Behavior:

- Читает `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME`.
- Хеширует пароль через `argon2id`.
- Создает или обновляет пользователя с `role = admin`, `status = active`.
- Использует upsert по `users.login`.
- В текущем локальном окружении admin credentials сохранены в `.local/admin-credentials.txt`.

## Frontend

Entry:

```text
apps/web/src/main.ts
```

Root component:

```text
apps/web/src/app/x-app-shell.ts
```

State:

```text
apps/web/src/app/store.ts
```

Services:

```text
apps/web/src/services/api-client.ts
apps/web/src/services/ws-client.ts
```

Utils:

```text
apps/web/src/utils/linkify.ts
apps/web/src/utils/uuid.ts
```

Context menu:

```text
apps/web/src/components/context-menu/x-context-menu-root.ts
apps/web/src/components/context-menu/menu-registry.ts
apps/web/src/components/context-menu/types.ts
```

Tests:

```text
apps/server/test/http-ws.test.ts
```

Компоненты:

- `x-login-form`
- `x-register-form`
- `x-chat-list`
- `x-chat-card`
- `x-context-menu-root`
- `x-message-list`
- `x-message-bubble`
- `x-message-composer`

Особенности:

- Пользовательский текст сообщений рендерится через `TextNode` и безопасные DOM APIs, не через `innerHTML`.
- `linkifyText` разбирает plain text на текстовые части и ссылки для URL вида `http://`, `https://` и `www.`.
- Ссылки в сообщениях рендерятся отдельными `<a target="_blank" rel="noopener noreferrer">`.
- Финальная пунктуация вроде точки или запятой не включается в href ссылки.
- Основные UI-компоненты используют light DOM; Shadow DOM сейчас оставлен у `x-context-menu-root` как изолированный overlay-слой.
- События из компонентов отправляются с `bubbles: true` и `composed: true`, если должны доходить до shell или проходить через возможные Shadow DOM границы.
- Стили основного UI собираются из Sass partials через `apps/web/src/styles/index.scss`; компонентные `createStyles()` блоки убраны из app shell, форм, списка чатов, ленты, баблов и composer.
- Иконки подключены локально через Font Awesome Free SVG subset в `apps/web/public/vendor/fontawesome`; mask-стили живут в `apps/web/src/styles/_icons.scss`, а helper `apps/web/src/utils/fontawesome.ts` создает декоративные DOM-узлы без CDN.
- Общие button interactions вынесены в глобальный SCSS для light DOM; `apps/web/src/utils/button-interactions.ts` остается только для оставшихся Shadow DOM кнопок context menu.
- В приложении есть единый `x-context-menu-root`; дочерние компоненты открывают его через `app-context-menu`, а выбранные команды возвращаются в shell через `app-menu-command`.
- Команды context menu собираются в `menu-registry.ts`; сейчас доступны действия чата `Открыть чат`, `Пометить прочитанным` и действие сообщения `Копировать текст`.
- Context menu закрывается по Escape, outside click, scroll и resize; поддерживает ArrowUp/ArrowDown/Home/End/Enter/Space и touch/pen long press.
- `x-app-shell` восстанавливает сессию через `/api/auth/me`.
- Login/register/logout формы подключены к реальному `ApiClient`.
- `x-app-shell` содержит общий modal layer: `openModal` принимает заголовок, content builder и набор footer actions; auth login/register формы теперь открываются в этой модалке с вкладками.
- В Vite dev-режиме `x-login-form` показывает под заголовком `Вход` быстрые debug-кнопки для входа как `admin`, `user1` и `user2`; они используют обычное событие `auth-login-submit` и не меняют API auth flow. Поля входа компактные: `Логин` и `Пароль` показаны placeholder-ами внутри input, а кнопка `Войти` не растягивается на всю ширину формы.
- `x-register-form` использует browser validation, совпадающую с auth API: login минимум 3 символа, password минимум 8 символов, display name обязателен.
- Для пользователя с `role = admin` внизу sidebar под списком чатов закреплен компактный блок `Заявки`: после login/session restore frontend тихо проверяет наличие pending users через `AdminApprovalsController`, поэтому кнопка сразу показывает счетчик и подсветку; кнопка открывает modal со списком pending users через `GET /api/admin/pending-users`, а действия `Подтвердить` и `Отклонить` вызывают `POST /api/admin/users/:id/approve` и `POST /api/admin/users/:id/reject`.
- Admin approval API orchestration вынесена из `x-app-shell` в `apps/web/src/app/admin-approvals-controller.ts`; shell оставляет за собой только рендер панели и модалки.
- После approve/reject frontend убирает пользователя из локального списка заявок; поиск активных пользователей выполняется лениво при вводе запроса в sidebar.
- После login shell загружает direct chats через `/api/chats/direct`, а кандидатов для нового direct chat ищет через `/api/users?query=...` только при вводе в поисковую строку.
- `x-app-shell` синхронизирует выбранную беседу с URL hash `#/chat/<token>`: внутренний UUID chat id кодируется в короткий 22-символьный base64url token без миграции БД, а старые ссылки формата `#/chat/<uuid>` продолжают читаться. При входе по такой ссылке после восстановления сессии открывается эта беседа, если она есть в `/api/chats/direct` текущего пользователя.
- В authenticated sidebar над списком чатов есть компактное поле `поиск чатов` без внешней обертки и видимого лейбла: пустой поиск показывает мои direct chats, непустой поиск заменяет список результатами `GET /api/users?query=...`; выбор результата открывает существующий direct chat или вызывает `POST /api/chats/direct` и затем загружает историю.
- `x-chat-list` растянут до боковых краев sidebar через full-bleed layout: строки чатов плотные, без промежутков между соседями, а hover/active заливка идет без скруглений до краев сайдбара.
- `ApiClient` содержит методы для auth endpoints, user discovery endpoints и direct chats endpoints.
- `WebSocketClient` умеет подключаться к `/ws`, отправлять `ping`, отправлять `message.send`, переподключаться после обрыва, держать bounded queue событий, проверять соединение heartbeat/watchdog ping-pong и реагировать на browser `online/offline`.
- Для `message.send` клиент хранит неподтвержденные события до `message.ack` и повторно отправляет их после reconnect; `clientNonce` на сервере защищает от дублей. Reconnect использует exponential backoff с jitter и ограничением попыток, после чего переходит в `closed` до нового ручного действия или browser `online`.
- `x-message-composer` подключен к active chat и отправляет plain text сообщения через WebSocket.
- `x-message-composer` отправляет сообщение по Enter; Shift+Enter оставлен для переноса строки. На мобильной ширине кнопка отправки показывает локальную Font Awesome `paper-plane` вместо текстовой подписи.
- При открытии/создании чата и после отправки сообщения `x-app-shell` возвращает фокус в textarea composer.
- После submit frontend сразу добавляет optimistic local message в активную ленту и заменяет его серверной версией по `message.ack` через `clientNonce`, чтобы отправленное сообщение не пропадало из UI при задержке WebSocket acknowledgement.
- Для browser UUID используется `createUuid()` из `apps/web/src/utils/uuid.ts`, потому что `crypto.randomUUID()` недоступен в некоторых локальных HTTP-контекстах вроде `http://chat.local`.
- `MessageSummary` на frontend хранит `senderId`, raw `createdAt` и `createdAtMs`, чтобы лента могла безопасно считать визуальные группы без обращения к отображаемому тексту времени.
- `x-message-bubble` рендерит время сообщения в конце тела сообщения: перед `time` добавляется невидимый inline-spacer, а сам timestamp использует float-позиционирование, чтобы по возможности вставать на уровне последней строки и уходить ниже, если последняя строка занята текстом. Сам bubble имеет гибкую ширину по контенту, минимальную ширину около `20ch`, max-width `90%` от ширины ленты, без border; исходящие сообщения выравниваются по правому краю, а групповые углы на стороне сцепления заметно менее скруглены.
- `x-message-list` группирует соседние сообщения одного автора в пределах одного календарного дня, если между соседними сообщениями не больше 15 минут. В группе автор показывается только у верхнего входящего сообщения, у своих исходящих сообщений автор не показывается, а отступ между сгруппированными bubble уменьшен до 3px.
- `x-message-list` добавляет сервисные date-разделители по календарным дням; текущий верхний date-разделитель sticky внутри ленты, показывается при скролле и скрывается после короткой паузы, если он находится в закрепленном состоянии.
- `x-message-list` управляет скроллом ленты через собственный `scrollTop`: при открытии чата показывает низ истории, при новых сообщениях доскролливает вниз только если пользователь был не дальше 300px от нижнего края, а при чтении старых сообщений сохраняет позицию и показывает sticky-кнопку с локальной Font Awesome `chevron-down`; внешний viewport при этом не должен прокручиваться и уводить chat header с экрана.
- Свои исходящие сообщения являются исключением из порога 300px: после отправки frontend принудительно скроллит активную ленту к новому сообщению.
- История сообщений на frontend загружается страницами по 50: при открытии чата берется последняя страница, а при прокрутке к началу `x-message-list` отправляет `messages-load-older`, после чего `x-app-shell` запрашивает `/api/chats/:id/messages?limit=50&beforeSeq=<oldestSeq>` и добавляет старые сообщения сверху с сохранением позиции чтения.
- `x-app-shell` делает `x-message-list` scroll-контейнером на всю ширину `chat-body`, а внутреннюю колонку сообщений и composer ограничивает `max-width: 720px`; когда внешний `chat-body` сжимается до 720px и меньше, composer убирает внешний радиус и нижний отступ, чтобы прилепляться к краям контейнера.
- Основная оболочка держится в высоте viewport; страница не должна получать общий вертикальный скролл, скроллятся только внутренние области вроде списка сообщений и списка чатов.
- На мобильной ширине `x-app-shell` показывает либо список чатов, либо активную ленту: выбор/создание чата переключает в ленту, sticky-header остается сверху, а кнопка с локальной Font Awesome `chevron-left` в header возвращает к sidebar.
- Возврат из мобильной ленты в список чатов является detach-операцией: `activeChatId` сбрасывается, загруженная история очищается, hash-route чата убирается через `replaceState`; последующие realtime-события обновляют список/preview/unread, но не наполняют скрытую ленту и не вызывают `POST /api/chats/:id/read` без явного открытия чата.
- Все кнопки получают `cursor: pointer`, hover-затемнение и `focus-visible` outline через общий SCSS; disabled-кнопки возвращают обычный cursor.
- `x-app-shell` обрабатывает `message.ack` и `message.created`, обновляет preview чата и добавляет сообщения в локальную ленту только для открытого или уже загруженного чата.
- `x-app-shell` вызывает `POST /api/chats/:id/read` при открытии чата и при входящем сообщении в активный чат, локально сбрасывая unread badge сразу.
- После восстановления WebSocket `x-app-shell` перезагружает direct chats и историю активного чата, чтобы догнать сообщения, пропущенные во время разрыва; если reconnect показывает `session_required` или HTTP refresh получает `401`, frontend локально очищает сессию и возвращает экран входа.

## API/frontend notes

- `DirectChatSummary.lastMessage` includes `senderId`; frontend chat previews prefix the current user's own latest message with `Вы: `.
- Chat list activity label shows `HH:MM` for today's latest message, `Вчера` for yesterday, `дд мес.` for the current year and `дд.мм.гггг` for older years.

## Текущие ограничения

- Docker runtime пока не доступен в текущем окружении: установщик Docker Desktop скачивался и подпись была валидна, но установка падает на Windows 10 Pro 21H2 build 19044/inbox WSL.
- Full auth/admin HTTP flow проверен через запущенный server на живой БД.
- Direct chats HTTP API проверен на живой БД: создание idempotent, список с двух сторон, пустая история.
- Frontend flow создания direct chat реализован через глобальную поисковую строку над списком чатов и `POST /api/chats/direct`; production build и typecheck проверены.
- Realtime message send реализован и проверен live flow: два пользователя, два WebSocket соединения, `message.ack`, `message.created`, сохранение в HTTP history.
- Read marks и сброс unread counters при чтении реализованы через `POST /api/chats/:id/read`.
- Frontend WebSocket reconnect реализован с heartbeat/watchdog, online/offline handling, bounded jittered backoff и догрузкой состояния после восстановления; ручной browser check после перезапуска backend остается полезным перед полировкой MVP.
- Linkify renderer реализован на frontend; `messages.entities` пока остаются пустыми до server-side entity extraction.
- Context menu root реализован с первыми безопасными командами; destructive actions, reply/forward/quote и расширенные права команд отложены.
- Targeted backend tests добавлены через `tsx --test`: покрыты validation регистрации, session cookie login/me/logout, admin pending users approve/reject и WebSocket `message.send` -> `message.ack` без обращения к живой БД.
- Ручной smoke 2026-06-24 пройден на `chat.local`: создан и одобрен `smoke_mqsf8ubb`, создан direct chat с `admin`, отправлены сообщения в обе стороны через WebSocket, история вернула оба сообщения.
- Rate limit еще не подключен.
- Email, password reset, groups, attachments, replies, quotes and forwards отложены.
