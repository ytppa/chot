import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';

import type {
  AuthUserResponse,
  ClientEventEnvelope,
  DirectChatSummary,
  MessageDto,
  PublicUser,
  SendMessagePayload,
  ServerEventEnvelope
} from '@nothing-chat/shared';

import { buildServer, type AppServices } from '../src/app.js';
import type { ServerConfig } from '../src/config.js';
import { DomainError } from '../src/modules/common/domain-error.js';

type TestUser = PublicUser & {
  password: string;
};

type TestState = {
  users: Map<string, TestUser>;
  sessions: Map<string, string>;
  approvedUserIds: string[];
  rejectedUserIds: string[];
  sentMessages: SendMessagePayload[];
};

const adminUser: TestUser = {
  id: '00000000-0000-4000-8000-000000000001',
  login: 'admin',
  displayName: 'Admin',
  role: 'admin',
  status: 'active',
  password: 'admin'
};

const activeUser: TestUser = {
  id: '00000000-0000-4000-8000-000000000002',
  login: 'active',
  displayName: 'Active User',
  role: 'user',
  status: 'active',
  password: 'password123'
};

const baseConfig: ServerConfig = {
  nodeEnv: 'test',
  isProduction: false,
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  websocketMaxPayloadBytes: 64 * 1024,
  sessionCookieName: 'nothing_chat_session',
  sessionTtlDays: 30
};

describe('server http and websocket MVP contracts', () => {
  let server: FastifyInstance;
  let state: TestState;

  before(async () => {
    state = createTestState();
    server = await buildServer(baseConfig, createTestServices(state));
  });

  after(async () => {
    await server.close();
  });

  test('validates registration payload before creating a pending account', async () => {
    const invalidResponse = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        login: 'u2',
        password: 'short',
        displayName: 'Short Password'
      }
    });

    assert.equal(invalidResponse.statusCode, 400);
    assert.equal(invalidResponse.json().error.code, 'validation_error');

    const validResponse = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        login: 'new-user',
        password: 'password123',
        displayName: 'New User'
      }
    });

    assert.equal(validResponse.statusCode, 201);
    assert.equal((validResponse.json() as AuthUserResponse).user.status, 'pending');
  });

  test('sets a session cookie on login and revokes it on logout', async () => {
    const loginResponse = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        login: 'admin',
        password: 'admin'
      }
    });

    assert.equal(loginResponse.statusCode, 200);

    const rawSetCookie = readRawCookieHeader(loginResponse.headers['set-cookie']);
    assert.match(rawSetCookie, /HttpOnly/i);

    const cookieHeader = toRequestCookieHeader(rawSetCookie);

    const meResponse = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        cookie: cookieHeader
      }
    });

    assert.equal(meResponse.statusCode, 200);
    assert.equal((meResponse.json() as AuthUserResponse).user.login, 'admin');

    const logoutResponse = await server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: cookieHeader
      }
    });

    assert.equal(logoutResponse.statusCode, 204);

    const expiredMeResponse = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        cookie: cookieHeader
      }
    });

    assert.equal(expiredMeResponse.statusCode, 401);
  });

  test('lets an admin list, approve, and reject pending users', async () => {
    const cookieHeader = await loginAndReadCookie(server, 'admin', 'admin');
    const approveTarget = addPendingUser(state, 'pending-approve', 'Pending Approve');
    const rejectTarget = addPendingUser(state, 'pending-reject', 'Pending Reject');

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/admin/pending-users',
      headers: {
        cookie: cookieHeader
      }
    });

    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(
      listResponse.json().users.map((user: PublicUser) => user.login).sort(),
      ['new-user', 'pending-approve', 'pending-reject']
    );

    const approveResponse = await server.inject({
      method: 'POST',
      url: `/api/admin/users/${approveTarget.id}/approve`,
      headers: {
        cookie: cookieHeader
      }
    });

    assert.equal(approveResponse.statusCode, 200);
    assert.equal((approveResponse.json() as AuthUserResponse).user.status, 'active');
    assert.deepEqual(state.approvedUserIds, [approveTarget.id]);

    const rejectResponse = await server.inject({
      method: 'POST',
      url: `/api/admin/users/${rejectTarget.id}/reject`,
      headers: {
        cookie: cookieHeader
      }
    });

    assert.equal(rejectResponse.statusCode, 200);
    assert.equal((rejectResponse.json() as AuthUserResponse).user.status, 'rejected');
    assert.deepEqual(state.rejectedUserIds, [rejectTarget.id]);
  });

  test('acknowledges websocket message sends for authenticated sockets', async () => {
    const listenUrl = await server.listen({ host: '127.0.0.1', port: 0 });
    const cookieHeader = await loginAndReadCookie(server, 'active', 'password123');
    const socket = new WebSocket(listenUrl.replace('http://', 'ws://') + '/ws', {
      headers: {
        cookie: cookieHeader
      }
    });

    try {
      await waitForSocketOpen(socket);

      const event: ClientEventEnvelope<SendMessagePayload> = {
        id: randomUUID(),
        type: 'message.send',
        payload: {
          chatId: '00000000-0000-4000-8000-00000000c001',
          body: 'Hello through websocket',
          clientNonce: randomUUID()
        }
      };

      socket.send(JSON.stringify(event));

      const response = await readSocketEvent(socket);
      assert.equal(response.id, event.id);
      assert.equal(response.type, 'message.ack');
      assert.equal(state.sentMessages.length, 1);
      assert.equal(state.sentMessages[0]?.body, 'Hello through websocket');
    } finally {
      socket.close();
    }
  });
});

/**
 * Creates isolated mutable state for fake services used by route-level tests.
 */
function createTestState(): TestState {
  return {
    users: new Map([
      [adminUser.login, { ...adminUser }],
      [activeUser.login, { ...activeUser }]
    ]),
    sessions: new Map(),
    approvedUserIds: [],
    rejectedUserIds: [],
    sentMessages: []
  };
}

/**
 * Creates fake app services that preserve route contracts without touching a database.
 */
function createTestServices(state: TestState): AppServices {
  return {
    authService: {
      register: async (input) => {
        if (state.users.has(input.login)) {
          throw new DomainError({
            code: 'login_taken',
            statusCode: 409,
            publicMessage: 'Login is already taken.'
          });
        }

        const user = addPendingUser(state, input.login, input.displayName, input.password);
        return toPublicUser(user);
      },
      login: async (input) => {
        const user = state.users.get(input.login);
        if (!user || user.password !== input.password) {
          throw new DomainError({
            code: 'invalid_credentials',
            statusCode: 401,
            publicMessage: 'Invalid login or password.'
          });
        }

        if (user.status !== 'active') {
          throw new DomainError({
            code: 'account_not_active',
            statusCode: 403,
            publicMessage: 'Account is not active.'
          });
        }

        const token = `session-${randomUUID()}`;
        state.sessions.set(token, user.login);

        return {
          user: toPublicUser(user),
          token,
          expiresAt: new Date(Date.now() + 60_000)
        };
      },
      logout: async (sessionToken) => {
        state.sessions.delete(sessionToken);
      },
      resolveSession: async (sessionToken) => {
        const login = state.sessions.get(sessionToken);
        const user = login ? state.users.get(login) : undefined;
        return user && user.status === 'active' ? toPublicUser(user) : null;
      }
    },
    adminService: {
      listPendingUsers: async (actor) => {
        assertAdminActor(actor);
        return Array.from(state.users.values())
          .filter((user) => user.status === 'pending')
          .map(toPublicUser);
      },
      approveUser: async (actor, userId) => {
        return reviewPendingUser(state, actor, userId, 'active');
      },
      rejectUser: async (actor, userId) => {
        return reviewPendingUser(state, actor, userId, 'rejected');
      }
    },
    userService: {
      listActiveUsers: async (actor) => {
        if (actor.status !== 'active') {
          throwForbidden();
        }

        return Array.from(state.users.values())
          .filter((user) => user.status === 'active' && user.id !== actor.id)
          .map(toPublicUser);
      }
    },
    chatService: {
      listDirectChats: async () => [],
      createDirectChat: async (actor, targetUserId) => createDirectChatSummary(actor, targetUserId),
      listMessages: async () => ({ messages: [], hasMore: false }),
      markChatRead: async (_actor, chatId) => ({
        chatId,
        lastReadSeq: 0,
        unreadCount: 0
      }),
      sendMessage: async (actor, input) => {
        state.sentMessages.push(input);

        return {
          message: createMessageDto(actor, input),
          participantUserIds: [actor.id, adminUser.id]
        };
      }
    }
  };
}

/**
 * Adds a pending user to fake service state for admin review tests.
 */
function addPendingUser(
  state: TestState,
  login: string,
  displayName: string,
  password = 'password123'
): TestUser {
  const user: TestUser = {
    id: randomUUID(),
    login,
    displayName,
    role: 'user',
    status: 'pending',
    password
  };

  state.users.set(login, user);
  return user;
}

/**
 * Moves a fake pending user to the selected final review status.
 */
function reviewPendingUser(
  state: TestState,
  actor: PublicUser,
  userId: string,
  status: 'active' | 'rejected'
): PublicUser {
  assertAdminActor(actor);

  const user = Array.from(state.users.values()).find((item) => item.id === userId);
  if (!user || user.status !== 'pending') {
    throw new DomainError({
      code: 'pending_user_not_found',
      statusCode: 404,
      publicMessage: 'Pending user was not found.'
    });
  }

  user.status = status;
  if (status === 'active') {
    state.approvedUserIds.push(user.id);
  } else {
    state.rejectedUserIds.push(user.id);
  }

  return toPublicUser(user);
}

/**
 * Ensures fake admin service calls receive an active administrator.
 */
function assertAdminActor(actor: PublicUser): void {
  if (actor.role !== 'admin' || actor.status !== 'active') {
    throwForbidden();
  }
}

/**
 * Throws the same public forbidden error used by database-backed services.
 */
function throwForbidden(): never {
  throw new DomainError({
    code: 'forbidden',
    statusCode: 403,
    publicMessage: 'Forbidden.'
  });
}

/**
 * Converts fake users to public DTOs without leaking password data.
 */
function toPublicUser(user: TestUser): PublicUser {
  return {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    role: user.role,
    status: user.status
  };
}

/**
 * Creates a minimal direct chat summary for route contract tests.
 */
function createDirectChatSummary(actor: PublicUser, targetUserId: string): DirectChatSummary {
  return {
    id: '00000000-0000-4000-8000-00000000c001',
    type: 'direct',
    peer: {
      id: targetUserId,
      login: 'target',
      displayName: 'Target User',
      role: 'user',
      status: 'active'
    },
    unreadCount: 0,
    updatedAt: new Date().toISOString(),
    lastMessage: {
      id: '00000000-0000-4000-8000-00000000m001',
      senderId: actor.id,
      body: `Created by ${actor.login}`,
      createdAt: new Date().toISOString()
    }
  };
}

/**
 * Creates a message DTO returned by the fake realtime chat service.
 */
function createMessageDto(actor: PublicUser, input: SendMessagePayload): MessageDto {
  return {
    id: randomUUID(),
    chatId: input.chatId,
    seq: 1,
    senderId: actor.id,
    senderDisplayName: actor.displayName,
    body: input.body.trim(),
    entities: [],
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null
  };
}

/**
 * Logs into the injected app and returns a cookie header for follow-up requests.
 */
async function loginAndReadCookie(
  server: FastifyInstance,
  login: string,
  password: string
): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      login,
      password
    }
  });

  assert.equal(response.statusCode, 200);
  return toRequestCookieHeader(readRawCookieHeader(response.headers['set-cookie']));
}

/**
 * Reads the raw Set-Cookie header returned by Fastify.
 */
function readRawCookieHeader(value: number | string | string[] | undefined): string {
  assert.ok(value, 'Expected set-cookie header.');

  const rawCookie = Array.isArray(value) ? value[0] : String(value);
  assert.ok(rawCookie, 'Expected a non-empty set-cookie header.');

  return rawCookie;
}

/**
 * Converts a Set-Cookie header into the Cookie header format used by requests.
 */
function toRequestCookieHeader(rawCookie: string): string {
  return rawCookie.split(';')[0] ?? rawCookie;
}

/**
 * Resolves when a WebSocket client is connected.
 */
function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

/**
 * Reads and parses one server event from a WebSocket client.
 */
function readSocketEvent(socket: WebSocket): Promise<ServerEventEnvelope> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()) as ServerEventEnvelope);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Invalid websocket JSON.'));
      }
    });
    socket.once('error', reject);
  });
}
