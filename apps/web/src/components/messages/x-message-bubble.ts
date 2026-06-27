import type { MessageSummary } from '../../app/store.js';
import { linkifyText, type LinkifiedTextPart } from '../../utils/linkify.js';
import type { AppContextMenuDetail } from '../context-menu/types.js';

const LONG_PRESS_DELAY_MS = 550;

export type MessageGroupPlacement = 'single' | 'first' | 'middle' | 'last';

export type MessageBubbleData = {
  message: MessageSummary;
  groupPlacement: MessageGroupPlacement;
  showAuthor: boolean;
};

/**
 * Renders one plain text message bubble.
 */
export class XMessageBubble extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  private message: MessageSummary | null = null;

  private groupPlacement: MessageGroupPlacement = 'single';

  private showAuthor = true;

  private longPressTimer: number | null = null;

  private suppressNextClick = false;

  /**
   * Updates message data and its visual group metadata, then re-renders the bubble.
   */
  public set data(data: MessageSummary | MessageBubbleData) {
    if (isMessageBubbleData(data)) {
      this.message = data.message;
      this.groupPlacement = data.groupPlacement;
      this.showAuthor = data.showAuthor;
      this.render();
      return;
    }

    this.message = data;
    this.groupPlacement = 'single';
    this.showAuthor = true;
    this.render();
  }

  /**
   * Renders once the element is attached and has data.
   */
  public connectedCallback(): void {
    this.render();
  }

  /**
   * Builds message DOM using text nodes and safe anchors for user-controlled strings.
   */
  private render(): void {
    if (!this.message) {
      return;
    }

    const article = document.createElement('article');
    article.className = [
      'bubble',
      this.message.isOwn ? 'is-own' : 'is-incoming',
      `is-group-${this.groupPlacement}`
    ].join(' ');
    article.addEventListener('click', this.handleClick, true);
    article.addEventListener('contextmenu', this.handleContextMenu);
    article.addEventListener('pointerdown', this.handlePointerDown);
    article.addEventListener('pointerup', this.cancelLongPress);
    article.addEventListener('pointercancel', this.cancelLongPress);
    article.addEventListener('pointerleave', this.cancelLongPress);

    const meta = document.createElement('div');
    meta.className = 'meta';

    const sender = document.createElement('span');
    sender.className = 'sender';
    sender.textContent = this.message.senderName;

    const body = document.createElement('p');
    body.className = 'body';
    body.append(...this.renderBodyParts(this.message.body), this.createTimeSpacer(), this.createMessageTime());

    meta.append(sender);
    if (this.showAuthor) {
      article.append(meta);
    }
    article.append(body);
    this.root.replaceChildren(this.createStyles(), article);
  }

  /**
   * Reserves last-line space so the floating timestamp only fits when the line has room.
   */
  private createTimeSpacer(): HTMLSpanElement {
    const spacer = document.createElement('span');
    spacer.className = 'time-spacer';
    spacer.setAttribute('aria-hidden', 'true');

    return spacer;
  }

  /**
   * Creates the timestamp that floats to the visual end of the message body.
   */
  private createMessageTime(): HTMLTimeElement {
    const time = document.createElement('time');
    time.className = 'message-time';
    time.textContent = this.message?.createdAtLabel ?? '';

    return time;
  }

  /**
   * Opens the message command menu instead of the browser context menu.
   */
  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const point = this.getMenuPoint(event);
    this.dispatchContextMenu(point.clientX, point.clientY);
  };

  /**
   * Starts touch and pen long press handling for message actions.
   */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') {
      return;
    }

    this.cancelLongPress();
    const { clientX, clientY } = event;
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      this.suppressNextClick = true;
      this.dispatchContextMenu(clientX, clientY);
    }, LONG_PRESS_DELAY_MS);
  };

  /**
   * Prevents an accidental link click after a successful long press menu gesture.
   */
  private readonly handleClick = (event: MouseEvent): void => {
    if (!this.consumeSuppressedClick()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  /**
   * Cancels pending long press detection when the gesture becomes a normal tap.
   */
  private readonly cancelLongPress = (): void => {
    if (this.longPressTimer === null) {
      return;
    }

    window.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  };

  /**
   * Consumes the synthetic click that touch browsers may emit after long press.
   */
  private consumeSuppressedClick(): boolean {
    if (!this.suppressNextClick) {
      return false;
    }

    this.suppressNextClick = false;
    return true;
  }

  /**
   * Uses pointer coordinates when available and falls back to the bubble bounds for keyboard context menus.
   */
  private getMenuPoint(event: MouseEvent): { clientX: number; clientY: number } {
    if (event.clientX !== 0 || event.clientY !== 0) {
      return {
        clientX: event.clientX,
        clientY: event.clientY
      };
    }

    const target = event.currentTarget;
    const element = target instanceof HTMLElement ? target : this;
    const rect = element.getBoundingClientRect();

    return {
      clientX: rect.left + 12,
      clientY: rect.top + 12
    };
  }

  /**
   * Converts message text into DOM nodes while keeping all user text out of HTML strings.
   */
  private renderBodyParts(body: string): Node[] {
    return linkifyText(body).map((part) => this.renderBodyPart(part));
  }

  /**
   * Renders one parsed text part as either a text node or a safe external link.
   */
  private renderBodyPart(part: LinkifiedTextPart): Node {
    if (part.type === 'text') {
      return document.createTextNode(part.text);
    }

    const link = document.createElement('a');
    link.href = part.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(document.createTextNode(part.text));

    return link;
  }

  /**
   * Emits the message context menu request through Shadow DOM boundaries.
   */
  private dispatchContextMenu(clientX: number, clientY: number): void {
    if (!this.message) {
      return;
    }

    const detail: AppContextMenuDetail = {
      clientX,
      clientY,
      entity: {
        type: 'message',
        message: this.message
      }
    };

    this.dispatchEvent(
      new CustomEvent<AppContextMenuDetail>('app-context-menu', {
        bubbles: true,
        composed: true,
        detail
      })
    );
  }

  /**
   * Defines compact bubble styles for incoming and outgoing messages.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        min-width: 0;
      }

      .bubble {
        box-sizing: border-box;
        width: fit-content;
        min-width: min(20ch, 100%);
        max-width: 90%;
        display: grid;
        gap: 3px;
        margin-right: auto;
        border: 0;
        border-radius: 16px;
        padding: 8px 11px 7px;
        background: var(--color-panel);
      }

      .bubble.is-own {
        margin-right: 0;
        margin-left: auto;
        background: var(--color-accent-soft);
      }

      .bubble.is-group-first.is-incoming,
      .bubble.is-group-middle.is-incoming {
        border-bottom-left-radius: 3px;
      }

      .bubble.is-group-middle.is-incoming,
      .bubble.is-group-last.is-incoming {
        border-top-left-radius: 3px;
      }

      .bubble.is-group-first.is-own,
      .bubble.is-group-middle.is-own {
        border-bottom-right-radius: 3px;
      }

      .bubble.is-group-middle.is-own,
      .bubble.is-group-last.is-own {
        border-top-right-radius: 3px;
      }

      .meta {
        min-width: 0;
        color: var(--color-text);
        font-size: 12px;
      }

      .sender {
        color: var(--color-text);
        font-weight: 650;
      }

      .body {
        margin: 0;
        color: var(--color-text);
        line-height: 1.35;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
      }

      .body::after {
        content: '';
        display: block;
        clear: both;
      }

      .time-spacer {
        display: inline-block;
        width: 44px;
        height: 1px;
      }

      .message-time {
        float: right;
        margin: 4px 0 -1px 8px;
        color: rgb(102 113 126 / 72%);
        font-size: 11px;
        line-height: 1.35;
        white-space: nowrap;
      }

      .bubble.is-own .message-time {
        color: rgb(15 79 168 / 56%);
      }

      a {
        color: var(--color-accent);
        text-decoration: underline;
        text-underline-offset: 2px;
        overflow-wrap: anywhere;
      }
    `;

    return style;
  }
}

/**
 * Distinguishes full render metadata from the legacy direct message setter payload.
 */
function isMessageBubbleData(value: MessageSummary | MessageBubbleData): value is MessageBubbleData {
  return 'message' in value;
}

customElements.define('x-message-bubble', XMessageBubble);
