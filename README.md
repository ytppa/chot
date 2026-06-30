# Nothing Shhh

Nothing Shhh is a small WebSocket-based web chat built as a TypeScript monorepo.

The current MVP focuses on private text conversations: registration, login, manual user approval by an admin, direct chats, realtime message delivery, read marks, reconnect handling, and safe plain-text rendering with link detection.

## Features

- Login/password authentication.
- User registration with pending approval.
- Admin approval and rejection flow.
- Cookie-based sessions with opaque session tokens.
- Direct one-to-one chats.
- Realtime messaging over WebSocket.
- Message history pagination.
- Read marks and unread counters.
- Optimistic outgoing messages with `clientNonce` deduplication.
- WebSocket reconnect with heartbeat/watchdog checks.
- Plain text messages with safe link rendering.
- Native Web Components frontend without React.
- Local Font Awesome SVG icons without CDN dependencies.

## Tech Stack

Frontend:

- TypeScript.
- Vite.
- Sass.
- Native Web Components.
- Light DOM for the main UI.
- Shadow DOM only where isolation is useful, such as the floating command menu.

Backend:

- Node.js.
- Fastify.
- `@fastify/websocket` over `ws`.
- `@fastify/cookie`.
- PostgreSQL.
- Drizzle ORM.
- Zod validation.
- `argon2id` password hashing through `argon2`.

Shared:

- `packages/shared` contains DTOs and WebSocket protocol types used by both frontend and backend.

## Project Structure

```text
apps/
  web/
    src/
      app/
      components/
      services/
      styles/
      utils/

  server/
    src/
      db/
      http/
      modules/
      ws/

packages/
  shared/
    src/
```

## Requirements

- Node.js 22 or newer.
- npm 8 or newer.
- PostgreSQL.

For local Windows development this project can use the portable PostgreSQL runtime managed by `scripts/pg-portable.ps1`. Docker Compose is also present as an optional future path for PostgreSQL.

## Environment

Copy `.env.example` to `.env` and adjust values as needed:

```powershell
Copy-Item .env.example .env
```

Important variables:

- `DATABASE_URL`
- `SESSION_COOKIE_NAME`
- `SESSION_TTL_DAYS`
- `ADMIN_LOGIN`
- `ADMIN_PASSWORD`
- `ADMIN_DISPLAY_NAME`
- `WS_MAX_PAYLOAD_BYTES`

## Install

```powershell
npm install
```

## Database

Start local portable PostgreSQL:

```powershell
npm run db:up
```

Apply migrations:

```powershell
npm run db:migrate
```

Create or update the admin user:

```powershell
npm run db:seed:admin
```

Useful database commands:

```powershell
npm run db:status
npm run db:logs
npm run db:down
```

Optional Docker Compose commands:

```powershell
npm run db:docker:up
npm run db:docker:status
npm run db:docker:logs
npm run db:docker:down
```

## Development

Run the backend:

```powershell
npm run dev:server
```

Run the frontend:

```powershell
npm run dev:web -- --port 5173
```

By default:

- Backend listens on `127.0.0.1:3000`.
- Frontend is served by Vite.
- WebSocket endpoint is `/ws`.

## Scripts

```powershell
npm run typecheck
npm test
npm run build --workspace @nothing-chat/web
npm run build --workspace @nothing-chat/server
```

Workspace-level build:

```powershell
npm run build
```

## API Overview

Auth:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

Admin:

```text
GET  /api/admin/pending-users
POST /api/admin/users/:id/approve
POST /api/admin/users/:id/reject
```

Users and chats:

```text
GET  /api/users
GET  /api/chats/direct
POST /api/chats/direct
GET  /api/chats/:id/messages
POST /api/chats/:id/read
```

WebSocket:

```text
GET /ws
```

Implemented client events:

- `ping`
- `message.send`

Implemented server events:

- `pong`
- `message.ack`
- `message.created`
- `error`

## Security Notes

- Passwords are hashed with `argon2id`.
- Session tokens are stored as hashes in the database.
- Session cookies are `HttpOnly`.
- HTTPS/production cookies use `Secure`.
- Cookies use `SameSite=Lax`.
- WebSocket payload size is limited.
- User message text is rendered through DOM text APIs, not `innerHTML`.
- API and WebSocket errors use structured envelopes and should not expose sensitive internals.

## Current Limitations

- Rate limiting is not connected yet.
- Link entities are rendered on the frontend; server-side entity extraction is still pending.
- Only direct chats are supported.
- Groups, channels, attachments, images, replies, quotes, forwards, markdown, rich text formatting, email notifications, and password reset are deferred.
- Message list virtualization is planned for larger histories.
