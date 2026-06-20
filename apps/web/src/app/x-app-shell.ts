import type { AppState, AuthView } from './store.js';
import { AppStore } from './store.js';
import type { LoginFormSubmitDetail } from '../components/auth/x-login-form.js';
import type { RegisterFormSubmitDetail } from '../components/auth/x-register-form.js';
import type { ChatListData } from '../components/chats/x-chat-list.js';
import type { MessageComposerSubmitDetail } from '../components/messages/x-message-composer.js';
import type { XChatList } from '../components/chats/x-chat-list.js';
import type { XMessageList } from '../components/messages/x-message-list.js';

/**
 * Owns the first usable chat screen and wires child components to app state.
 */
export class XAppShell extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  private readonly store = new AppStore();

  private unsubscribe: (() => void) | null = null;

  /**
   * Subscribes to state and global component events when the shell is attached.
   */
  public connectedCallback(): void {
    this.addEventListener('auth-login-submit', this.handleLoginSubmit);
    this.addEventListener('auth-register-submit', this.handleRegisterSubmit);
    this.addEventListener('chat-select', this.handleChatSelect);
    this.addEventListener('message-compose-submit', this.handleMessageSubmit);

    this.unsubscribe = this.store.subscribe((state) => {
      this.render(state);
    });
  }

  /**
   * Releases listeners when the shell is detached.
   */
  public disconnectedCallback(): void {
    this.removeEventListener('auth-login-submit', this.handleLoginSubmit);
    this.removeEventListener('auth-register-submit', this.handleRegisterSubmit);
    this.removeEventListener('chat-select', this.handleChatSelect);
    this.removeEventListener('message-compose-submit', this.handleMessageSubmit);
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Builds the full application shell from current state.
   */
  private render(state: AppState): void {
    const frame = document.createElement('div');
    frame.className = 'frame';

    const sidebar = this.createSidebar(state);
    const mainPane = this.createMainPane(state);

    frame.append(sidebar, mainPane);
    this.root.replaceChildren(this.createStyles(), frame);
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
    title.textContent = 'Nothing Chat';

    const status = document.createElement('span');
    status.textContent = state.statusText;

    brand.append(title, status);

    const authPanel = this.createAuthPanel(state.authView);
    const chatList = document.createElement('x-chat-list') as XChatList;
    const chatListData: ChatListData = {
      chats: state.chats,
      activeChatId: state.activeChatId
    };
    chatList.data = chatListData;

    sidebar.append(brand, authPanel, chatList);

    return sidebar;
  }

  /**
   * Creates auth tabs and renders the selected auth form.
   */
  private createAuthPanel(authView: AuthView): HTMLElement {
    const panel = document.createElement('section');
    panel.className = 'auth-panel';

    const tabs = document.createElement('div');
    tabs.className = 'tabs';

    const loginTab = this.createAuthTab('Вход', 'login', authView);
    const registerTab = this.createAuthTab('Регистрация', 'register', authView);

    const form = document.createElement(authView === 'login' ? 'x-login-form' : 'x-register-form');

    tabs.append(loginTab, registerTab);
    panel.append(tabs, form);

    return panel;
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
  private createMainPane(state: AppState): HTMLElement {
    const mainPane = document.createElement('main');
    mainPane.className = 'main-pane';

    const activeChat = state.chats.find((chat) => chat.id === state.activeChatId) ?? null;
    const header = document.createElement('header');
    header.className = 'chat-header';

    const title = document.createElement('h2');
    title.textContent = activeChat?.title ?? 'Чат';

    header.append(title);

    const messageList = document.createElement('x-message-list') as XMessageList;
    messageList.data = state.messages.filter((message) => message.chatId === state.activeChatId);

    const composer = document.createElement('x-message-composer');

    mainPane.append(header, messageList, composer);

    return mainPane;
  }

  /**
   * Handles login form submission until auth endpoints are implemented.
   */
  private readonly handleLoginSubmit = (event: Event): void => {
    const detail = (event as CustomEvent<LoginFormSubmitDetail>).detail;
    this.store.setStatusText(`Login draft: ${detail.login}`);
  };

  /**
   * Handles registration form submission until auth endpoints are implemented.
   */
  private readonly handleRegisterSubmit = (event: Event): void => {
    const detail = (event as CustomEvent<RegisterFormSubmitDetail>).detail;
    this.store.setStatusText(`Pending draft: ${detail.displayName}`);
  };

  /**
   * Selects the chat requested by the chat list.
   */
  private readonly handleChatSelect = (event: Event): void => {
    const detail = (event as CustomEvent<{ chatId: string }>).detail;
    this.store.setActiveChat(detail.chatId);
  };

  /**
   * Adds local plain text messages before realtime persistence exists.
   */
  private readonly handleMessageSubmit = (event: Event): void => {
    const detail = (event as CustomEvent<MessageComposerSubmitDetail>).detail;
    this.store.addLocalMessage(detail.body);
  };

  /**
   * Defines the responsive application layout.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      .frame {
        min-height: 100vh;
        display: grid;
        grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
        background: var(--color-bg);
      }

      .sidebar {
        min-width: 0;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 14px;
        border-right: 1px solid var(--color-border);
        padding: 16px;
        background: var(--color-panel);
      }

      .brand {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }

      h1,
      h2 {
        margin: 0;
        color: var(--color-text);
        font-size: 20px;
        line-height: 1.2;
      }

      .brand span {
        color: var(--color-text-muted);
        font-size: 12px;
      }

      .auth-panel {
        display: grid;
        gap: 14px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 12px;
        background: var(--color-panel-muted);
      }

      .tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }

      .tab {
        min-height: 34px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        background: var(--color-panel);
      }

      .tab.is-active {
        border-color: var(--color-accent);
        color: var(--color-accent-strong);
        background: var(--color-accent-soft);
      }

      .main-pane {
        min-width: 0;
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
      }

      .chat-header {
        min-height: 64px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid var(--color-border);
        padding: 0 18px;
        background: var(--color-panel);
      }

      x-message-list {
        min-height: 0;
        overflow: auto;
      }

      @media (max-width: 760px) {
        .frame {
          grid-template-columns: 1fr;
        }

        .sidebar {
          border-right: 0;
          border-bottom: 1px solid var(--color-border);
        }

        .main-pane {
          min-height: 70vh;
        }
      }
    `;

    return style;
  }
}

customElements.define('x-app-shell', XAppShell);

