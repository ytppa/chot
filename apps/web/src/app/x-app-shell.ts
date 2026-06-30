import type {
  MessageAckPayload,
  MessageCreatedPayload,
  MessageDto,
  PublicUser,
  ServerEventEnvelope,
  WebSocketErrorPayload
} from '@nothing-chat/shared';

import type { AppState, AuthView } from './store.js';
import { AppStore } from './store.js';
import type { LoginFormSubmitDetail } from '../components/auth/x-login-form.js';
import type { RegisterFormSubmitDetail } from '../components/auth/x-register-form.js';
import type { ChatListData, ChatSearchResult, ChatSearchResultSelectDetail } from '../components/chats/x-chat-list.js';
import type { AppContextMenuDetail, AppMenuCommandDetail } from '../components/context-menu/types.js';
import type { XContextMenuRoot } from '../components/context-menu/x-context-menu-root.js';
import type {
  MessageComposerSubmitDetail,
  XMessageComposer
} from '../components/messages/x-message-composer.js';
import type { XChatList } from '../components/chats/x-chat-list.js';
import type { MessageListScrollAnchor, XMessageList } from '../components/messages/x-message-list.js';
import { ApiClient, ApiClientError } from '../services/api-client.js';
import { WebSocketClient, type WebSocketConnectionState } from '../services/ws-client.js';
import { createFontAwesomeIcon } from '../utils/fontawesome.js';
import { createUuid } from '../utils/uuid.js';
import { AdminApprovalsController } from './admin-approvals-controller.js';

const MESSAGE_PAGE_SIZE = 50;
const CHAT_ROUTE_PREFIX = '#/chat/';
const UUID_ROUTE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_UUID_ROUTE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

type LoadChatWorkspaceOptions = {
  forceScrollToBottom?: boolean;
  keepChatClosed?: boolean;
};

type MarkChatReadOptions = {
  forceScrollToBottom?: boolean;
};

type MobilePane = 'chats' | 'chat';

type AppModalAction = {
  label: string;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  onClick: () => void;
};

type AppModalOptions = {
  title: string;
  content: () => HTMLElement;
  actions?: AppModalAction[];
};

/**
 * Owns the first usable chat screen and wires child components to app state.
 */
export class XAppShell extends HTMLElement {
  private readonly store = new AppStore();

  private readonly apiClient = new ApiClient();

  private readonly wsClient = new WebSocketClient();

  private readonly adminApprovals = new AdminApprovalsController({
    apiClient: this.apiClient,
    store: this.store,
    getErrorMessage: (error) => this.getErrorMessage(error),
    restoreOnlineStatus: () => {
      this.restoreOnlineStatus();
    }
  });

  private unsubscribe: (() => void) | null = null;

  private unsubscribeRealtime: (() => void) | null = null;

  private unsubscribeRealtimeState: (() => void) | null = null;

  private renderedActiveChatId: string | null = null;

  private mobilePane: MobilePane = 'chats';

  private activeModal: AppModalOptions | null = null;

  private chatSearchQuery = '';

  private chatSearchResults: PublicUser[] = [];

  private isChatSearchLoading = false;

  private chatSearchDebounceTimer: number | null = null;

  private chatSearchRequestId = 0;

  /**
   * Forces the message feed to follow messages authored from this client.
   */
  private shouldForceMessageListBottom = false;

  private messageListBottomReleaseFrames: number[] = [];

  private shouldPreserveOlderMessagesAnchor = false;

  private olderMessagesAnchorChatId: string | null = null;

  /**
   * Subscribes to state and global component events when the shell is attached.
   */
  public connectedCallback(): void {
    this.addEventListener('auth-login-submit', this.handleLoginSubmit);
    this.addEventListener('auth-register-submit', this.handleRegisterSubmit);
    this.addEventListener('chat-select', this.handleChatSelect);
    this.addEventListener('app-context-menu', this.handleContextMenuRequest);
    this.addEventListener('app-menu-command', this.handleMenuCommand);
    this.addEventListener('message-compose-submit', this.handleMessageSubmit);
    this.addEventListener('messages-load-older', this.handleOlderMessagesRequest);
    this.addEventListener('chat-search-result-select', this.handleChatSearchResultSelect);
    this.addEventListener('keydown', this.handleShellKeyDown);
    window.addEventListener('hashchange', this.handleRouteChange);
    window.addEventListener('popstate', this.handleRouteChange);
    this.unsubscribeRealtime = this.wsClient.subscribe(this.handleRealtimeEvent);
    this.unsubscribeRealtimeState = this.wsClient.subscribeState(this.handleRealtimeStateChange);

    this.unsubscribe = this.store.subscribe((state) => {
      this.render(state);
    });

    void this.bootstrapSession();
  }

  /**
   * Releases listeners when the shell is detached.
   */
  public disconnectedCallback(): void {
    this.removeEventListener('auth-login-submit', this.handleLoginSubmit);
    this.removeEventListener('auth-register-submit', this.handleRegisterSubmit);
    this.removeEventListener('chat-select', this.handleChatSelect);
    this.removeEventListener('app-context-menu', this.handleContextMenuRequest);
    this.removeEventListener('app-menu-command', this.handleMenuCommand);
    this.removeEventListener('message-compose-submit', this.handleMessageSubmit);
    this.removeEventListener('messages-load-older', this.handleOlderMessagesRequest);
    this.removeEventListener('chat-search-result-select', this.handleChatSearchResultSelect);
    this.removeEventListener('keydown', this.handleShellKeyDown);
    window.removeEventListener('hashchange', this.handleRouteChange);
    window.removeEventListener('popstate', this.handleRouteChange);
    this.unsubscribe?.();
    this.unsubscribeRealtime?.();
    this.unsubscribeRealtimeState?.();
    this.wsClient.disconnect();
    this.unsubscribe = null;
    this.unsubscribeRealtime = null;
    this.unsubscribeRealtimeState = null;
    this.clearChatSearchDebounceTimer();
    this.releaseMessageListBottomLock();
  }

  /**
   * Builds the full application shell from current state.
   */
  private render(state: AppState): void {
    const previousMessageList = this.querySelector<XMessageList>('x-message-list');
    const isSameActiveChat = this.renderedActiveChatId === state.activeChatId;
    const shouldForceScrollToOwnMessage = this.shouldForceMessageListBottom;
    const shouldPreserveOlderMessagesAnchor =
      state.activeChatId !== null &&
      this.shouldPreserveOlderMessagesAnchor &&
      this.olderMessagesAnchorChatId === state.activeChatId &&
      previousMessageList !== null;
    const restoredMessageScrollAnchor: MessageListScrollAnchor | null =
      shouldPreserveOlderMessagesAnchor && previousMessageList
        ? {
            scrollTop: previousMessageList.scrollTop,
            scrollHeight: previousMessageList.scrollHeight
          }
        : null;
    const shouldStickMessagesToBottom =
      state.activeChatId !== null &&
      !shouldPreserveOlderMessagesAnchor &&
      (shouldForceScrollToOwnMessage || !isSameActiveChat || (previousMessageList?.isNearBottom() ?? true));
    const restoredMessageScrollTop =
      state.activeChatId !== null &&
      isSameActiveChat &&
      !shouldStickMessagesToBottom &&
      restoredMessageScrollAnchor === null
        ? previousMessageList?.scrollTop ?? null
        : null;

    const frame = document.createElement('div');
    frame.className = `frame is-mobile-${this.mobilePane}-pane`;

    const sidebar = this.createSidebar(state);
    const mainPane = this.createMainPane(
      state,
      shouldStickMessagesToBottom,
      restoredMessageScrollTop,
      restoredMessageScrollAnchor
    );
    const contextMenuRoot = document.createElement('x-context-menu-root');

    frame.append(sidebar, mainPane);
    const modalRoot = this.createModalRoot();

    this.replaceChildren(frame, contextMenuRoot, modalRoot);
    this.renderedActiveChatId = state.activeChatId;
    this.shouldPreserveOlderMessagesAnchor = false;
    this.olderMessagesAnchorChatId = null;
  }

  /**
   * Creates the left pane with auth controls and direct chat navigation.
   */
  private createSidebar(state: AppState): HTMLElement {
    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';

    const brand = document.createElement('header');
    brand.className = 'brand';

    const title = document.createElement('h1');
    title.textContent = 'Nothing Shhh';

    const status = document.createElement('span');
    status.textContent = state.statusText;

    brand.append(title, status);

    const authPanel = this.createAuthPanel(state);
    const adminApprovalPanel = state.currentUser?.role === 'admin' ? this.createAdminApprovalPanel(state) : null;
    const chatSearch = state.currentUser ? this.createChatSearchPanel() : null;
    const chatList = document.createElement('x-chat-list') as XChatList;
    chatList.data = this.createChatListData(state);

    sidebar.append(brand, authPanel);
    if (chatSearch) {
      sidebar.append(chatSearch);
    }
    sidebar.append(chatList);
    if (adminApprovalPanel) {
      sidebar.append(adminApprovalPanel);
    }

    return sidebar;
  }

  /**
   * Creates the sidebar account entry and moves auth forms into a modal.
   */
  private createAuthPanel(state: AppState): HTMLElement {
    const panel = document.createElement('section');
    panel.className = state.currentUser ? 'auth-panel is-session' : 'auth-panel';

    if (state.currentUser) {
      panel.append(this.createSessionPanel(state));
      return panel;
    }

    const title = document.createElement('h2');
    title.textContent = 'Аккаунт';

    const actions = document.createElement('div');
    actions.className = 'auth-actions';

    const loginButton = document.createElement('button');
    loginButton.className = 'auth-action is-primary';
    loginButton.type = 'button';
    loginButton.textContent = 'Вход';
    loginButton.addEventListener('click', () => {
      this.openAuthModal('login');
    });

    const registerButton = document.createElement('button');
    registerButton.className = 'auth-action';
    registerButton.type = 'button';
    registerButton.textContent = 'Регистрация';
    registerButton.addEventListener('click', () => {
      this.openAuthModal('register');
    });

    actions.append(loginButton, registerButton);
    panel.append(title, actions);

    return panel;
  }

  /**
   * Creates the compact current-user panel with logout control.
   */
  private createSessionPanel(state: AppState): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'session';

    const userBlock = document.createElement('div');
    userBlock.className = 'session-user';

    const name = document.createElement('strong');
    name.textContent = state.currentUser?.displayName ?? '';

    const meta = document.createElement('span');
    meta.textContent = state.currentUser ? `${state.currentUser.login} / ${state.currentUser.role}` : '';

    const logoutButton = document.createElement('button');
    logoutButton.className = 'logout';
    logoutButton.type = 'button';
    logoutButton.textContent = 'Выйти';
    logoutButton.addEventListener('click', () => {
      void this.handleLogout();
    });

    userBlock.append(name, meta);
    wrapper.append(userBlock, logoutButton);

    return wrapper;
  }

  /**
   * Creates a compact admin entry that opens registration reviews in a modal.
   */
  private createAdminApprovalPanel(state: AppState): HTMLElement {
    const hasPendingUsers = state.pendingUsers.length > 0;
    const section = document.createElement('section');
    section.className = hasPendingUsers ? 'admin-approvals has-pending' : 'admin-approvals';

    const header = document.createElement('div');
    header.className = 'admin-approvals-header';

    const title = document.createElement('h2');
    title.textContent = 'Заявки';

    const openButton = document.createElement('button');
    openButton.className = hasPendingUsers ? 'admin-approvals-toggle has-pending' : 'admin-approvals-toggle';
    openButton.type = 'button';
    openButton.textContent = hasPendingUsers ? `Открыть (${state.pendingUsers.length})` : 'Открыть';
    openButton.addEventListener('click', () => {
      this.openAdminApprovalsModal();
    });

    header.append(title, openButton);
    section.append(header);

    return section;
  }

  /**
   * Builds one pending-user row with approve and reject actions.
   */
  private createPendingUserRow(user: PublicUser): HTMLElement {
    const row = document.createElement('article');
    row.className = 'pending-user';

    const identity = document.createElement('div');
    identity.className = 'pending-user-identity';

    const name = document.createElement('strong');
    name.textContent = user.displayName;

    const login = document.createElement('span');
    login.textContent = user.login;

    const actions = document.createElement('div');
    actions.className = 'pending-user-actions';

    const approveButton = document.createElement('button');
    approveButton.className = 'pending-user-approve';
    approveButton.type = 'button';
    approveButton.textContent = 'Подтвердить';
    approveButton.addEventListener('click', () => {
      void this.adminApprovals.review(user.id, 'approve');
    });

    const rejectButton = document.createElement('button');
    rejectButton.className = 'pending-user-reject';
    rejectButton.type = 'button';
    rejectButton.textContent = 'Отклонить';
    rejectButton.addEventListener('click', () => {
      void this.adminApprovals.review(user.id, 'reject');
    });

    identity.append(name, login);
    actions.append(approveButton, rejectButton);
    row.append(identity, actions);

    return row;
  }

  /**
   * Creates the compact global chat-name search above the direct chat list.
   */
  private createChatSearchPanel(): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'chat-search';
    input.type = 'search';
    input.value = this.chatSearchQuery;
    input.placeholder = 'поиск чатов';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'поиск чатов');
    input.addEventListener('input', () => {
      this.updateChatSearchQuery(input.value);
    });

    return input;
  }

  /**
   * Creates list data that switches from direct chats to global search results.
   */
  private createChatListData(state: AppState): ChatListData {
    const searchQuery = this.chatSearchQuery.trim();

    return {
      chats: state.chats,
      activeChatId: state.activeChatId,
      search:
        searchQuery === ''
          ? null
          : {
              query: searchQuery,
              isLoading: this.isChatSearchLoading,
              results: this.createChatSearchResults(state)
            }
    };
  }

  /**
   * Maps global user search matches to rows that can open or create direct chats.
   */
  private createChatSearchResults(state: AppState): ChatSearchResult[] {
    const chatIdByPeerId = new Map(state.chats.map((chat) => [chat.peerId, chat.id]));

    return this.chatSearchResults.map((user) => ({
      userId: user.id,
      title: user.displayName,
      meta: user.login,
      existingChatId: chatIdByPeerId.get(user.id) ?? null
    }));
  }

  /**
   * Creates one auth mode tab button.
   */
  private createAuthTab(label: string, view: AuthView, activeView: AuthView): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = view === activeView ? 'tab is-active' : 'tab';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      this.store.setAuthView(view);
    });

    return button;
  }

  /**
   * Creates the active chat pane with message history and composer.
   */
  private createMainPane(
    state: AppState,
    shouldStickMessagesToBottom: boolean,
    restoredMessageScrollTop: number | null,
    restoredMessageScrollAnchor: MessageListScrollAnchor | null
  ): HTMLElement {
    const mainPane = document.createElement('main');
    mainPane.className = 'main-pane';

    const activeChat = state.chats.find((chat) => chat.id === state.activeChatId) ?? null;
    const header = document.createElement('header');
    header.className = 'chat-header';

    const mobileChatsButton = document.createElement('button');
    mobileChatsButton.className = 'mobile-chats-button';
    mobileChatsButton.type = 'button';
    mobileChatsButton.title = 'Чаты';
    mobileChatsButton.setAttribute('aria-label', 'Вернуться к списку чатов');
    mobileChatsButton.append(createFontAwesomeIcon('chevron-left'));
    mobileChatsButton.addEventListener('click', () => {
      this.closeMobileChatPane();
    });

    const title = document.createElement('h2');
    title.textContent = activeChat?.title ?? (state.currentUser ? 'Личные чаты' : 'Вход');

    header.append(mobileChatsButton, title);

    if (!state.currentUser) {
      mainPane.append(header, this.createEmptyState('Войдите или отправьте заявку на регистрацию.'));
      return mainPane;
    }

    if (!activeChat) {
      mainPane.append(header, this.createEmptyState('Личных чатов пока нет.'));
      return mainPane;
    }

    const messageList = document.createElement('x-message-list') as XMessageList;
    const messagePage = state.messagePages[activeChat.id] ?? null;
    messageList.stickToBottomOnRender = shouldStickMessagesToBottom;
    if (restoredMessageScrollAnchor) {
      messageList.restoredScrollAnchor = restoredMessageScrollAnchor;
    } else {
      messageList.restoredScrollTop = restoredMessageScrollTop;
    }
    messageList.hasMoreOlderMessages = messagePage?.hasMore ?? false;
    messageList.loadingOlderMessages = messagePage?.isLoadingOlder ?? false;
    messageList.data = state.messages.filter((message) => message.chatId === state.activeChatId);
    const composer = document.createElement('x-message-composer');

    // Keep the scroll surface full-width while readable chat content stays constrained.
    const chatBody = document.createElement('section');
    chatBody.className = 'chat-body';

    const composerColumn = document.createElement('div');
    composerColumn.className = 'composer-column';
    composerColumn.append(composer);

    chatBody.append(messageList, composerColumn);

    mainPane.append(header, chatBody);
    return mainPane;
  }

  /**
   * Creates a short empty-state note for unavailable panes.
   */
  private createEmptyState(text: string): HTMLElement {
    const emptyState = document.createElement('section');
    emptyState.className = 'empty-state';
    emptyState.textContent = text;

    return emptyState;
  }

  /**
   * Creates the shared modal layer for forms, content and footer actions.
   */
  private createModalRoot(): HTMLElement {
    const layer = document.createElement('div');
    layer.className = this.activeModal ? 'modal-layer is-open' : 'modal-layer';
    layer.hidden = this.activeModal === null;
    layer.addEventListener('pointerdown', (event) => {
      if (event.target === layer) {
        this.closeModal();
      }
    });

    if (!this.activeModal) {
      return layer;
    }

    const dialog = document.createElement('section');
    dialog.className = 'modal-dialog';
    dialog.role = 'dialog';
    dialog.ariaModal = 'true';
    dialog.setAttribute('aria-labelledby', 'app-modal-title');

    const header = document.createElement('header');
    header.className = 'modal-header';

    const title = document.createElement('h2');
    title.id = 'app-modal-title';
    title.textContent = this.activeModal.title;

    const closeButton = document.createElement('button');
    closeButton.className = 'modal-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Закрыть');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => {
      this.closeModal();
    });

    const body = document.createElement('div');
    body.className = 'modal-body';
    body.append(this.activeModal.content());

    header.append(title, closeButton);
    dialog.append(header, body);
    if (this.activeModal.actions && this.activeModal.actions.length > 0) {
      dialog.append(this.createModalFooter(this.activeModal.actions));
    }

    layer.append(dialog);
    return layer;
  }

  /**
   * Creates footer buttons for the currently open modal.
   */
  private createModalFooter(actions: AppModalAction[]): HTMLElement {
    const footer = document.createElement('footer');
    footer.className = 'modal-footer';

    for (const action of actions) {
      const button = document.createElement('button');
      button.className = `modal-action is-${action.kind ?? 'secondary'}`;
      button.type = 'button';
      button.disabled = action.disabled === true;
      button.textContent = action.label;
      button.addEventListener('click', () => {
        action.onClick();
      });
      footer.append(button);
    }

    return footer;
  }

  /**
   * Opens a shared modal with a title, content builder and optional footer actions.
   */
  private openModal(options: AppModalOptions): void {
    this.activeModal = options;
    this.render(this.store.getState());
    window.requestAnimationFrame(() => {
      this.querySelector<HTMLElement>('.modal-dialog button, .modal-dialog input')?.focus();
    });
  }

  /**
   * Closes the active modal and re-renders the shell.
   */
  private closeModal(): void {
    if (!this.activeModal) {
      return;
    }

    this.activeModal = null;
    this.render(this.store.getState());
  }

  /**
   * Switches the mobile shell between chat navigation and the active conversation.
   */
  private showMobilePane(pane: MobilePane): void {
    this.mobilePane = pane;
    this.render(this.store.getState());
    if (pane === 'chat') {
      this.focusActiveComposerSoon();
    }
  }

  /**
   * Leaves the mobile conversation view so realtime updates cannot mark it as read.
   */
  private closeMobileChatPane(): void {
    this.mobilePane = 'chats';
    this.releaseMessageListBottomLock();
    this.shouldPreserveOlderMessagesAnchor = false;
    this.olderMessagesAnchorChatId = null;
    this.clearChatRoute();
    this.store.closeActiveChat();
  }

  /**
   * Opens account forms in the shared modal and selects the requested tab.
   */
  private openAuthModal(view: AuthView): void {
    this.store.setAuthView(view);
    this.openModal({
      title: 'Аккаунт',
      content: () => this.createAuthModalContent(this.store.getState()),
      actions: [
        {
          label: 'Закрыть',
          kind: 'secondary',
          onClick: () => {
            this.closeModal();
          }
        }
      ]
    });
  }

  /**
   * Builds the login/register modal content with the existing auth components.
   */
  private createAuthModalContent(state: AppState): HTMLElement {
    const content = document.createElement('div');
    content.className = 'auth-modal-content';

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.append(this.createAuthTab('Вход', 'login', state.authView), this.createAuthTab('Регистрация', 'register', state.authView));

    const form = document.createElement(state.authView === 'login' ? 'x-login-form' : 'x-register-form');
    content.append(tabs, form);

    return content;
  }

  /**
   * Opens pending registration requests in the shared modal and refreshes them.
   */
  private openAdminApprovalsModal(): void {
    this.openModal({
      title: 'Заявки на регистрацию',
      content: () => this.createAdminApprovalsModalContent(this.store.getState()),
      actions: [
        {
          label: 'Закрыть',
          kind: 'secondary',
          onClick: () => {
            this.closeModal();
          }
        }
      ]
    });

    void this.adminApprovals.load();
  }

  /**
   * Builds the pending-users review content for the admin modal.
   */
  private createAdminApprovalsModalContent(state: AppState): HTMLElement {
    const content = document.createElement('div');
    content.className = 'admin-approvals-modal-content';

    if (state.pendingUsers.length === 0) {
      const note = document.createElement('p');
      note.className = 'admin-approvals-note';
      note.textContent = 'Нет ожидающих заявок';
      content.append(note);

      return content;
    }

    const list = document.createElement('div');
    list.className = 'admin-approvals-list';
    for (const user of state.pendingUsers) {
      list.append(this.createPendingUserRow(user));
    }

    content.append(list);
    return content;
  }

  /**
   * Restores an existing session cookie and loads the first chat screen.
   */
  private async bootstrapSession(): Promise<void> {
    this.store.setStatusText('Checking session...');

    try {
      const response = await this.apiClient.me();
      this.store.setCurrentUser(response.user);
      this.wsClient.connect();
      await this.loadChatWorkspace(undefined, {
        forceScrollToBottom: true
      });
      void this.adminApprovals.refreshForUser(response.user, {
        quiet: true
      });
    } catch (error) {
      if (error instanceof ApiClientError && error.statusCode === 401) {
        this.store.clearSession('Offline');
        return;
      }

      this.store.setStatusText(this.getErrorMessage(error));
    }
  }

  /**
   * Sends login credentials to the API and loads the user's direct chats.
   */
  private readonly handleLoginSubmit = (event: Event): void => {
    const detail = (event as CustomEvent<LoginFormSubmitDetail>).detail;
    void this.login(detail);
  };

  /**
   * Sends a registration request and leaves the new account pending approval.
   */
  private readonly handleRegisterSubmit = (event: Event): void => {
    const detail = (event as CustomEvent<RegisterFormSubmitDetail>).detail;
    void this.register(detail);
  };

  /**
   * Selects the chat requested by the chat list.
   */
  private readonly handleChatSelect = (event: Event): void => {
    const detail = (event as CustomEvent<{ chatId: string }>).detail;
    void this.openChat(detail.chatId);
  };

  /**
   * Opens an existing direct chat or creates one from a global search result.
   */
  private readonly handleChatSearchResultSelect = (event: Event): void => {
    const detail = (event as CustomEvent<ChatSearchResultSelectDetail>).detail;
    this.clearChatSearch();

    if (detail.existingChatId) {
      void this.openChat(detail.existingChatId);
      return;
    }

    void this.createDirectChat(detail.userId);
  };

  /**
   * Opens the shared app context menu for chat and message entities.
   */
  private readonly handleContextMenuRequest = (event: Event): void => {
    event.preventDefault();
    const detail = (event as CustomEvent<AppContextMenuDetail>).detail;
    const menuRoot = this.querySelector<XContextMenuRoot>('x-context-menu-root');
    menuRoot?.open(detail);
  };

  /**
   * Executes a command chosen from the shared context menu.
   */
  private readonly handleMenuCommand = (event: Event): void => {
    const detail = (event as CustomEvent<AppMenuCommandDetail>).detail;
    void this.executeMenuCommand(detail);
  };

  /**
   * Closes the shared modal from the keyboard when focus is inside the app shell.
   */
  private readonly handleShellKeyDown = (event: Event): void => {
    if (!this.activeModal || !(event instanceof KeyboardEvent) || event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    this.closeModal();
  };

  /**
   * Sends the composed message through the realtime WebSocket protocol.
   */
  private readonly handleMessageSubmit = (event: Event): void => {
    event.preventDefault();
    const detail = (event as CustomEvent<MessageComposerSubmitDetail>).detail;
    const activeChatId = this.store.getState().activeChatId;
    if (!activeChatId) {
      this.store.setStatusText('Choose a chat before sending.');
      return;
    }

    const clientNonce = createUuid();

    // Own outgoing messages should stay visible even when the reader was browsing old history.
    this.forceMessageListBottomUntilLayoutSettles();
    this.store.addLocalMessage(detail.body, clientNonce);

    const sendResult = this.wsClient.sendMessage({
      chatId: activeChatId,
      body: detail.body,
      clientNonce
    });

    if (sendResult === 'queued') {
      this.store.setStatusText('Message queued until realtime reconnects.');
      this.focusActiveComposerSoon();
      return;
    }

    this.store.setStatusText('Sending message...');
    this.focusActiveComposerSoon();
  };

  /**
   * Loads the next older history page when the message list reaches its top edge.
   */
  private readonly handleOlderMessagesRequest = (event: Event): void => {
    event.preventDefault();
    void this.loadOlderActiveChatMessages();
  };

  /**
   * Receives server realtime events and maps them into local chat state.
   */
  private readonly handleRealtimeEvent = (event: ServerEventEnvelope): void => {
    void this.applyRealtimeEvent(event);
  };

  /**
   * Shows compact realtime status and refreshes data after reconnect.
   */
  private readonly handleRealtimeStateChange = (state: WebSocketConnectionState): void => {
    const currentUser = this.store.getState().currentUser;
    if (!currentUser) {
      return;
    }

    if (state === 'connecting') {
      this.store.setStatusText('Realtime connecting...');
      return;
    }

    if (state === 'reconnecting') {
      this.store.setStatusText('Realtime reconnecting...');
      return;
    }

    if (state === 'open') {
      void this.handleRealtimeOpen();
      return;
    }

    if (state === 'closed') {
      this.store.setStatusText('Realtime offline.');
    }
  };

  /**
   * Opens a chat requested from the browser URL when the route changes.
   */
  private readonly handleRouteChange = (): void => {
    const chatId = this.readChatIdFromUrl();
    const state = this.store.getState();
    if (!chatId || !state.currentUser || state.activeChatId === chatId) {
      return;
    }

    if (!state.chats.some((chat) => chat.id === chatId)) {
      this.store.setStatusText('Chat link is unavailable for this account.');
      return;
    }

    void this.openChat(chatId, false);
  };

  /**
   * Performs login and stores the authenticated user.
   */
  private async login(detail: LoginFormSubmitDetail): Promise<void> {
    this.store.setStatusText('Signing in...');

    try {
      const response = await this.apiClient.login(detail);
      this.store.setCurrentUser(response.user);
      this.wsClient.connect();
      await this.loadChatWorkspace(undefined, {
        forceScrollToBottom: true
      });
      void this.adminApprovals.refreshForUser(response.user, {
        quiet: true
      });
      this.closeModal();
    } catch (error) {
      this.store.setStatusText(this.getErrorMessage(error));
    }
  }

  /**
   * Performs registration and returns the user to the login tab.
   */
  private async register(detail: RegisterFormSubmitDetail): Promise<void> {
    this.store.setStatusText('Sending registration...');

    try {
      const response = await this.apiClient.register(detail);
      this.store.setAuthView('login');
      this.store.setStatusText(`Registration sent: ${response.user.displayName}`);
      this.closeModal();
    } catch (error) {
      this.store.setStatusText(this.getErrorMessage(error));
    }
  }

  /**
   * Updates the global chat search and refreshes the list without replacing the input.
   */
  private updateChatSearchQuery(query: string): void {
    this.chatSearchQuery = query;
    this.chatSearchRequestId += 1;
    this.clearChatSearchDebounceTimer();

    const normalizedQuery = query.trim();
    if (normalizedQuery === '') {
      this.chatSearchResults = [];
      this.isChatSearchLoading = false;
      this.refreshChatList();
      return;
    }

    this.chatSearchResults = [];
    this.isChatSearchLoading = true;
    this.refreshChatList();

    const requestId = this.chatSearchRequestId;
    this.chatSearchDebounceTimer = window.setTimeout(() => {
      this.chatSearchDebounceTimer = null;
      void this.searchChatsByName(normalizedQuery, requestId);
    }, 220);
  }

  /**
   * Loads global active-user matches for the current chat search query.
   */
  private async searchChatsByName(query: string, requestId: number): Promise<void> {
    try {
      const response = await this.apiClient.listUsers(query, 20);
      if (requestId !== this.chatSearchRequestId) {
        return;
      }

      this.chatSearchResults = response.users;
      this.isChatSearchLoading = false;
      this.refreshChatList();
    } catch (error) {
      if (requestId !== this.chatSearchRequestId) {
        return;
      }

      this.chatSearchResults = [];
      this.isChatSearchLoading = false;
      this.refreshChatList();
      this.store.setStatusText(this.getErrorMessage(error));
    }
  }

  /**
   * Clears the current chat search and returns the list to direct chats.
   */
  private clearChatSearch(): void {
    this.chatSearchQuery = '';
    this.chatSearchResults = [];
    this.isChatSearchLoading = false;
    this.chatSearchRequestId += 1;
    this.clearChatSearchDebounceTimer();
    this.refreshChatList();
  }

  /**
   * Cancels a pending chat search debounce timer.
   */
  private clearChatSearchDebounceTimer(): void {
    if (this.chatSearchDebounceTimer === null) {
      return;
    }

    window.clearTimeout(this.chatSearchDebounceTimer);
    this.chatSearchDebounceTimer = null;
  }

  /**
   * Updates only the chat list component so typing in the search input keeps focus.
   */
  private refreshChatList(): void {
    const chatList = this.querySelector<XChatList>('x-chat-list');
    if (!chatList) {
      return;
    }

    chatList.data = this.createChatListData(this.store.getState());
  }

  /**
   * Ends the current session and clears user-owned UI state.
   */
  private async handleLogout(): Promise<void> {
    this.store.setStatusText('Signing out...');

    try {
      await this.apiClient.logout();
      this.wsClient.disconnect();
      this.mobilePane = 'chats';
      this.clearChatSearch();
      this.store.clearSession('Offline');
    } catch (error) {
      this.store.setStatusText(this.getErrorMessage(error));
    }
  }

  /**
   * Creates or opens a direct chat with the selected active user.
   */
  private async createDirectChat(userId: string): Promise<void> {
    this.store.setStatusText('Creating chat...');

    try {
      const response = await this.apiClient.createDirectChat({ userId });
      this.mobilePane = 'chat';
      this.pushChatRoute(response.chat.id);
      await this.loadChatWorkspace(response.chat.id, {
        forceScrollToBottom: true
      });
      this.restoreOnlineStatus();
      this.focusActiveComposerSoon();
    } catch (error) {
      this.store.setStatusText(this.getErrorMessage(error));
    }
  }

  /**
   * Refreshes chat data after WebSocket reconnect to catch messages missed while offline.
   */
  private async handleRealtimeOpen(): Promise<void> {
    try {
      const state = this.store.getState();
      await this.loadChatWorkspace(undefined, {
        keepChatClosed: state.activeChatId === null && this.mobilePane === 'chats'
      });
      void this.adminApprovals.refreshForUser(state.currentUser, {
        quiet: true
      });
      this.restoreOnlineStatus();
    } catch (error) {
      if (this.isSessionExpiredError(error)) {
        this.handleSessionExpired();
        return;
      }

      this.store.setStatusText(this.getErrorMessage(error));
    }
  }

  /**
   * Loads direct chats and the active chat's messages.
   */
  private async loadChatWorkspace(
    preferredActiveChatId?: string | null,
    options: LoadChatWorkspaceOptions = {}
  ): Promise<void> {
    const routeChatId = this.readChatIdFromUrl();
    const shouldKeepChatClosed = options.keepChatClosed === true;
    const shouldUseRouteChat = preferredActiveChatId === undefined && !shouldKeepChatClosed;
    const resolvedPreferredChatId =
      shouldKeepChatClosed
        ? null
        : preferredActiveChatId ?? routeChatId ?? this.store.getState().activeChatId;
    const chatsResponse = await this.apiClient.listDirectChats();
    const isRouteChatUnavailable =
      shouldUseRouteChat &&
      routeChatId !== null &&
      !chatsResponse.chats.some((chat) => chat.id === routeChatId);
    if (shouldUseRouteChat && routeChatId !== null && !isRouteChatUnavailable) {
      this.mobilePane = 'chat';
    }

    if (options.forceScrollToBottom) {
      this.forceMessageListBottomUntilLayoutSettles();
    }
    this.store.setDirectChats(chatsResponse.chats, resolvedPreferredChatId, !shouldKeepChatClosed);

    const activeChatId = this.store.getState().activeChatId;
    if (activeChatId) {
      this.replaceChatRoute(activeChatId);
      await this.loadChatMessages(activeChatId, options.forceScrollToBottom === true);
      await this.markChatRead(activeChatId, {
        forceScrollToBottom: options.forceScrollToBottom === true
      });
      if (isRouteChatUnavailable) {
        this.store.setStatusText('Chat link is unavailable for this account.');
      }
    } else {
      this.store.clearMessages();
      if (isRouteChatUnavailable) {
        this.store.setStatusText('Chat link is unavailable for this account.');
      }
    }
  }

  /**
   * Selects a chat, loads its history, and records that the user has read it.
   */
  private async openChat(chatId: string, shouldPushRoute = true): Promise<void> {
    this.forceMessageListBottomUntilLayoutSettles();
    this.mobilePane = 'chat';
    if (shouldPushRoute) {
      this.pushChatRoute(chatId);
    }
    this.store.setActiveChat(chatId);
    this.forceMessageListBottomUntilLayoutSettles();
    this.store.markChatRead(chatId);
    this.focusActiveComposerSoon();
    await this.loadChatMessages(chatId, true);
    await this.markChatRead(chatId, {
      forceScrollToBottom: true
    });
    this.focusActiveComposerSoon();
  }

  /**
   * Loads the visible message history for the selected chat.
   */
  private async loadChatMessages(chatId: string, forceScrollToBottom = false): Promise<void> {
    try {
      const response = await this.apiClient.listChatMessages(chatId, {
        limit: MESSAGE_PAGE_SIZE
      });
      if (forceScrollToBottom) {
        this.forceMessageListBottomUntilLayoutSettles();
      }
      this.store.setMessages(chatId, response.messages, response.page);
    } catch (error) {
      this.store.setStatusText(this.getErrorMessage(error));
    }
  }

  /**
   * Loads the previous message page for the active chat and preserves the viewport anchor.
   */
  private async loadOlderActiveChatMessages(): Promise<void> {
    const state = this.store.getState();
    const activeChatId = state.activeChatId;
    if (!activeChatId) {
      return;
    }

    const messagePage = state.messagePages[activeChatId];
    if (!messagePage?.hasMore || messagePage.isLoadingOlder || messagePage.oldestSeq === null) {
      return;
    }

    this.store.setOlderMessagesLoading(activeChatId, true);

    try {
      const response = await this.apiClient.listChatMessages(activeChatId, {
        limit: MESSAGE_PAGE_SIZE,
        beforeSeq: messagePage.oldestSeq
      });

      this.shouldPreserveOlderMessagesAnchor = true;
      this.olderMessagesAnchorChatId = activeChatId;
      this.store.prependOlderMessages(activeChatId, response.messages, response.page);
      this.restoreOnlineStatus();
    } catch (error) {
      this.store.setOlderMessagesLoading(activeChatId, false);
      this.store.setStatusText(this.getErrorMessage(error));
    }
  }

  /**
   * Persists the read mark while keeping the local badge cleared optimistically.
   */
  private async markChatRead(chatId: string, options: MarkChatReadOptions = {}): Promise<void> {
    if (options.forceScrollToBottom) {
      this.forceMessageListBottomUntilLayoutSettles();
    }

    this.store.markChatRead(chatId);

    try {
      await this.apiClient.markChatRead(chatId);
    } catch (error) {
      this.store.setStatusText(this.getErrorMessage(error));
    }
  }

  /**
   * Routes menu commands to existing app operations without giving the menu business logic.
   */
  private async executeMenuCommand(detail: AppMenuCommandDetail): Promise<void> {
    if (detail.command.id === 'chat.open' && detail.entity.type === 'chat') {
      await this.openChat(detail.entity.chat.id);
      return;
    }

    if (detail.command.id === 'chat.markRead' && detail.entity.type === 'chat') {
      await this.markChatRead(detail.entity.chat.id);
      this.restoreOnlineStatus();
      return;
    }

    if (detail.command.id === 'message.copyText' && detail.entity.type === 'message') {
      await this.copyMessageText(detail.entity.message.body);
    }
  }

  /**
   * Copies plain message text through the browser clipboard when permission allows it.
   */
  private async copyMessageText(body: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(body);
      this.store.setStatusText('Message copied.');
    } catch {
      this.store.setStatusText('Clipboard is unavailable.');
    }
  }

  /**
   * Applies one realtime event from the WebSocket connection.
   */
  private async applyRealtimeEvent(event: ServerEventEnvelope): Promise<void> {
    if (event.type === 'message.ack' && isMessageAckPayload(event.payload)) {
      this.store.acknowledgeServerMessage(event.payload.message, event.payload.clientNonce);
      this.restoreOnlineStatus();
      this.focusActiveComposerSoon();
      return;
    }

    if (event.type === 'message.created' && isMessageCreatedPayload(event.payload)) {
      await this.applyCreatedMessage(event.payload.message);
      return;
    }

    if (event.type === 'error' && isWebSocketErrorPayload(event.payload)) {
      if (event.payload.code === 'session_required') {
        this.handleSessionExpired();
        return;
      }

      this.store.setStatusText(event.payload.message);
    }
  }

  /**
   * Inserts incoming messages or reloads chat navigation when the chat is new to the UI.
   */
  private async applyCreatedMessage(message: MessageDto): Promise<void> {
    const state = this.store.getState();
    const chatExists = state.chats.some((chat) => chat.id === message.chatId);

    if (!chatExists) {
      await this.loadChatWorkspace(state.activeChatId, {
        keepChatClosed: state.activeChatId === null
      });
      this.restoreOnlineStatus();
      return;
    }

    this.store.upsertServerMessage(message);
    if (state.activeChatId === message.chatId) {
      await this.markChatRead(message.chatId);
    }
    this.restoreOnlineStatus();
  }

  /**
   * Reads the chat id encoded in the SPA hash route.
   */
  private readChatIdFromUrl(): string | null {
    const hash = window.location.hash;
    if (!hash.startsWith(CHAT_ROUTE_PREFIX)) {
      return null;
    }

    const encodedRouteToken = hash.slice(CHAT_ROUTE_PREFIX.length).split('?')[0] ?? '';
    if (encodedRouteToken.trim() === '') {
      return null;
    }

    try {
      return decodeChatRouteToken(decodeURIComponent(encodedRouteToken));
    } catch {
      return null;
    }
  }

  /**
   * Adds a browser history entry for a user-selected chat.
   */
  private pushChatRoute(chatId: string): void {
    this.updateChatRoute(chatId, 'push');
  }

  /**
   * Rewrites the current history entry after session restore or route fallback.
   */
  private replaceChatRoute(chatId: string): void {
    this.updateChatRoute(chatId, 'replace');
  }

  /**
   * Removes the active chat hash when the mobile UI returns to chat navigation.
   */
  private clearChatRoute(): void {
    if (!window.location.hash.startsWith(CHAT_ROUTE_PREFIX)) {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.hash = '';
    window.history.replaceState(null, '', nextUrl);
  }

  /**
   * Writes the active chat into the URL without reloading the SPA.
   */
  private updateChatRoute(chatId: string, mode: 'push' | 'replace'): void {
    const nextHash = `${CHAT_ROUTE_PREFIX}${encodeURIComponent(encodeChatRouteToken(chatId))}`;
    if (window.location.hash === nextHash) {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.hash = nextHash;
    if (mode === 'push') {
      window.history.pushState(null, '', nextUrl);
      return;
    }

    window.history.replaceState(null, '', nextUrl);
  }

  /**
   * Restores the header status after a successful background chat action.
   */
  private restoreOnlineStatus(): void {
    const currentUser = this.store.getState().currentUser;
    if (currentUser) {
      this.store.setStatusText(`Online: ${currentUser.displayName}`);
    }
  }

  /**
   * Keeps bottom-following active across quick status and ack renders after a send.
   */
  private forceMessageListBottomUntilLayoutSettles(): void {
    this.shouldForceMessageListBottom = true;
    this.cancelMessageListBottomReleaseFrames();

    // Let the new message list render, mount, and run its own bottom alignment frames.
    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        this.shouldForceMessageListBottom = false;
        this.messageListBottomReleaseFrames = [];
      });
      this.messageListBottomReleaseFrames = [secondFrame];
    });
    this.messageListBottomReleaseFrames = [firstFrame];
  }

  /**
   * Stops any pending bottom-following window when the active feed is closed.
   */
  private releaseMessageListBottomLock(): void {
    this.cancelMessageListBottomReleaseFrames();
    this.shouldForceMessageListBottom = false;
  }

  /**
   * Cancels scheduled frames that would later release forced bottom alignment.
   */
  private cancelMessageListBottomReleaseFrames(): void {
    for (const frameId of this.messageListBottomReleaseFrames) {
      window.cancelAnimationFrame(frameId);
    }
    this.messageListBottomReleaseFrames = [];
  }

  /**
   * Returns the UI to anonymous mode when reconnect proves the session is invalid.
   */
  private handleSessionExpired(): void {
    this.wsClient.disconnect();
    this.mobilePane = 'chats';
    this.activeModal = null;
    this.chatSearchQuery = '';
    this.chatSearchResults = [];
    this.isChatSearchLoading = false;
    this.clearChatSearchDebounceTimer();
    this.clearChatRoute();
    this.store.clearSession('Session expired. Sign in again.');
  }

  /**
   * Detects expired auth on HTTP refreshes triggered after realtime reconnect.
   */
  private isSessionExpiredError(error: unknown): boolean {
    return error instanceof ApiClientError && (error.statusCode === 401 || error.code === 'session_required');
  }

  /**
   * Refocuses the active message composer after shell re-renders settle.
   */
  private focusActiveComposerSoon(): void {
    window.requestAnimationFrame(() => {
      this.querySelector<XMessageComposer>('x-message-composer')?.focusEditor();
    });
  }

  /**
   * Converts unknown API failures into compact user-visible status text.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof ApiClientError) {
      return error.message;
    }

    return 'Request failed.';
  }

}

/**
 * Checks that an unknown realtime payload carries an acknowledged message.
 */
function isMessageAckPayload(payload: unknown): payload is MessageAckPayload {
  return (
    isRecord(payload) &&
    typeof payload.clientNonce === 'string' &&
    isMessageDto(payload.message)
  );
}

/**
 * Checks that an unknown realtime payload carries a created message.
 */
function isMessageCreatedPayload(payload: unknown): payload is MessageCreatedPayload {
  return isRecord(payload) && isMessageDto(payload.message);
}

/**
 * Checks that an unknown realtime payload carries a safe error message.
 */
function isWebSocketErrorPayload(payload: unknown): payload is WebSocketErrorPayload {
  return (
    isRecord(payload) &&
    typeof payload.code === 'string' &&
    typeof payload.message === 'string'
  );
}

/**
 * Checks the message DTO shape before putting realtime payloads into state.
 */
function isMessageDto(value: unknown): value is MessageDto {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.chatId === 'string' &&
    typeof value.seq === 'number' &&
    typeof value.senderId === 'string' &&
    typeof value.senderDisplayName === 'string' &&
    typeof value.body === 'string' &&
    Array.isArray(value.entities) &&
    typeof value.createdAt === 'string'
  );
}

/**
 * Narrows unknown event payloads to object records for local type guards.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Converts internal UUID chat ids into shorter base64url route tokens.
 */
function encodeChatRouteToken(chatId: string): string {
  const uuid = normalizeUuid(chatId);
  if (!uuid) {
    return chatId;
  }

  return bytesToBase64Url(uuidToBytes(uuid));
}

/**
 * Converts short route tokens or legacy UUID hashes back into internal chat ids.
 */
function decodeChatRouteToken(routeToken: string): string | null {
  const uuid = normalizeUuid(routeToken);
  if (uuid) {
    return uuid;
  }

  if (!SHORT_UUID_ROUTE_PATTERN.test(routeToken)) {
    return null;
  }

  const bytes = base64UrlToBytes(routeToken);
  if (!bytes || bytes.length !== 16) {
    return null;
  }

  return bytesToUuid(bytes);
}

/**
 * Normalizes UUID text and rejects route tokens with unexpected shape.
 */
function normalizeUuid(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return UUID_ROUTE_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Packs UUID hex pairs into bytes before browser base64 encoding.
 */
function uuidToBytes(uuid: string): number[] {
  const hex = uuid.replaceAll('-', '');
  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }

  return bytes;
}

/**
 * Rebuilds canonical UUID text from decoded route bytes.
 */
function bytesToUuid(bytes: number[]): string {
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}

/**
 * Encodes binary UUID bytes into URL-safe base64 without padding.
 */
function bytesToBase64Url(bytes: number[]): string {
  const binary = String.fromCharCode(...bytes);

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Decodes URL-safe base64 route tokens back into binary UUID bytes.
 */
function base64UrlToBytes(value: string): number[] | null {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');

  try {
    return [...atob(paddedBase64)].map((symbol) => symbol.charCodeAt(0));
  } catch {
    return null;
  }
}

customElements.define('x-app-shell', XAppShell);
