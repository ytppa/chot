CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "user_role" AS ENUM ('user', 'admin');
CREATE TYPE "user_status" AS ENUM ('pending', 'active', 'rejected', 'disabled');
CREATE TYPE "chat_type" AS ENUM ('direct');

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "login" varchar(64) NOT NULL,
  "password_hash" text NOT NULL,
  "display_name" varchar(120) NOT NULL,
  "role" "user_role" DEFAULT 'user' NOT NULL,
  "status" "user_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "verified_at" timestamp with time zone,
  "verified_by" uuid,
  "email" varchar(320),
  "email_verified_at" timestamp with time zone,
  CONSTRAINT "users_login_unique" UNIQUE ("login"),
  CONSTRAINT "users_verified_by_users_id_fk"
    FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "sessions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "sessions_token_hash_unique" UNIQUE ("token_hash")
);

CREATE TABLE "chats" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" "chat_type" DEFAULT 'direct' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_message_id" uuid,
  "message_seq" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "chat_members" (
  "chat_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_read_seq" integer DEFAULT 0 NOT NULL,
  "unread_count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "chat_members_chat_id_chats_id_fk"
    FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE,
  CONSTRAINT "chat_members_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE "direct_chats" (
  "chat_id" uuid PRIMARY KEY NOT NULL,
  "user_a_id" uuid NOT NULL,
  "user_b_id" uuid NOT NULL,
  CONSTRAINT "direct_chats_chat_id_chats_id_fk"
    FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE,
  CONSTRAINT "direct_chats_user_a_id_users_id_fk"
    FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "direct_chats_user_b_id_users_id_fk"
    FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "direct_chats_ordered_users_check" CHECK ("user_a_id" < "user_b_id")
);

CREATE TABLE "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "chat_id" uuid NOT NULL,
  "seq" integer NOT NULL,
  "sender_id" uuid NOT NULL,
  "body" text NOT NULL,
  "entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "client_nonce" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "edited_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "messages_chat_id_chats_id_fk"
    FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE,
  CONSTRAINT "messages_sender_id_users_id_fk"
    FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

ALTER TABLE "chats"
  ADD CONSTRAINT "chats_last_message_id_messages_id_fk"
  FOREIGN KEY ("last_message_id") REFERENCES "messages"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "chat_members_user_chat_unique" ON "chat_members" ("user_id", "chat_id");
CREATE INDEX "chat_members_chat_id_idx" ON "chat_members" ("chat_id");
CREATE UNIQUE INDEX "direct_chats_user_pair_unique" ON "direct_chats" ("user_a_id", "user_b_id");
CREATE UNIQUE INDEX "messages_chat_seq_unique" ON "messages" ("chat_id", "seq");
CREATE UNIQUE INDEX "messages_chat_client_nonce_unique"
  ON "messages" ("chat_id", "client_nonce")
  WHERE "client_nonce" IS NOT NULL;
CREATE INDEX "messages_chat_created_at_idx" ON "messages" ("chat_id", "created_at");
CREATE INDEX "messages_sender_id_idx" ON "messages" ("sender_id");
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");
CREATE INDEX "users_status_idx" ON "users" ("status");
CREATE INDEX "chats_updated_at_idx" ON "chats" ("updated_at");

