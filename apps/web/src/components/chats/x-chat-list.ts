import type { ChatSummary } from '../../app/store.js';
import type { XChatCard } from './x-chat-card.js';

import './x-chat-card.js';

export type ChatListData = {
  chats: ChatSummary[];
  activeChatId: string | null;
};

/**
 * Renders the direct chat list using chat card custom elements.
 */
export class XChatList extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  private chats: ChatSummary[] = [];

  private activeChatId: string | null = null;

  /**
   * Updates list data and re-renders all visible chat rows.
   */
  public set data(data: ChatListData) {
    this.chats = data.chats;
    this.activeChatId = data.activeChatId;
    this.render();
  }

  /**
   * Renders an empty list when no data is available yet.
   */
  public connectedCallback(): void {
    this.render();
  }

  /**
   * Builds the chat list without embedding user text as HTML.
   */
  private render(): void {
    const list = document.createElement('nav');
    list.className = 'list';
    list.setAttribute('aria-label', 'Чаты');

    for (const chat of this.chats) {
      const card = document.createElement('x-chat-card') as XChatCard;
      card.data = chat;
      card.active = chat.id === this.activeChatId;
      list.append(card);
    }

    this.root.replaceChildren(this.createStyles(), list);
  }

  /**
   * Defines the vertical list layout for chat navigation.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      .list {
        display: grid;
        gap: 4px;
      }
    `;

    return style;
  }
}

customElements.define('x-chat-list', XChatList);
