import type { MessageSummary } from '../../app/store.js';
import type { XMessageBubble } from './x-message-bubble.js';

import './x-message-bubble.js';

/**
 * Renders messages for the active chat.
 */
export class XMessageList extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  private messages: MessageSummary[] = [];

  /**
   * Updates message data and re-renders the list.
   */
  public set data(messages: MessageSummary[]) {
    this.messages = messages;
    this.render();
  }

  /**
   * Renders an empty message list when attached before data arrives.
   */
  public connectedCallback(): void {
    this.render();
  }

  /**
   * Builds message rows through message bubble elements.
   */
  private render(): void {
    const list = document.createElement('section');
    list.className = 'list';
    list.setAttribute('aria-label', 'Сообщения');

    for (const message of this.messages) {
      const bubble = document.createElement('x-message-bubble') as XMessageBubble;
      bubble.data = message;
      list.append(bubble);
    }

    this.root.replaceChildren(this.createStyles(), list);
  }

  /**
   * Defines the scrollable message stack used by the shell.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      .list {
        min-height: 0;
        display: grid;
        align-content: end;
        gap: 10px;
        padding: 18px;
      }
    `;

    return style;
  }
}

customElements.define('x-message-list', XMessageList);
