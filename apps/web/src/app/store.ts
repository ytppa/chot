export type AuthView = 'login' | 'register';

export type ChatSummary = {
  id: string;
  title: string;
  lastMessage: string;
  unreadCount: number;
  updatedAtLabel: string;
};

export type MessageSummary = {
  id: string;
  chatId: string;
  senderName: string;
  body: string;
  createdAtLabel: string;
  isOwn: boolean;
};

export type AppState = {
  authView: AuthView;
  activeChatId: string | null;
  chats: ChatSummary[];
  messages: MessageSummary[];
  statusText: string;
};

type AppStateListener = (state: AppState) => void;

const initialState: AppState = {
  authView: 'login',
  activeChatId: 'chat-1',
  statusText: 'Offline',
  chats: [
    {
      id: 'chat-1',
      title: 'Admin',
      lastMessage: 'Account approval flow is next',
      unreadCount: 1,
      updatedAtLabel: '09:40'
    },
    {
      id: 'chat-2',
      title: 'Design notes',
      lastMessage: 'Plain text first',
      unreadCount: 0,
      updatedAtLabel: 'Yesterday'
    }
  ],
  messages: [
    {
      id: 'msg-1',
      chatId: 'chat-1',
      senderName: 'Admin',
      body: 'Registration requests will appear after auth endpoints are ready.',
      createdAtLabel: '09:38',
      isOwn: false
    },
    {
      id: 'msg-2',
      chatId: 'chat-1',
      senderName: 'You',
      body: 'The frontend shell is ready for real API data.',
      createdAtLabel: '09:40',
      isOwn: true
    }
  ]
};

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
  public setActiveChat(chatId: string): void {
    this.updateState({
      activeChatId: chatId
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
  public addLocalMessage(body: string): void {
    const activeChatId = this.state.activeChatId;
    if (!activeChatId) {
      return;
    }

    const message: MessageSummary = {
      id: `local-${crypto.randomUUID()}`,
      chatId: activeChatId,
      senderName: 'You',
      body,
      createdAtLabel: new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date()),
      isOwn: true
    };

    this.updateState({
      messages: [...this.state.messages, message],
      chats: this.state.chats.map((chat) =>
        chat.id === activeChatId
          ? {
              ...chat,
              lastMessage: body,
              updatedAtLabel: message.createdAtLabel
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

