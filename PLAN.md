# Nothing Shhh - Development Plan

Дата актуализации: 2026-06-30

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
- `DONE` Этап 4: локальный PostgreSQL поднят через portable EDB binaries; Drizzle migration применена, admin seed выполнен.
- `DONE` Этап 5: auth и admin flow реализован на уровне HTTP routes и DB-backed services.
- `DONE` Этап 6: direct chats HTTP API, membership checks, загрузка истории и frontend creation flow реализованы.
- `DONE` Этап 7: базовый realtime message flow, read marks, сброс unread, frontend reconnect и heartbeat/watchdog устойчивость соединения реализованы.
- `DONE` Этап 8: linkify parser и безопасный рендер ссылок в plain text сообщениях реализованы.
- `DONE` Этап 9: единый context menu root, registry команд, keyboard navigation, outside close и touch long press реализованы.
- `DONE` Этап 11: frontend-пагинация истории сообщений реализована: при открытии чата загружаются 50 последних сообщений, старые сообщения догружаются страницами по 50 при прокрутке к началу ленты.
- `DONE` Этап 12: лента сообщений получила группировку по дням и авторам, sticky date-разделители, правое выравнивание своих сообщений и ограничение рабочей chat-колонки до 720px.
- `DONE` Open Server Panel proxy для `chat.local` настроен: `/` идет на Vite, `/api`, `/health` и `/ws` идут на Fastify; HTTP/WS и HTTPS/WSS проверены.
- `DONE` Admin approval UI добавлен в sidebar: админ может открыть список pending users, подтвердить или отклонить заявку.
- `DONE` Frontend styles migrated from component `createStyles()` blocks to Sass partials; main UI components now use light DOM, `x-context-menu-root` keeps Shadow DOM isolation.
- `DONE` CSS-first темизация интерфейса добавлена: системная тема работает через `prefers-color-scheme`, ручной выбор `light`/`dark` хранится локально в браузере.

## Ближайший Фокус

1. `DONE` Инициализировать npm workspace в корне проекта.
2. `DONE` Создать каркас `apps/server` на Fastify.
3. `DONE` Добавить health endpoint и базовый `/ws` ping/echo.
4. `DONE` Создать каркас `apps/web` на Vite + TypeScript без React.
5. `DONE` Создать `packages/shared` для общих типов и протокола.
6. `DONE` Выбрать PostgreSQL runtime: portable PostgreSQL для текущего хоста, Docker Compose оставить опционально.
7. `DONE` Поднять PostgreSQL, применить миграции и выполнить admin seed на живой БД.
8. `DONE` Проверить auth/admin HTTP flow на живой БД.
9. `DONE` Начать этап 6: direct chats HTTP API.
10. `DONE` Добавить frontend flow для создания direct chat.
11. `DONE` Реализовать базовый realtime message send через WebSocket.
12. `DONE` Добавить read marks и сброс unread.
13. `DONE` Добавить frontend reconnect-сценарии.
14. `DONE` Начать этап 8: linkify renderer для plain text сообщений.
15. `DONE` Этап 9: UI actions и стабилизация MVP - context menu root, registry, keyboard/touch управление и проверки сборки.
16. `DONE` Этап 10: targeted tests для auth, sessions, admin approve/reject и WebSocket message send добавлены; ручной smoke базового user flow пройден.
17. `DONE` Этап 11: frontend-пагинация истории сообщений по 50 с догрузкой старых страниц при прокрутке вверх.
18. `DONE` Этап 12: визуальная логика ленты сообщений - группировка соседних сообщений, date-разделители, sticky текущая дата, правое выравнивание исходящих сообщений и max-width 720px для chat-колонки.
19. `DONE` Этап 13: CSS-first темизация интерфейса с системным режимом и ручным выбором светлой/темной темы.

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

- `DONE` Определиться: на текущем хосте использовать portable PostgreSQL, Docker Compose оставить как опциональный путь.
- `DONE` Добавить `docker-compose.yml` для будущего Docker-варианта локального PostgreSQL.
- `DONE` Добавить npm scripts для `db:up`, `db:down`, `db:status`, `db:logs` через portable PostgreSQL.
- `DONE` Добавить optional npm scripts `db:docker:*` для Docker Compose.
- `DONE` Подключить PostgreSQL к server app через `DATABASE_URL` и typed database client.
- `DONE` Описать Drizzle schema.
- `DONE` Создать первую миграцию.
- `DONE` Добавить seed admin из env.
- `DONE` Поднять PostgreSQL 17.10 из portable EDB binaries в `.local`.
- `DONE` Применить Drizzle migration на живой БД.
- `DONE` Выполнить admin seed на живой БД.

## Этап 5 - Auth И Admin Flow

- `DONE` Реализовать регистрацию пользователя со статусом `pending`.
- `DONE` Реализовать login/logout/me.
- `DONE` Хранить hash session token в БД.
- `DONE` Подключить cookie-based sessions.
- `DONE` Реализовать список pending users для админа.
- `DONE` Реализовать approve/reject пользователей.
- `DONE` Добавить frontend UI для просмотра pending users и действий approve/reject.
- `DONE` Проверить полный auth/admin HTTP flow на живой БД через запущенный server.

## Этап 6 - Direct Chats

- `DONE` Реализовать HTTP API списка личных чатов.
- `DONE` Реализовать HTTP API создания direct chat.
- `DONE` Проверять membership на HTTP чтении истории сообщений.
- `DONE` Добавить загрузку истории сообщений с пагинацией.
- `DONE` Добавить shared DTO для direct chats и messages.
- `DONE` Добавить frontend flow для создания direct chat.
- `DEFERRED` Проверять membership на будущих WS chat/message действиях в этапе 7.

## Этап 7 - Realtime Messages

- `DONE` Описать WebSocket protocol в `packages/shared`.
- `DONE` Авторизовать WebSocket соединение через session cookie.
- `DONE` Реализовать `message.send`.
- `DONE` Реализовать `message.created`.
- `DONE` Реализовать `message.ack`.
- `DONE` Использовать `clientNonce` для идемпотентности.
- `DONE` Сохранять сообщения в БД и обновлять `last_message_id`, `message_seq` и unread для других участников.
- `DONE` Подключить frontend composer к WebSocket отправке.
- `DONE` Реализовать read marks и сброс unread counters при чтении.
- `DONE` Добавить frontend reconnect, bounded queue, heartbeat/watchdog, online/offline handling и повторную отправку неподтвержденных `message.send`.

## Этап 8 - Message Rendering

- `DONE` Добавить linkify parser.
- `DONE` Хранить сообщения как plain text.
- `DONE` Рендерить пользовательский текст безопасно через текстовые DOM APIs.
- `DONE` Рендерить ссылки отдельными `<a>` элементами.
- `DONE` Не использовать `innerHTML` для пользовательского текста.

## Этап 9 - UI actions и стабилизация MVP

- `DONE` Создать единый `x-context-menu-root`.
- `DONE` Добавить событие `app-context-menu`.
- `DONE` Добавить событие `app-menu-command`.
- `DONE` Добавить `menu-registry.ts`.
- `DONE` Реализовать закрытие по Escape, outside click, scroll и resize.
- `DONE` Добавить keyboard navigation.
- `DONE` Добавить long press для touch.
- `DONE` Подключить первые команды меню для чатов и сообщений.
- `DONE` Прогнать typecheck/build после UI-изменений.

## Этап 10 - Проверки И Стабилизация MVP

- `DONE` Добавить targeted tests для auth, sessions, admin approve/reject и WebSocket message send.
- `DONE` Добавить typecheck во все workspace packages.
- `DONE` Проверить базовый user flow вручную: регистрация, approve админом, login, direct chat и WebSocket сообщения в обе стороны.
- `DONE` Проверить, что пользовательский текст не рендерится через `innerHTML`.
- `DONE` Проверить WebSocket reconnect сценарии на уровне сборки и frontend client logic.

## Этап 11 - Пагинация Истории Сообщений

- `DONE` При открытии активного чата загружать последнюю страницу истории размером 50 сообщений.
- `DONE` Хранить для чата `hasMore`, `oldestSeq`, `pageSize` и состояние загрузки старых сообщений.
- `DONE` При прокрутке к началу ленты догружать предыдущую страницу через `beforeSeq`.
- `DONE` После добавления старых сообщений сверху сохранять текущую позицию чтения через scroll anchor.

## Этап 12 - Визуальная Логика Ленты Сообщений

- `DONE` Группировать соседние сообщения одного автора, если между ними не больше 15 минут и они находятся в одном календарном дне.
- `DONE` В группе показывать автора только у верхнего сообщения, а расстояние между сгруппированными сообщениями уменьшить до 3px.
- `DONE` Добавить сервисные date-разделители по календарным дням и сделать текущий верхний разделитель sticky внутри ленты.
- `DONE` Выравнивать свои исходящие сообщения по правому краю.
- `DONE` Ограничить общую ширину ленты и composer до 720px.

## Этап 13 - Темизация Интерфейса

- `DONE` Вынести светлую и темную палитру в CSS custom properties в `apps/web/src/styles/_tokens.scss`.
- `DONE` Оставить системный режим нативным через `prefers-color-scheme` без backend-состояния.
- `DONE` Добавить ручной выбор `light`/`dark` через root `data-theme` и локальное хранение предпочтения в `localStorage`.
- `DONE` Добавить компактный native select темы в `x-app-shell` без отдельной UI-библиотеки.

## Отложено

- `DEFERRED` Email notifications.
- `DEFERRED` Password reset.
- `DEFERRED` Email verification.
- `DEFERRED` Groups and channels.
- `DEFERRED` Attachments and images.
- `DEFERRED` Replies, quotes and forwards.
- `DEFERRED` Markdown and rich text formatting.
- `DEFERRED` Message list virtualization.

## Открытые Решения

- `DONE` Выбрать PostgreSQL для текущего хоста: portable PostgreSQL 17.10.
- `DEFERRED` Вернуться к Docker Desktop после обновления Windows/WSL до требований Docker, если он понадобится.
- `DONE` Выбрать локальный домен для OSP: `chat.local`.
- `DONE` Настроить Open Server Panel HTTPS/WSS proxy для `chat.local`.
- `TODO` Решить, нужен ли Lit после первого MVP.
- `TODO` Определить момент, когда нужна виртуализация сообщений.
