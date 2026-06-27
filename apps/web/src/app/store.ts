import type { ChatMessagesResponse, DirectChatSummary, MessageDto, PublicUser } from '@nothing-chat/shared';

import { createUuid } from '../utils/uuid.js';

export type AuthView = 'login' | 'register';

export type ChatSummary = {
  id: string;
  peerId: string;
  title: string;
  lastMessage: string;
  unreadCount: number;
  updatedAtLabel: string;
};

export type MessageSummary = {
  id: string;
  chatId: string;
  seq: number;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  createdAtMs: number;
  createdAtLabel: string;
  isOwn: boolean;
  clientNonce?: string;
  deliveryStatus?: 'pending' | 'sent';
};

export type MessagePaginationState = {
  hasMore: boolean;
  isLoadingOlder: boolean;
  oldestSeq: number | null;
  pageSize: number;
};

export type AppState = {
  authView: AuthView;
  currentUser: PublicUser | null;
  activeChatId: string | null;
  chats: ChatSummary[];
  pendingUsers: PublicUser[];
  messages: MessageSummary[];
  messagePages: Record<string, MessagePaginationState>;
  statusText: string;
};

type AppStateListener = (state: AppState) => void;

type LastMessagePreviewSource = Pick<MessageDto, 'body' | 'senderId'> | DirectChatSummary['lastMessage'];

const initialState: AppState = {
  authView: 'login',
  currentUser: null,
  activeChatId: null,
  statusText: 'Offline',
  chats: [],
  pendingUsers: [],
  messages: [],
  messagePages: {}
};

const DEFAULT_MESSAGE_PAGE_SIZE = 50;

/**
 * Stores small frontend state for the MVP without introducing a state framework.
 */
export class AppStore {
  private state: AppState;

  private readonly listeners = new Set<AppStateListener>();

  public constructor(seedState: AppState = initialState) {
    this.state = seedState;
  }

  /**
   * Returns the latest immutable state snapshot for renderers.
   */
  public getState(): AppState {
    return structuredClone(this.state);
  }

  /**
   * Subscribes a renderer and immediately emits the current state.
   */
  public subscribe(listener: AppStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Switches between login and registration forms.
   */
  public setAuthView(authView: AuthView): void {
    this.updateState({
      authView
    });
  }

  /**
   * Selects the chat whose messages should be rendered in the main pane.
   */
  public setActiveChat(chatId: string | null): void {
    this.updateState({
      activeChatId: chatId
    });
  }

  /**
   * Detaches the visible conversation while keeping chat navigation and session data.
   */
  public closeActiveChat(): void {
    this.updateState({
      activeChatId: null,
      messages: [],
      messagePages: {}
    });
  }

  /**
   * Clears the unread badge for a chat that the user is actively reading.
   */
  public markChatRead(chatId: string): void {
    this.updateState({
      chats: this.state.chats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              unreadCount: 0
            }
          : chat
      )
    });
  }

  /**
   * Stores the authenticated user and updates the header status.
   */
  public setCurrentUser(user: PublicUser): void {
    this.updateState({
      currentUser: user,
      statusText: `Online: ${user.displayName}`
    });
  }

  /**
   * Clears user-owned state after logout or missing session.
   */
  public clearSession(statusText = 'Offline'): void {
    this.updateState({
      currentUser: null,
      activeChatId: null,
      chats: [],
      pendingUsers: [],
      messages: [],
      messagePages: {},
      statusText
    });
  }

  /**
   * Replaces chat navigation with direct chats loaded from the API.
   */
  public setDirectChats(
    directChats: DirectChatSummary[],
    preferredActiveChatId = this.state.activeChatId,
    selectFirstIfMissing = true
  ): void {
    const currentUserId = this.state.currentUser?.id ?? null;
    const chats = directChats.map((chat) => mapDirectChatSummary(chat, currentUserId));
    const activeChatId = chats.some((chat) => chat.id === preferredActiveChatId)
      ? preferredActiveChatId
      : selectFirstIfMissing
        ? chats[0]?.id ?? null
        : null;

    this.updateState({
      chats,
      activeChatId
    });
  }

  /**
   * Stores pending users that the admin can approve or reject from the UI.
   */
  public setPendingUsers(users: PublicUser[]): void {
    this.updateState({
      pendingUsers: users
    });
  }

  /**
   * Removes one reviewed account from the local admin approval list.
   */
  public removePendingUser(userId: string): void {
    this.updateState({
      pendingUsers: this.state.pendingUsers.filter((user) => user.id !== userId)
    });
  }

  /**
   * Clears loaded message history and pagination metadata.
   */
  public clearMessages(): void {
    this.updateState({
      messages: [],
      messagePages: {}
    });
  }

  /**
   * Replaces one chat history with the first API page while keeping pending local sends.
   */
  public setMessages(
    chatId: string,
    messages: MessageDto[],
    page: ChatMessagesResponse['page']
  ): void {
    const currentUserId = this.state.currentUser?.id ?? null;
    const mappedMessages = messages.map((message) => mapMessageDto(message, currentUserId));
    const pendingLocalMessages = this.state.messages.filter(
      (message) => message.chatId === chatId && message.deliveryStatus === 'pending'
    );
    const chatMessages = mergeMessageSummaries([...mappedMessages, ...pendingLocalMessages]);

    this.updateState({
      messages: sortMessages([
        ...this.state.messages.filter((message) => message.chatId !== chatId),
        ...chatMessages
      ]),
      messagePages: {
        ...this.state.messagePages,
        [chatId]: createMessagePaginationState(chatMessages, page, false)
      }
    });
  }

  /**
   * Prepends an older history page without duplicating already loaded messages.
   */
  public prependOlderMessages(
    chatId: string,
    messages: MessageDto[],
    page: ChatMessagesResponse['page']
  ): void {
    const currentUserId = this.state.currentUser?.id ?? null;
    const currentChatMessages = this.state.messages.filter((message) => message.chatId === chatId);
    const olderMessages = messages.map((message) => mapMessageDto(message, currentUserId));
    const chatMessages = mergeMessageSummaries([...olderMessages, ...currentChatMessages]);

    this.updateState({
      messages: sortMessages([
        ...this.state.messages.filter((message) => message.chatId !== chatId),
        ...chatMessages
      ]),
      messagePages: {
        ...this.state.messagePages,
        [chatId]: createMessagePaginationState(chatMessages, page, false)
      }
    });
  }

  /**
   * Marks the older-history request state so the UI can avoid duplicate fetches.
   */
  public setOlderMessagesLoading(chatId: string, isLoadingOlder: boolean): void {
    const currentPage = this.state.messagePages[chatId] ?? createEmptyMessagePaginationState();

    this.updateState({
      messagePages: {
        ...this.state.messagePages,
        [chatId]: {
          ...currentPage,
          isLoadingOlder
        }
      }
    });
  }

  /**
   * Inserts or updates one server-confirmed message and refreshes the chat preview.
   */
  public upsertServerMessage(message: MessageDto): void {
    this.upsertMessageSummary(mapMessageDto(message, this.state.currentUser?.id ?? null), message);
  }

  /**
   * Replaces an optimistic local message with the server-confirmed message for the same send.
   */
  public acknowledgeServerMessage(message: MessageDto, clientNonce: string): void {
    const mappedMessage = mapMessageDto(message, this.state.currentUser?.id ?? null);
    const messagesWithoutLocalCopy = this.state.messages.filter((item) => item.clientNonce !== clientNonce);

    this.upsertMessageSummary(
      {
        ...mappedMessage,
        deliveryStatus: 'sent'
      },
      message,
      messagesWithoutLocalCopy
    );
  }

  /**
   * Inserts one mapped message and refreshes the related chat preview.
   */
  private upsertMessageSummary(
    mappedMessage: MessageSummary,
    sourceMessage: MessageDto,
    baseMessages = this.state.messages
  ): void {
    const currentUserId = this.state.currentUser?.id ?? null;
    const existingMessage = baseMessages.some((item) => item.id === mappedMessage.id);
    const shouldKeepInMessageFeed =
      mappedMessage.chatId === this.state.activeChatId ||
      baseMessages.some((item) => item.chatId === mappedMessage.chatId);
    const messages = existingMessage
      ? baseMessages.map((item) => (item.id === mappedMessage.id ? mappedMessage : item))
      : shouldKeepInMessageFeed
        ? [...baseMessages, mappedMessage]
        : baseMessages;

    this.updateState({
      messages: sortMessages(messages),
      chats: this.state.chats.map((chat) =>
        chat.id === sourceMessage.chatId
          ? {
              ...chat,
              lastMessage: formatLastMessagePreview(sourceMessage, currentUserId),
              unreadCount:
                sourceMessage.senderId !== currentUserId && sourceMessage.chatId !== this.state.activeChatId
                  ? chat.unreadCount + 1
                  : chat.unreadCount,
              updatedAtLabel: formatChatUpdatedAtLabel(sourceMessage.createdAt)
            }
          : chat
      )
    });
  }

  /**
   * Updates short operational status text in the app header.
   */
  public setStatusText(statusText: string): void {
    this.updateState({
      statusText
    });
  }

  /**
   * Adds an optimistic local message to the active chat.
   */
  public addLocalMessage(body: string, clientNonce: string): void {
    const activeChatId = this.state.activeChatId;
    const currentUser = this.state.currentUser;
    if (!activeChatId) {
      return;
    }

    const createdAt = new Date();
    const createdAtIso = createdAt.toISOString();
    const message: MessageSummary = {
      id: `local-${createUuid()}`,
      chatId: activeChatId,
      seq: Date.now(),
      senderId: currentUser?.id ?? 'local-current-user',
      senderName: currentUser?.displayName ?? 'You',
      body,
      createdAt: createdAtIso,
      createdAtMs: createdAt.getTime(),
      createdAtLabel: formatDateTimeLabel(createdAtIso),
      isOwn: true,
      clientNonce,
      deliveryStatus: 'pending'
    };

    this.updateState({
      messages: [...this.state.messages, message],
      chats: this.state.chats.map((chat) =>
        chat.id === activeChatId
          ? {
              ...chat,
              lastMessage: formatLastMessagePreview(message, currentUser?.id ?? null),
              updatedAtLabel: formatChatUpdatedAtLabel(message.createdAt)
            }
          : chat
      )
    });
  }

  /**
   * Merges a partial state patch and notifies all subscribers.
   */
  private updateState(patch: Partial<AppState>): void {
    this.state = {
      ...this.state,
      ...patch
    };

    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }
}

/**
 * Converts a direct chat DTO into the compact list data used by chat cards.
 */
function mapDirectChatSummary(chat: DirectChatSummary, currentUserId: string | null): ChatSummary {
  return {
    id: chat.id,
    peerId: chat.peer.id,
    title: chat.peer.displayName,
    lastMessage: formatLastMessagePreview(chat.lastMessage, currentUserId),
    unreadCount: chat.unreadCount,
    updatedAtLabel: formatChatUpdatedAtLabel(chat.lastMessage?.createdAt ?? chat.updatedAt)
  };
}

/**
 * Marks own latest messages in chat previews so navigation reads like common messengers.
 */
function formatLastMessagePreview(message: LastMessagePreviewSource, currentUserId: string | null): string {
  if (!message) {
    return 'Нет сообщений';
  }

  return currentUserId && message.senderId === currentUserId ? `Вы: ${message.body}` : message.body;
}

/**
 * Converts a message DTO into the UI message shape without trusting HTML.
 */
function mapMessageDto(message: MessageDto, currentUserId: string | null): MessageSummary {
  return {
    id: message.id,
    chatId: message.chatId,
    seq: message.seq,
    senderId: message.senderId,
    senderName: message.senderDisplayName,
    body: message.body,
    createdAt: message.createdAt,
    createdAtMs: parseDateTimeMs(message.createdAt),
    createdAtLabel: formatDateTimeLabel(message.createdAt),
    isOwn: message.senderId === currentUserId
  };
}

/**
 * Keeps message rows ordered by chat and sequence after realtime inserts.
 */
function sortMessages(messages: MessageSummary[]): MessageSummary[] {
  return [...messages].sort((left, right) => {
    if (left.chatId === right.chatId) {
      return left.seq - right.seq;
    }

    return left.chatId.localeCompare(right.chatId);
  });
}

/**
 * Deduplicates mapped messages while keeping the newest local/server shape for each id.
 */
function mergeMessageSummaries(messages: MessageSummary[]): MessageSummary[] {
  const byId = new Map<string, MessageSummary>();
  for (const message of messages) {
    byId.set(message.id, message);
  }

  return sortMessages([...byId.values()]);
}

/**
 * Creates pagination metadata from the messages currently loaded for one chat.
 */
function createMessagePaginationState(
  messages: MessageSummary[],
  page: ChatMessagesResponse['page'],
  isLoadingOlder: boolean
): MessagePaginationState {
  return {
    hasMore: page.hasMore,
    isLoadingOlder,
    oldestSeq: findOldestPersistedSeq(messages),
    pageSize: page.limit
  };
}

/**
 * Provides a safe default before the first history page arrives.
 */
function createEmptyMessagePaginationState(): MessagePaginationState {
  return {
    hasMore: false,
    isLoadingOlder: false,
    oldestSeq: null,
    pageSize: DEFAULT_MESSAGE_PAGE_SIZE
  };
}

/**
 * Finds the oldest server-backed sequence and ignores pending optimistic rows.
 */
function findOldestPersistedSeq(messages: MessageSummary[]): number | null {
  const persistedSeqs = messages
    .filter((message) => message.deliveryStatus !== 'pending')
    .map((message) => message.seq);

  if (persistedSeqs.length === 0) {
    return null;
  }

  return Math.min(...persistedSeqs);
}

/**
 * Formats chat activity like a messenger list: time today, date for older messages.
 */
function formatChatUpdatedAtLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  if (isSameLocalDate(date, now)) {
    return formatDateTimeLabel(value);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDate(date, yesterday)) {
    return 'Вчера';
  }

  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short'
    }).format(date);
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  }).format(date);
}

/**
 * Compares calendar days in the user's local timezone for relative chat labels.
 */
function isSameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * Formats server timestamps for compact chat rows and message bubbles.
 */
function formatDateTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

/**
 * Converts server ISO timestamps into comparable milliseconds for feed grouping.
 */
function parseDateTimeMs(value: string): number {
  const date = new Date(value);
  const timestamp = date.getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
}
