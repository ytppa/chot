import type { ChatSummary } from '../../app/store.js';

/**
 * Renders one chat row and emits selection without owning list state.
 */
export class XChatCard extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  private chat: ChatSummary | null = null;

  private selected = false;

  /**
   * Updates the chat data and re-renders the row.
   */
  public set data(chat: ChatSummary) {
    this.chat = chat;
    this.render();
  }

  /**
   * Updates visual selection state from the parent list.
   */
  public set active(value: boolean) {
    this.selected = value;
    this.render();
  }

  /**
   * Renders the row once custom element properties are set.
   */
  public connectedCallback(): void {
    this.render();
  }

  /**
   * Builds the chat row using text nodes for all chat-owned strings.
   */
  private render(): void {
    if (!this.chat) {
      return;
    }

    const button = document.createElement('button');
    button.className = this.selected ? 'card is-active' : 'card';
    button.type = 'button';
    button.addEventListener('click', () => {
      this.dispatchSelect();
    });

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = this.chat.title;

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = this.chat.updatedAtLabel;

    const lastMessage = document.createElement('span');
    lastMessage.className = 'last-message';
    lastMessage.textContent = this.chat.lastMessage;

    const unread = document.createElement('span');
    unread.className = 'unread';
    unread.textContent = this.chat.unreadCount > 0 ? String(this.chat.unreadCount) : '';
    unread.hidden = this.chat.unreadCount === 0;

    button.append(title, time, lastMessage, unread);
    this.root.replaceChildren(this.createStyles(), button);
  }

  /**
   * Emits the selected chat id through Shadow DOM boundaries.
   */
  private dispatchSelect(): void {
    if (!this.chat) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<{ chatId: string }>('chat-select', {
        bubbles: true,
        composed: true,
        detail: {
          chatId: this.chat.id
        }
      })
    );
  }

  /**
   * Defines the compact row layout used by the chat list.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      .card {
        width: 100%;
        min-height: 68px;
        display: grid;
        grid-template-columns: 1fr auto;
        grid-template-rows: auto auto;
        gap: 2px 10px;
        align-items: center;
        border: 0;
        border-radius: var(--radius-md);
        padding: 10px 12px;
        color: var(--color-text);
        background: transparent;
        text-align: left;
      }

      .card:hover,
      .card.is-active {
        background: var(--color-accent-soft);
      }

      .title {
        min-width: 0;
        overflow: hidden;
        font-weight: 650;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .time {
        color: var(--color-text-muted);
        font-size: 12px;
      }

      .last-message {
        min-width: 0;
        overflow: hidden;
        color: var(--color-text-muted);
        font-size: 13px;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .unread {
        min-width: 22px;
        height: 22px;
        display: inline-grid;
        place-items: center;
        border-radius: 999px;
        padding: 0 6px;
        color: #fff;
        background: var(--color-accent);
        font-size: 12px;
        font-weight: 700;
      }
    `;

    return style;
  }
}

customElements.define('x-chat-card', XChatCard);

