import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export type MessageEntity =
  | {
      type: 'link';
      offset: number;
      length: number;
      href: string;
    };

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['pending', 'active', 'rejected', 'disabled']);
export const chatTypeEnum = pgEnum('chat_type', ['direct']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    login: varchar('login', { length: 64 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    role: userRoleEnum('role').notNull().default('user'),
    status: userStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references((): AnyPgColumn => users.id, {
      onDelete: 'set null'
    }),
    email: varchar('email', { length: 320 }),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true })
  },
  (table) => [
    uniqueIndex('users_login_unique').on(table.login),
    index('users_status_idx').on(table.status)
  ]
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true })
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId)
  ]
);

export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: chatTypeEnum('type').notNull().default('direct'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageId: uuid('last_message_id'),
    messageSeq: integer('message_seq').notNull().default(0)
  },
  (table) => [
    index('chats_updated_at_idx').on(table.updatedAt)
  ]
);

export const chatMembers = pgTable(
  'chat_members',
  {
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastReadSeq: integer('last_read_seq').notNull().default(0),
    unreadCount: integer('unread_count').notNull().default(0)
  },
  (table) => [
    uniqueIndex('chat_members_user_chat_unique').on(table.userId, table.chatId),
    index('chat_members_chat_id_idx').on(table.chatId)
  ]
);

export const directChats = pgTable(
  'direct_chats',
  {
    chatId: uuid('chat_id')
      .primaryKey()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userAId: uuid('user_a_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userBId: uuid('user_b_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
  },
  (table) => [
    uniqueIndex('direct_chats_user_pair_unique').on(table.userAId, table.userBId),
    check('direct_chats_ordered_users_check', sql`${table.userAId} < ${table.userBId}`)
  ]
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    entities: jsonb('entities').$type<MessageEntity[]>().notNull().default(sql`'[]'::jsonb`),
    clientNonce: text('client_nonce'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (table) => [
    uniqueIndex('messages_chat_seq_unique').on(table.chatId, table.seq),
    uniqueIndex('messages_chat_client_nonce_unique')
      .on(table.chatId, table.clientNonce)
      .where(sql`${table.clientNonce} IS NOT NULL`),
    index('messages_chat_created_at_idx').on(table.chatId, table.createdAt),
    index('messages_sender_id_idx').on(table.senderId)
  ]
);

