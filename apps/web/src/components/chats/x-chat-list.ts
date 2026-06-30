import type { ChatSummary } from '../../app/store.js';
import type { XChatCard } from './x-chat-card.js';

import './x-chat-card.js';

export type ChatListData = {
  chats: ChatSummary[];
  activeChatId: string | null;
  search: ChatListSearchState | null;
};

export type ChatListSearchState = {
  query: string;
  isLoading: boolean;
  results: ChatSearchResult[];
};

export type ChatSearchResult = {
  userId: string;
  title: string;
  meta: string;
  existingChatId: string | null;
};

export type ChatSearchResultSelectDetail = {
  userId: string;
  existingChatId: string | null;
};

/**
 * Renders the direct chat list using chat card custom elements.
 */
export class XChatList extends HTMLElement {
  private chats: ChatSummary[] = [];

  private activeChatId: string | null = null;

  private search: ChatListSearchState | null = null;

  /**
   * Updates list data and re-renders all visible chat rows.
   */
  public set data(data: ChatListData) {
    this.chats = data.chats;
    this.activeChatId = data.activeChatId;
    this.search = data.search;
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
    list.setAttribute('aria-label', this.search ? 'Результаты поиска' : 'Чаты');

    if (this.search) {
      this.renderSearchResults(list, this.search);
      this.replaceChildren(list);
      return;
    }

    for (const chat of this.chats) {
      const card = document.createElement('x-chat-card') as XChatCard;
      card.data = chat;
      card.active = chat.id === this.activeChatId;
      list.append(card);
    }

    this.replaceChildren(list);
  }

  /**
   * Builds global people search rows that can open or create direct chats.
   */
  private renderSearchResults(list: HTMLElement, search: ChatListSearchState): void {
    if (search.isLoading) {
      list.append(this.createNote('Ищем...'));
      return;
    }

    if (search.results.length === 0) {
      list.append(this.createNote('Ничего не найдено'));
      return;
    }

    for (const result of search.results) {
      list.append(this.createSearchResultButton(result));
    }
  }

  /**
   * Creates one search result row and keeps user text out of innerHTML.
   */
  private createSearchResultButton(result: ChatSearchResult): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'search-result';
    button.type = 'button';
    button.addEventListener('click', () => {
      this.dispatchSearchResultSelect(result);
    });

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = result.title;

    const marker = document.createElement('span');
    marker.className = 'marker';
    marker.textContent = result.existingChatId ? 'Чат' : 'Новый';

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = result.meta;

    button.append(title, marker, meta);
    return button;
  }

  /**
   * Creates a compact non-interactive list note.
   */
  private createNote(text: string): HTMLElement {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = text;

    return note;
  }

  /**
   * Sends the selected search result to the shell so it can open or create a chat.
   */
  private dispatchSearchResultSelect(result: ChatSearchResult): void {
    this.dispatchEvent(
      new CustomEvent<ChatSearchResultSelectDetail>('chat-search-result-select', {
        bubbles: true,
        composed: true,
        detail: {
          userId: result.userId,
          existingChatId: result.existingChatId
        }
      })
    );
  }

}

customElements.define('x-chat-list', XChatList);
