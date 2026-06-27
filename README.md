# Nothing Shhh - Context Handoff

Дата контекста: 2026-06-21
Основная рабочая папка: `C:\Games\MySandbox`
Папка проекта: `C:\Games\MySandbox\nothing-chat`

Этот файл нужен как пакет передачи контекста новому Codex-чату. Он фиксирует не только желаемый функционал, но и уже принятые архитектурные решения, причины этих решений и локальные нюансы окружения.

## Текущее Состояние Workspace

- Новый основной путь: `C:\Games\MySandbox`.
- Старый путь: `C:\Users\AGA\Documents\Ничтофон`.
- Старый путь больше не трогать: это отдельная копия, не связанная с `C:\Games\MySandbox`.
- Визуальная привязка старых Codex-thread в sidebar может по-прежнему показывать `Ничтофон`, потому что thread хранит исходный workspace/root path. Это не значит, что надо продолжать писать туда.
- В новом пути Git был добавлен в `safe.directory`.
- Текущий Git remote: `https://github.com/ytppa/chot.git`.
- Основная ветка проекта: `main`.
- Перед push проверять `git status`, потому что в проекте может идти активная разработка с незакоммиченными изменениями.

## Цель Проекта

Создать веб-чат на WebSocket. Идти от простого к сложному.

Первый MVP:

- Авторизация логин/пароль.
- Регистрация создает профиль, но не дает доступ сразу.
- Админ подтверждает пользователя, после чего он получает доступ.
- Есть админская учетная запись.
- Почту пока не подключать.
- Позже почта нужна для периодических уведомлений о непрочитанных и восстановления пароля.
- Только личные чаты.
- Группы и каналы отложены.
- Сообщения plain text.
- Без markdown, bold, italic и прочего форматирования.
- Ссылки парсить и при выводе оборачивать в `<a>`.
- Пока без картинок, вложений, ответов, цитат, пересылок.

## Рекомендованный Стек

Frontend:

- TypeScript.
- Vite.
- Нативные Web Components.
- Shadow DOM выборочно, там где нужна инкапсуляция.
- Без React как основного UI-слоя.

Backend:

- Node.js LTS.
- Fastify.
- `@fastify/websocket` поверх `ws`.
- PostgreSQL.
- Drizzle ORM.
- Zod или Valibot для валидации протокола и HTTP payload.
- `argon2id` для паролей.
- Cookie-based session: opaque token в `HttpOnly`, `SameSite=Lax`, `Secure` на HTTPS.

Почему не React:

- Пользователь явно хочет, чтобы сообщения и плашки чатов были нативными веб-компонентами.
- React поверх custom elements и Shadow DOM часто добавляет слой адаптации: props/attributes, custom events, refs, lifecycle bridge.
- Для MVP проще и честнее использовать custom elements напрямую.
- Lit можно добавить позже точечно, если ручной рендеринг веб-компонентов станет слишком шумным.

Важные источники, которые уже смотрели:

- MDN Web Components: `https://developer.mozilla.org/en-US/docs/Web/API/Web_components`
- Fastify WebSocket: `https://github.com/fastify/fastify-websocket`
- Drizzle ORM overview: `https://orm.drizzle.team/docs/overview`
- Node.js releases: `https://nodejs.org/en/about/previous-releases`
- Telegram Web A: `https://github.com/Ajaxy/telegram-tt`
- Telegram Web K: `https://github.com/morethanwords/tweb`
- Open Server Panel docs: `https://github.com/OSPanel/OpenServerPanel/wiki/Документация`

## Предложенная Структура

```text
nothing-chat/
  apps/
    web/
      src/
        main.ts
        app/
          x-app-shell.ts
          store.ts
        services/
          api-client.ts
          ws-client.ts
        components/
          auth/
          chats/
            x-chat-list.ts
            x-chat-card.ts
          messages/
            x-message-list.ts
            x-message-bubble.ts
            x-message-composer.ts
          context-menu/
            x-context-menu-root.ts
            menu-registry.ts
          admin/
            x-pending-users.ts
        utils/
          linkify.ts
        styles/
          tokens.css

    server/
      src/
        index.ts
        config.ts
        db/
          schema.ts
          migrations/
        modules/
          auth/
          users/
          chats/
          messages/
        ws/
          gateway.ts
          protocol.ts
        http/
          routes/

  packages/
    shared/
      src/
        protocol.ts
        types.ts
        validation.ts

  docker-compose.yml
  README.md
```

Монорепо оправдано, потому что нужен общий пакет `shared` для типов WebSocket-событий, HTTP DTO и схем валидации.

## Модель Данных MVP

Минимальная схема, не закрывающая путь к будущим фичам:

```text
users
  id
  login
  password_hash
  display_name
  role: user | admin
  status: pending | active | rejected | disabled
  created_at
  verified_at nullable
  verified_by nullable -> users.id
  email nullable
  email_verified_at nullable

sessions
  id
  user_id -> users.id
  token_hash
  created_at
  expires_at
  revoked_at nullable

chats
  id
  type: direct
  created_at
  updated_at
  last_message_id nullable -> messages.id
  message_seq integer

chat_members
  chat_id -> chats.id
  user_id -> users.id
  joined_at
  last_read_seq integer
  unread_count integer

direct_chats
  chat_id -> chats.id
  user_a_id -> users.id
  user_b_id -> users.id
  unique(user_a_id, user_b_id)

messages
  id
  chat_id -> chats.id
  seq integer
  sender_id -> users.id
  body text
  entities jsonb
  client_nonce text nullable
  created_at
  edited_at nullable
  deleted_at nullable
```

Индексы:

```text
users.login unique
direct_chats(user_a_id, user_b_id) unique
chat_members(user_id, chat_id) unique
messages(chat_id, seq) unique
messages(chat_id, created_at)
sessions(token_hash) unique
```

## Сообщения И Ссылки

Сообщение хранится как plain text. HTML в БД не хранить.

Для ссылок:

- На вводе/сохранении можно вычислять `entities`.
- На выводе компонент рендерит текст через `TextNode`, а диапазоны ссылок через `<a>`.
- Не использовать `innerHTML` для пользовательского текста.
- `target="_blank"`, `rel="noopener noreferrer"` для внешних ссылок.

Пример `entities`:

```json
[
  { "type": "link", "offset": 12, "length": 24, "href": "https://example.com" }
]
```

## Вложения, Ответы, Пересылки

Изначальная идея пользователя: заложить связь `сообщение < вложения`, где вложением может быть файл, картинка, ответ, пересланное сообщение.

Рекомендованный подход: не смешивать реальные файлы и семантические связи.

Лучше так:

```text
message_files
  id
  message_id
  storage_key
  mime_type
  size
  width nullable
  height nullable
  created_at

message_relations
  id
  message_id
  relation_type: reply_to | forward_of | quote_of
  related_message_id
  snapshot jsonb nullable

message_entities
  optional, если jsonb в messages станет тесным
```

Причина: файл является ресурсом, а reply/forward/quote являются отношениями между сообщениями. В UI они могут выглядеть как похожие плашки, но в БД это разные сущности.

## Авторизация И Верификация

Поток регистрации:

1. Пользователь отправляет `login`, `password`, `displayName`.
2. Сервер создает `users.status = pending`.
3. Пользователь не может войти, пока `status != active`.
4. Админ видит список pending users.
5. Админ подтверждает или отклоняет.
6. После подтверждения пользователь может логиниться.

Админ:

- Seed из env: `ADMIN_LOGIN`, `ADMIN_PASSWORD`.
- Пароль хешируется `argon2id`.
- `role = admin`, `status = active`.

Сессии:

- Opaque token в cookie.
- В БД хранить hash токена, не сам токен.
- WebSocket upgrade читает cookie и восстанавливает сессию.

## HTTP API MVP

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me

GET  /api/admin/pending-users
POST /api/admin/users/:id/approve
POST /api/admin/users/:id/reject

GET  /api/chats
POST /api/chats/direct
GET  /api/chats/:id/messages?beforeSeq=&limit=
POST /api/chats/:id/read
```

HTTP оставляем для auth, initial load, admin actions и пагинации истории. WebSocket оставляем для realtime.

## WebSocket Протокол

Endpoint:

```text
/ws
```

Базовый envelope:

```ts
type ClientEvent = {
  id: string;
  type: string;
  payload: unknown;
  ts?: string;
};

type ServerEvent = {
  id?: string;
  type: string;
  payload: unknown;
  ts: string;
};
```

Client -> server:

```text
chat.open
message.send
read.mark
typing.set
ping
```

Server -> client:

```text
message.created
message.ack
chat.updated
read.updated
user.presence
error
pong
```

Для отправки сообщения:

```json
{
  "id": "evt_123",
  "type": "message.send",
  "payload": {
    "chatId": "...",
    "clientNonce": "uuid-from-client",
    "body": "hello https://example.com"
  }
}
```

`clientNonce` нужен для идемпотентности: если клиент переподключился и повторил отправку, сервер не должен создать дубль.

## Frontend Web Components

Базовые элементы:

```text
<x-app-shell>
<x-login-form>
<x-register-form>
<x-chat-list>
<x-chat-card>
<x-message-list>
<x-message-bubble>
<x-message-composer>
<x-context-menu-root>
<x-pending-users>
```

Рекомендации:

- Компоненты с пользовательским текстом не используют `innerHTML`.
- Для Shadow DOM использовать CSS custom properties для темизации.
- Для событий из Shadow DOM использовать `bubbles: true`, `composed: true`.
- Store можно начать с простого observable/event-target store без Redux.
- Позже для длинных списков сообщений нужна виртуализация.

## Контекстное Меню

Нужен единый сквозной слой контекстного меню для разных сущностей страницы.

Идея:

- Один `x-context-menu-root` висит на верхнем уровне приложения.
- Любая сущность диспатчит `app-context-menu`.
- В событии передаются тип сущности, id, координаты и исходный DOM target.
- `menu-registry.ts` собирает команды по `entityType` и правам пользователя.
- Root рендерит меню поверх всего.

Пример события:

```ts
this.dispatchEvent(new CustomEvent('app-context-menu', {
  bubbles: true,
  composed: true,
  detail: {
    entityType: 'message',
    entityId: message.id,
    point: { x: event.clientX, y: event.clientY }
  }
}));
```

Позиционирование:

```text
x = clamp(pointerX, margin, viewportWidth - menuWidth - margin)
y = pointerY + menuHeight > viewportHeight
  ? pointerY - menuHeight
  : pointerY
```

Поведение:

- Закрытие по Escape.
- Закрытие по outside click.
- Закрытие на scroll/resize.
- Keyboard navigation.
- Long press на touch.
- Команды могут быть disabled/hidden в зависимости от прав и состояния.

## Анализ Telegram Web

Смотрели публичные реализации:

Telegram Web A:

- Репозиторий: `https://github.com/Ajaxy/telegram-tt`
- Официальный клиент `web.telegram.org/a`.
- Победитель Telegram Lightweight Client Contest.
- Почти без зависимостей.
- Использует собственный Teact, который переосмысляет React-парадигму.
- Использует кастомный GramJS для MTProto.
- Имеет WebSockets, Web Workers, WebAssembly, PWA/cache, media streaming, optimistic/progressive UI, сложные CSS/Canvas/SVG animations.

Telegram Web K:

- Репозиторий: `https://github.com/morethanwords/tweb`
- Основан на Webogram.
- Использует Vite.
- В структуре есть `components/chat`, `dynamicVirtualList`, `stores`, `popups`.
- Есть IndexedDB/localStorage snapshots.
- Есть flags вроде `noSharedWorker=1`, `debug=1`.

Выводы для Nothing Shhh:

- Не нужен тяжелый фреймворк ради фреймворка.
- Критичны realtime state, аккуратный cache, виртуализация сообщений и единый overlay/popup слой.
- Начинать можно просто, но нельзя размазывать контекстные меню и popup-логику по компонентам.
- Список сообщений нельзя вечно рендерить целиком; виртуализация понадобится довольно рано.

## Open Server Panel И WebSocket

Локальный OpenServer установлен в:

```text
C:\Games\OSPanel
```

Проверено локально:

- `C:\Games\OSPanel\modules\Nginx-1.26\conf\nginx.conf` содержит `map $http_upgrade $connection_upgrade`.
- `virtual_proxied_host.conf` содержит `proxy_set_header Upgrade $http_upgrade` и `proxy_set_header Connection $connection_upgrade`.
- Значит WebSocket через Nginx reverse proxy в OSP должен работать.
- Для Nothing Shhh настроен отдельный OSP project/proxy `chat.local`; существующие OSP-домены не используются как часть этой настройки.
- Настройка воспроизводится через `scripts/configure-osp-chat-local.ps1`.

Dev-вариант 1, самый простой:

- Node/Fastify слушает `127.0.0.1:3000`.
- Frontend/Vite слушает свой порт.
- WebSocket: `ws://127.0.0.1:3000/ws`.

Dev-вариант 2, ближе к production:

- Домен: `https://chat.local`.
- Nginx OSP проксирует `/` на Vite `127.0.0.1:5173`.
- Nginx OSP проксирует `/api`, `/health` и `/ws` на Node/Fastify `127.0.0.1:3000`.
- WebSocket: `wss://chat.local/ws`.
- HTTP fallback для локальной проверки: `http://chat.local`.

Созданные OSP-файлы:

- OSP project: `C:\Games\OSPanel\home\chat.local`.
- Project config: `C:\Games\OSPanel\home\chat.local\.osp\project.ini`.
- Nginx include: `C:\Games\OSPanel\user\nginx\chat.local.conf`.
- Nginx template содержит include для `chat.local`, потому что OSP пересобирает активный `nginx.conf` при рестарте.
- Hosts содержит отдельный блок `NOTHING CHAT` для `chat.local` и `www.chat.local` на `127.127.126.55`.
- Существующие OSP hosts-записи остаются на своем IP `127.127.126.30`; настройка Nothing Shhh добавлена отдельным блоком.

Важный нюанс:

- Если страница открыта по `https://`, браузер может блокировать `ws://` как mixed content.
- Для HTTPS-страницы нужен `wss://`.
- HTTPS использует локальный OSP certificate `CN=chat.local`; если браузер не доверяет OSP root certificate, доверие нужно добавлять отдельно и осознанно.

Пример Nginx location:

```nginx
location /ws {
    proxy_pass http://127.0.0.1:3000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
}
```

OSP 6 проекты:

- Проект обычно лежит в `C:\Games\OSPanel\home\<domain>`.
- Внутри есть `.osp\project.ini`.
- Node запускается через `node_engine` и `start_command`.
- Документация говорит, что NVM в OSP управляется через `osp node ...`, а запуск приложения задается параметром `start_command`.

Для этого проекта исходники остаются в `C:\Games\MySandbox\nothing-chat`, а OSP project используется как доменная оболочка и reverse proxy.

## Безопасность MVP

Обязательное:

- Пароли только `argon2id`.
- Не хранить plain session token.
- Не рендерить пользовательский текст через `innerHTML`.
- Проверять доступ пользователя к чату на каждом HTTP и WS действии.
- Rate limit для login/register/message.send.
- WS max payload.
- На server-side валидировать все payload.

Отложить:

- 2FA.
- Email verification.
- Password reset.
- End-to-end encryption.
- Moderation tooling.

## Первые Практические Шаги

1. Инициализировать `nothing-chat` как npm workspace.
2. Создать `apps/server` на Fastify.
3. Создать health endpoint и `/ws` echo/ping.
4. Создать `apps/web` на Vite TypeScript без React.
5. Сделать `x-app-shell`, `x-login-form`, `x-chat-list`, `x-message-list`.
6. Подключить PostgreSQL через portable runtime или Docker Compose.
7. Описать Drizzle schema и первую миграцию.
8. Сделать seed admin.
9. Реализовать register/login/logout/me.
10. Реализовать pending user approval.
11. Реализовать direct chats и message.send через WebSocket.
12. Добавить linkify renderer.
13. Добавить единый context menu root.
14. Подключить OSP/Nginx proxy для `wss://` сценария: выполнено для `chat.local`.

## Открытые Вопросы

- Нужна ли Lit после первого MVP или держим ручные custom elements.

## Решенные Вопросы

- Локальный домен Open Server Panel: `chat.local`.
- Проект выделен в отдельный Git remote `https://github.com/ytppa/chot.git`.
- Основная ветка проекта: `main`.
- PostgreSQL для локальной разработки на текущем хосте: portable PostgreSQL 17.10 в `.local`.
- Docker Compose сохранен как опциональный будущий путь через `db:docker:*`.
- В текущей установке Open Server Panel нет PostgreSQL-модуля, поэтому OSP используется как локальный Nginx/HTTPS/WSS proxy.

## Команды Для Проверки Нового Пути

```powershell
Set-Location C:\Games\MySandbox
git status --short --branch
Get-ChildItem -Force
```

Если Git снова ругается на dubious ownership:

```powershell
git config --global --add safe.directory C:/Games/MySandbox
```

## Напоминание Новому Codex

Не писать в `C:\Users\AGA\Documents\Ничтофон`.
Работать из `C:\Games\MySandbox`.
Для будущего веб-чата использовать `C:\Games\MySandbox\nothing-chat`.
