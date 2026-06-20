import type { MessageSummary } from '../../app/store.js';

/**
 * Renders one plain text message bubble.
 */
export class XMessageBubble extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  private message: MessageSummary | null = null;

  /**
   * Updates message data and re-renders the bubble.
   */
  public set data(message: MessageSummary) {
    this.message = message;
    this.render();
  }

  /**
   * Renders once the element is attached and has data.
   */
  public connectedCallback(): void {
    this.render();
  }

  /**
   * Builds message DOM using textContent for user-controlled strings.
   */
  private render(): void {
    if (!this.message) {
      return;
    }

    const article = document.createElement('article');
    article.className = this.message.isOwn ? 'bubble is-own' : 'bubble';

    const meta = document.createElement('div');
    meta.className = 'meta';

    const sender = document.createElement('span');
    sender.className = 'sender';
    sender.textContent = this.message.senderName;

    const time = document.createElement('time');
    time.textContent = this.message.createdAtLabel;

    const body = document.createElement('p');
    body.textContent = this.message.body;

    meta.append(sender, time);
    article.append(meta, body);
    this.root.replaceChildren(this.createStyles(), article);
  }

  /**
   * Defines compact bubble styles for incoming and outgoing messages.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      .bubble {
        max-width: min(620px, 86%);
        display: grid;
        gap: 4px;
        justify-self: start;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 9px 11px;
        background: var(--color-panel);
      }

      .bubble.is-own {
        justify-self: end;
        border-color: #c5d9f8;
        background: var(--color-accent-soft);
      }

      .meta {
        display: flex;
        gap: 8px;
        align-items: baseline;
        color: var(--color-text-muted);
        font-size: 12px;
      }

      .sender {
        color: var(--color-text);
        font-weight: 650;
      }

      p {
        margin: 0;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
      }
    `;

    return style;
  }
}

customElements.define('x-message-bubble', XMessageBubble);

