import { and, desc, eq, lt, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type {
  DirectChatSummary,
  MessageDto,
  PublicUser,
  ReadChatResponse,
  SendMessagePayload
} from '@nothing-chat/shared';

import type { Database } from '../../db/client.js';
import { chatMembers, chats, directChats, messages, users } from '../../db/schema.js';
import { createServiceUnavailableError, DomainError } from '../common/domain-error.js';

export type MessagePage = {
  messages: MessageDto[];
  hasMore: boolean;
};

export type MessagePageOptions = {
  limit: number;
  beforeSeq: number | null;
};

export type MessageDelivery = {
  message: MessageDto;
  participantUserIds: string[];
};

export type ChatService = {
  listDirectChats: (actor: PublicUser) => Promise<DirectChatSummary[]>;
  createDirectChat: (actor: PublicUser, targetUserId: string) => Promise<DirectChatSummary>;
  listMessages: (
    actor: PublicUser,
    chatId: string,
    options: MessagePageOptions
  ) => Promise<MessagePage>;
  markChatRead: (actor: PublicUser, chatId: string) => Promise<ReadChatResponse>;
  sendMessage: (actor: PublicUser, input: SendMessagePayload) => Promise<MessageDelivery>;
};

const userA = alias(users, 'direct_user_a');
const userB = alias(users, 'direct_user_b');
const messageSender = alias(users, 'message_sender');

/**
 * Creates the database-backed chat service for direct chat workflows.
 */
export function createDatabaseChatService(db: Database): ChatService {
  return {
    listDirectChats: async (actor) => listDirectChats(db, actor),
    createDirectChat: async (actor, targetUserId) => createDirectChat(db, actor, targetUserId),
    listMessages: async (actor, chatId, options) => listMessages(db, actor, chatId, options),
    markChatRead: async (actor, chatId) => markChatRead(db, actor, chatId),
    sendMessage: async (actor, input) => sendMessage(db, actor, input)
  };
}

/**
 * Creates a chat service that fails safely when the database is not configured.
 */
export function createUnavailableChatService(): ChatService {
  return {
    listDirectChats: async () => {
      throw createServiceUnavailableError();
    },
    createDirectChat: async () => {
      throw createServiceUnavailableError();
    },
    listMessages: async () => {
      throw createServiceUnavailableError();
    },
    markChatRead: async () => {
      throw createServiceUnavailableError();
    },
    sendMessage: async () => {
      throw createServiceUnavailableError();
    }
  };
}

/**
 * Lists direct chats visible to the current active user.
 */
async function listDirectChats(db: Database, actor: PublicUser): Promise<DirectChatSummary[]> {
  assertActiveActor(actor);

  const rows = await selectDirectChatRows(db, actor.id);
  return rows.map((row) => mapDirectChatRow(row, actor.id));
}

/**
 * Creates or returns the direct chat between the current user and target user.
 */
async function createDirectChat(
  db: Database,
  actor: PublicUser,
  targetUserId: string
): Promise<DirectChatSummary> {
  assertActiveActor(actor);

  const [targetUser] = await db
    .select(createPublicUserSelection())
    .from(users)
    .where(and(eq(users.id, targetUserId), eq(users.status, 'active')))
    .limit(1);

  if (!targetUser) {
    throw new DomainError({
      code: 'target_user_not_found',
      statusCode: 404,
      publicMessage: 'Target user was not found.'
    });
  }

  if (targetUser.id === actor.id) {
    throw new DomainError({
      code: 'cannot_chat_with_self',
      statusCode: 400,
      publicMessage: 'Cannot create a direct chat with yourself.'
    });
  }

  const [userAId, userBId] = orderUserPair(actor.id, targetUser.id);
  const existingChatId = await findDirectChatId(db, userAId, userBId);
  if (existingChatId) {
    return getDirectChatById(db, actor, existingChatId);
  }

  try {
    const createdChatId = await db.transaction(async (tx) => {
      // Create the chat root first so membership and direct-chat metadata share one id.
      const [createdChat] = await tx
        .insert(chats)
        .values({
          type: 'direct'
        })
        .returning({
          id: chats.id
        });

      if (!createdChat) {
        throw new DomainError({
          code: 'chat_create_failed',
          statusCode: 500,
          publicMessage: 'Could not create chat.'
        });
      }

      // Store the ordered pair to keep the direct chat unique regardless of initiator.
      await tx.insert(directChats).values({
        chatId: createdChat.id,
        userAId,
        userBId
      });

      // Add both participants immediately so future access checks are membership-based.
      await tx.insert(chatMembers).values([
        {
          chatId: createdChat.id,
          userId: userAId
        },
        {
          chatId: createdChat.id,
          userId: userBId
        }
      ]);

      return createdChat.id;
    });

    return getDirectChatById(db, actor, createdChatId);
  } catch (error) {
    if (hasDatabaseCode(error, '23505')) {
      const racedChatId = await findDirectChatId(db, userAId, userBId);
      if (racedChatId) {
        return getDirectChatById(db, actor, racedChatId);
      }
    }

    throw error;
  }
}

/**
 * Loads a page of messages after verifying that the actor belongs to the chat.
 */
async function listMessages(
  db: Database,
  actor: PublicUser,
  chatId: string,
  options: MessagePageOptions
): Promise<MessagePage> {
  assertActiveActor(actor);
  await assertChatMember(db, actor.id, chatId);

  const whereClause =
    options.beforeSeq === null
      ? eq(messages.chatId, chatId)
      : and(eq(messages.chatId, chatId), lt(messages.seq, options.beforeSeq));

  const rows = await db
    .select({
      id: messages.id,
      chatId: messages.chatId,
      seq: messages.seq,
      senderId: messages.senderId,
      senderDisplayName: messageSender.displayName,
      body: messages.body,
      entities: messages.entities,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
      deletedAt: messages.deletedAt
    })
    .from(messages)
    .innerJoin(messageSender, eq(messageSender.id, messages.senderId))
    .where(whereClause)
    .orderBy(desc(messages.seq))
    .limit(options.limit + 1);

  // Fetch one extra row to expose whether older history is still available.
  const pageRows = rows.slice(0, options.limit);
  const orderedRows = [...pageRows].reverse();

  return {
    messages: orderedRows.map(mapMessageSelectRow),
    hasMore: rows.length > options.limit
  };
}

/**
 * Marks the current chat as read for the actor using the latest known message sequence.
 */
async function markChatRead(
  db: Database,
  actor: PublicUser,
  chatId: string
): Promise<ReadChatResponse> {
  assertActiveActor(actor);

  const [readTarget] = await db
    .select({
      messageSeq: chats.messageSeq
    })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .where(and(eq(chatMembers.userId, actor.id), eq(chatMembers.chatId, chatId)))
    .limit(1);

  if (!readTarget) {
    throw new DomainError({
      code: 'chat_not_found',
      statusCode: 404,
      publicMessage: 'Chat was not found.'
    });
  }

  await db
    .update(chatMembers)
    .set({
      lastReadSeq: readTarget.messageSeq,
      unreadCount: 0
    })
    .where(and(eq(chatMembers.userId, actor.id), eq(chatMembers.chatId, chatId)));

  return {
    chatId,
    lastReadSeq: readTarget.messageSeq,
    unreadCount: 0
  };
}

/**
 * Creates a plain text message and returns the participants that should receive it.
 */
async function sendMessage(
  db: Database,
  actor: PublicUser,
  input: SendMessagePayload
): Promise<MessageDelivery> {
  assertActiveActor(actor);

  const body = input.body.trim();
  if (body.length === 0 || body.length > 5000) {
    throw new DomainError({
      code: 'validation_error',
      statusCode: 400,
      publicMessage: 'Invalid message body.'
    });
  }

  const participantUserIds = await selectParticipantUserIds(db, input.chatId);
  if (!participantUserIds.includes(actor.id)) {
    throw new DomainError({
      code: 'chat_not_found',
      statusCode: 404,
      publicMessage: 'Chat was not found.'
    });
  }

  const existingMessage = await findMessageByClientNonce(db, input.chatId, input.clientNonce);
  if (existingMessage) {
    return {
      message: existingMessage,
      participantUserIds
    };
  }

  try {
    const message = await db.transaction(async (tx) => {
      // Increment the chat sequence on the chat row so concurrent sends receive unique seq values.
      const [updatedChat] = await tx
        .update(chats)
        .set({
          messageSeq: sql`${chats.messageSeq} + 1`
        })
        .where(eq(chats.id, input.chatId))
        .returning({
          seq: chats.messageSeq
        });

      if (!updatedChat) {
        throw new DomainError({
          code: 'chat_not_found',
          statusCode: 404,
          publicMessage: 'Chat was not found.'
        });
      }

      // Store only plain text and an empty entity list until link parsing is implemented.
      const [createdMessage] = await tx
        .insert(messages)
        .values({
          chatId: input.chatId,
          seq: updatedChat.seq,
          senderId: actor.id,
          body,
          entities: [],
          clientNonce: input.clientNonce
        })
        .returning({
          id: messages.id,
          chatId: messages.chatId,
          seq: messages.seq,
          senderId: messages.senderId,
          body: messages.body,
          entities: messages.entities,
          createdAt: messages.createdAt,
          editedAt: messages.editedAt,
          deletedAt: messages.deletedAt
        });

      if (!createdMessage) {
        throw new DomainError({
          code: 'message_create_failed',
          statusCode: 500,
          publicMessage: 'Could not create message.'
        });
      }

      // Refresh chat preview metadata and increment unread counters for other members.
      await tx
        .update(chats)
        .set({
          lastMessageId: createdMessage.id,
          updatedAt: createdMessage.createdAt
        })
        .where(eq(chats.id, input.chatId));

      await tx
        .update(chatMembers)
        .set({
          unreadCount: sql`${chatMembers.unreadCount} + 1`
        })
        .where(and(eq(chatMembers.chatId, input.chatId), ne(chatMembers.userId, actor.id)));

      return mapCreatedMessageRow(createdMessage, actor.displayName);
    });

    return {
      message,
      participantUserIds
    };
  } catch (error) {
    if (hasDatabaseCode(error, '23505')) {
      const racedMessage = await findMessageByClientNonce(db, input.chatId, input.clientNonce);
      if (racedMessage) {
        return {
          message: racedMessage,
          participantUserIds
        };
      }
    }

    throw error;
  }
}

/**
 * Loads one direct chat by id and checks that the actor can see it.
 */
async function getDirectChatById(
  db: Database,
  actor: PublicUser,
  chatId: string
): Promise<DirectChatSummary> {
  const rows = await selectDirectChatRows(db, actor.id, chatId);
  const row = rows[0];

  if (!row) {
    throw new DomainError({
      code: 'chat_not_found',
      statusCode: 404,
      publicMessage: 'Chat was not found.'
    });
  }

  return mapDirectChatRow(row, actor.id);
}

/**
 * Selects direct chat rows with both users so the peer can be derived in memory.
 */
async function selectDirectChatRows(db: Database, actorId: string, chatId?: string) {
  const whereClause =
    chatId === undefined
      ? eq(chatMembers.userId, actorId)
      : and(eq(chatMembers.userId, actorId), eq(chats.id, chatId));

  return db
    .select({
      id: chats.id,
      type: chats.type,
      updatedAt: chats.updatedAt,
      unreadCount: chatMembers.unreadCount,
      lastMessageId: messages.id,
      lastMessageSenderId: messages.senderId,
      lastMessageBody: messages.body,
      lastMessageCreatedAt: messages.createdAt,
      userAId: userA.id,
      userALogin: userA.login,
      userADisplayName: userA.displayName,
      userARole: userA.role,
      userAStatus: userA.status,
      userBId: userB.id,
      userBLogin: userB.login,
      userBDisplayName: userB.displayName,
      userBRole: userB.role,
      userBStatus: userB.status
    })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .innerJoin(directChats, eq(directChats.chatId, chats.id))
    .innerJoin(userA, eq(userA.id, directChats.userAId))
    .innerJoin(userB, eq(userB.id, directChats.userBId))
    .leftJoin(messages, eq(messages.id, chats.lastMessageId))
    .where(whereClause)
    .orderBy(desc(chats.updatedAt));
}

/**
 * Finds an existing direct chat for an ordered pair.
 */
async function findDirectChatId(
  db: Database,
  userAId: string,
  userBId: string
): Promise<string | null> {
  const [existingChat] = await db
    .select({
      chatId: directChats.chatId
    })
    .from(directChats)
    .where(and(eq(directChats.userAId, userAId), eq(directChats.userBId, userBId)))
    .limit(1);

  return existingChat?.chatId ?? null;
}

/**
 * Verifies chat membership before exposing messages or chat data.
 */
async function assertChatMember(db: Database, actorId: string, chatId: string): Promise<void> {
  const [membership] = await db
    .select({
      chatId: chatMembers.chatId
    })
    .from(chatMembers)
    .where(and(eq(chatMembers.userId, actorId), eq(chatMembers.chatId, chatId)))
    .limit(1);

  if (!membership) {
    throw new DomainError({
      code: 'chat_not_found',
      statusCode: 404,
      publicMessage: 'Chat was not found.'
    });
  }
}

/**
 * Returns all chat participants so realtime delivery can target connected users.
 */
async function selectParticipantUserIds(db: Database, chatId: string): Promise<string[]> {
  const rows = await db
    .select({
      userId: chatMembers.userId
    })
    .from(chatMembers)
    .where(eq(chatMembers.chatId, chatId));

  return rows.map((row) => row.userId);
}

/**
 * Finds an already accepted message for idempotent client retries.
 */
async function findMessageByClientNonce(
  db: Database,
  chatId: string,
  clientNonce: string
): Promise<MessageDto | null> {
  const [message] = await db
    .select({
      id: messages.id,
      chatId: messages.chatId,
      seq: messages.seq,
      senderId: messages.senderId,
      senderDisplayName: messageSender.displayName,
      body: messages.body,
      entities: messages.entities,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
      deletedAt: messages.deletedAt
    })
    .from(messages)
    .innerJoin(messageSender, eq(messageSender.id, messages.senderId))
    .where(and(eq(messages.chatId, chatId), eq(messages.clientNonce, clientNonce)))
    .limit(1);

  return message ? mapMessageSelectRow(message) : null;
}

/**
 * Maps a direct chat database row into the public chat summary DTO.
 */
function mapDirectChatRow(
  row: Awaited<ReturnType<typeof selectDirectChatRows>>[number],
  actorId: string
): DirectChatSummary {
  const peer =
    row.userAId === actorId
      ? {
          id: row.userBId,
          login: row.userBLogin,
          displayName: row.userBDisplayName,
          role: row.userBRole,
          status: row.userBStatus
        }
      : {
          id: row.userAId,
          login: row.userALogin,
          displayName: row.userADisplayName,
          role: row.userARole,
          status: row.userAStatus
        };

  return {
    id: row.id,
    type: 'direct',
    peer,
    unreadCount: row.unreadCount,
    updatedAt: row.updatedAt.toISOString(),
    lastMessage:
      row.lastMessageId && row.lastMessageSenderId && row.lastMessageBody !== null && row.lastMessageCreatedAt
        ? {
            id: row.lastMessageId,
            senderId: row.lastMessageSenderId,
            body: row.lastMessageBody,
            createdAt: row.lastMessageCreatedAt.toISOString()
          }
        : null
  };
}

/**
 * Maps a selected message row with sender data into the shared DTO.
 */
function mapMessageSelectRow(row: {
  id: string;
  chatId: string;
  seq: number;
  senderId: string;
  senderDisplayName: string;
  body: string;
  entities: MessageDto['entities'];
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}): MessageDto {
  return {
    id: row.id,
    chatId: row.chatId,
    seq: row.seq,
    senderId: row.senderId,
    senderDisplayName: row.senderDisplayName,
    body: row.body,
    entities: row.entities,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null
  };
}

/**
 * Maps an inserted message row using the already authenticated sender display name.
 */
function mapCreatedMessageRow(
  row: {
    id: string;
    chatId: string;
    seq: number;
    senderId: string;
    body: string;
    entities: MessageDto['entities'];
    createdAt: Date;
    editedAt: Date | null;
    deletedAt: Date | null;
  },
  senderDisplayName: string
): MessageDto {
  return mapMessageSelectRow({
    ...row,
    senderDisplayName
  });
}

/**
 * Ensures direct chat operations run only for active accounts.
 */
function assertActiveActor(actor: PublicUser): void {
  if (actor.status !== 'active') {
    throw new DomainError({
      code: 'forbidden',
      statusCode: 403,
      publicMessage: 'Forbidden.'
    });
  }
}

/**
 * Orders a direct chat pair so unique constraints are stable.
 */
function orderUserPair(firstUserId: string, secondUserId: string): [string, string] {
  return firstUserId < secondUserId ? [firstUserId, secondUserId] : [secondUserId, firstUserId];
}

/**
 * Defines the public user projection returned by chat queries.
 */
function createPublicUserSelection() {
  return {
    id: users.id,
    login: users.login,
    displayName: users.displayName,
    role: users.role,
    status: users.status
  };
}

/**
 * Checks database error codes without depending on a driver-specific error class.
 */
function hasDatabaseCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
