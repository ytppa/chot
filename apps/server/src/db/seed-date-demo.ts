import argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';

import { createDatabaseClient, type Database } from './client.js';
import { readDatabaseConfig } from './config.js';
import { chatMembers, chats, directChats, messages, users } from './schema.js';

type Environment = Record<string, string | undefined>;

type SeedUser = {
  id: string;
  login: string;
  status: string;
};

type DateDemoChat = {
  key: string;
  login: string;
  displayName: string;
  body: string;
  createdAt: Date;
};

const DEFAULT_OWNER_LOGIN = 'admin';
const DEMO_PASSWORD = 'user';

/**
 * Seeds direct chats whose latest messages cover all chat-list date label variants.
 */
export async function seedDateDemo(env: Environment = process.env): Promise<void> {
  const ownerLogin = env.DATE_DEMO_OWNER_LOGIN?.trim() || DEFAULT_OWNER_LOGIN;
  const database = createDatabaseClient(readDatabaseConfig(env));

  try {
    const owner = await findActiveOwner(database.db, ownerLogin);
    const passwordHash = await argon2.hash(DEMO_PASSWORD, {
      type: argon2.argon2id
    });

    for (const demoChat of createDateDemoChats(new Date())) {
      const peer = await upsertDemoUser(database.db, demoChat, passwordHash);
      const chatId = await ensureDirectChat(database.db, owner.id, peer.id, demoChat.createdAt);
      await upsertDemoMessage(database.db, chatId, peer.id, demoChat);
    }

    console.log(`Date demo chats are ready for owner: ${owner.login}`);
  } finally {
    await database.close();
  }
}

/**
 * Loads the account whose sidebar should receive demo conversations.
 */
async function findActiveOwner(db: Database, login: string): Promise<SeedUser> {
  const [owner] = await db
    .select({
      id: users.id,
      login: users.login,
      status: users.status
    })
    .from(users)
    .where(eq(users.login, login))
    .limit(1);

  if (!owner) {
    throw new Error(`Owner user "${login}" was not found. Run admin/user seed first.`);
  }

  if (owner.status !== 'active') {
    throw new Error(`Owner user "${login}" is not active.`);
  }

  return owner;
}

/**
 * Builds deterministic demo rows with relative dates based on the current day.
 */
function createDateDemoChats(now: Date): DateDemoChat[] {
  const today = new Date(now);
  today.setMinutes(now.getMinutes() - 5);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const currentYear = new Date(now.getFullYear(), 0, 15, 12, 0, 0);
  const previousYear = new Date(now.getFullYear() - 1, 11, 20, 12, 0, 0);

  return [
    {
      key: 'today',
      login: 'date-demo-today',
      displayName: 'Date Demo Today',
      body: 'Latest message should show time.',
      createdAt: today
    },
    {
      key: 'yesterday',
      login: 'date-demo-yesterday',
      displayName: 'Date Demo Yesterday',
      body: 'Latest message should show yesterday.',
      createdAt: yesterday
    },
    {
      key: 'current-year',
      login: 'date-demo-current-year',
      displayName: 'Date Demo Current Year',
      body: 'Latest message should show day and month.',
      createdAt: currentYear
    },
    {
      key: 'previous-year',
      login: 'date-demo-previous-year',
      displayName: 'Date Demo Previous Year',
      body: 'Latest message should show numeric date.',
      createdAt: previousYear
    }
  ];
}

/**
 * Creates or refreshes a demo peer without touching real user accounts.
 */
async function upsertDemoUser(db: Database, demoChat: DateDemoChat, passwordHash: string): Promise<SeedUser> {
  const [user] = await db
    .insert(users)
    .values({
      login: demoChat.login,
      passwordHash,
      displayName: demoChat.displayName,
      role: 'user',
      status: 'active',
      verifiedAt: new Date()
    })
    .onConflictDoUpdate({
      target: users.login,
      set: {
        passwordHash,
        displayName: demoChat.displayName,
        role: 'user',
        status: 'active',
        verifiedAt: new Date()
      }
    })
    .returning({
      id: users.id,
      login: users.login,
      status: users.status
    });

  if (!user) {
    throw new Error(`Could not seed demo user "${demoChat.login}".`);
  }

  return user;
}

/**
 * Creates a direct chat for the owner/demo pair or reuses the existing one.
 */
async function ensureDirectChat(db: Database, ownerUserId: string, peerUserId: string, createdAt: Date): Promise<string> {
  const [userAId, userBId] = orderUserPair(ownerUserId, peerUserId);
  const [existingChat] = await db
    .select({
      chatId: directChats.chatId
    })
    .from(directChats)
    .where(and(eq(directChats.userAId, userAId), eq(directChats.userBId, userBId)))
    .limit(1);

  if (existingChat) {
    return existingChat.chatId;
  }

  const [createdChat] = await db
    .insert(chats)
    .values({
      type: 'direct',
      createdAt,
      updatedAt: createdAt
    })
    .returning({
      id: chats.id
    });

  if (!createdChat) {
    throw new Error('Could not create demo chat.');
  }

  await db.insert(directChats).values({
    chatId: createdChat.id,
    userAId,
    userBId
  });

  await db.insert(chatMembers).values([
    {
      chatId: createdChat.id,
      userId: ownerUserId
    },
    {
      chatId: createdChat.id,
      userId: peerUserId
    }
  ]);

  return createdChat.id;
}

/**
 * Upserts the one seed-owned latest message and points chat metadata at it.
 */
async function upsertDemoMessage(
  db: Database,
  chatId: string,
  senderUserId: string,
  demoChat: DateDemoChat
): Promise<void> {
  const clientNonce = `seed-date-demo:${demoChat.key}:latest`;
  const [chatState] = await db
    .select({
      messageSeq: chats.messageSeq
    })
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);

  if (!chatState) {
    throw new Error(`Demo chat "${chatId}" was not found.`);
  }

  const [existingMessage] = await db
    .select({
      id: messages.id,
      seq: messages.seq
    })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.clientNonce, clientNonce)))
    .limit(1);

  const messageId = existingMessage
    ? await updateDemoMessage(db, existingMessage.id, senderUserId, demoChat)
    : await insertDemoMessage(db, chatId, chatState.messageSeq + 1, senderUserId, demoChat, clientNonce);
  const readSeq = existingMessage ? Math.max(existingMessage.seq, chatState.messageSeq) : chatState.messageSeq + 1;

  await db
    .update(chats)
    .set({
      lastMessageId: messageId,
      messageSeq: readSeq,
      updatedAt: demoChat.createdAt
    })
    .where(eq(chats.id, chatId));

  await db
    .update(chatMembers)
    .set({
      lastReadSeq: readSeq,
      unreadCount: 0
    })
    .where(eq(chatMembers.chatId, chatId));
}

/**
 * Refreshes an existing seed message so reruns keep relative dates current.
 */
async function updateDemoMessage(
  db: Database,
  messageId: string,
  senderUserId: string,
  demoChat: DateDemoChat
): Promise<string> {
  const [updatedMessage] = await db
    .update(messages)
    .set({
      senderId: senderUserId,
      body: demoChat.body,
      entities: [],
      createdAt: demoChat.createdAt,
      editedAt: null,
      deletedAt: null
    })
    .where(eq(messages.id, messageId))
    .returning({
      id: messages.id
    });

  if (!updatedMessage) {
    throw new Error(`Could not update demo message "${messageId}".`);
  }

  return updatedMessage.id;
}

/**
 * Inserts the seed message at the next chat sequence position.
 */
async function insertDemoMessage(
  db: Database,
  chatId: string,
  seq: number,
  senderUserId: string,
  demoChat: DateDemoChat,
  clientNonce: string
): Promise<string> {
  const [createdMessage] = await db
    .insert(messages)
    .values({
      chatId,
      seq,
      senderId: senderUserId,
      body: demoChat.body,
      entities: [],
      clientNonce,
      createdAt: demoChat.createdAt
    })
    .returning({
      id: messages.id
    });

  if (!createdMessage) {
    throw new Error(`Could not insert demo message for "${demoChat.login}".`);
  }

  return createdMessage.id;
}

/**
 * Orders direct-chat members so the DB unique pair check remains stable.
 */
function orderUserPair(firstUserId: string, secondUserId: string): [string, string] {
  return firstUserId < secondUserId ? [firstUserId, secondUserId] : [secondUserId, firstUserId];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedDateDemo().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
