export type UserRole = 'user' | 'admin';

export type UserStatus = 'pending' | 'active' | 'rejected' | 'disabled';

export type PublicUser = {
  id: string;
  login: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
};

export type RegisterRequest = {
  login: string;
  password: string;
  displayName: string;
};

export type LoginRequest = {
  login: string;
  password: string;
};

export type AuthUserResponse = {
  user: PublicUser;
};

export type PendingUsersResponse = {
  users: PublicUser[];
};

export type UsersResponse = {
  users: PublicUser[];
};

export type ChatType = 'direct';

export type MessageEntity =
  | {
      type: 'link';
      offset: number;
      length: number;
      href: string;
    };

export type MessagePreview = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

export type MessageDto = {
  id: string;
  chatId: string;
  seq: number;
  senderId: string;
  senderDisplayName: string;
  body: string;
  entities: MessageEntity[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
};

export type DirectChatSummary = {
  id: string;
  type: 'direct';
  peer: PublicUser;
  unreadCount: number;
  updatedAt: string;
  lastMessage: MessagePreview | null;
};

export type DirectChatsResponse = {
  chats: DirectChatSummary[];
};

export type DirectChatResponse = {
  chat: DirectChatSummary;
};

export type CreateDirectChatRequest = {
  userId: string;
};

export type ChatMessagesResponse = {
  messages: MessageDto[];
  page: {
    limit: number;
    beforeSeq: number | null;
    hasMore: boolean;
  };
};

export type ReadChatResponse = {
  chatId: string;
  lastReadSeq: number;
  unreadCount: number;
};

export type SendMessagePayload = {
  chatId: string;
  body: string;
  clientNonce: string;
};

export type MessageAckPayload = {
  clientNonce: string;
  message: MessageDto;
};

export type MessageCreatedPayload = {
  message: MessageDto;
};

export type WebSocketErrorPayload = {
  code: string;
  message: string;
};

export type ClientEventEnvelope<TPayload = unknown> = {
  id: string;
  type: string;
  payload: TPayload;
  ts?: string;
};

export type ServerEventEnvelope<TPayload = unknown> = {
  id?: string;
  type: string;
  payload: TPayload;
  ts: string;
};

export type PingClientEvent = ClientEventEnvelope<Record<string, never>> & {
  type: 'ping';
};

export type SendMessageClientEvent = ClientEventEnvelope<SendMessagePayload> & {
  type: 'message.send';
};

export type PongServerEvent = ServerEventEnvelope<{
  ok: true;
  receivedAt: string;
}> & {
  type: 'pong';
};

export type MessageAckServerEvent = ServerEventEnvelope<MessageAckPayload> & {
  type: 'message.ack';
};

export type MessageCreatedServerEvent = ServerEventEnvelope<MessageCreatedPayload> & {
  type: 'message.created';
};

export type WebSocketErrorServerEvent = ServerEventEnvelope<WebSocketErrorPayload> & {
  type: 'error';
};
