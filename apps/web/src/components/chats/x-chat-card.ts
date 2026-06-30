import type { ChatSummary } from '../../app/store.js';
import type { AppContextMenuDetail } from '../context-menu/types.js';

const LONG_PRESS_DELAY_MS = 550;

/**
 * Renders one chat row and emits selection without owning list state.
 */
export class XChatCard extends HTMLElement {
  private chat: ChatSummary | null = null;

  private selected = false;

  private longPressTimer: number | null = null;

  private suppressNextClick = false;

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
      if (this.consumeSuppressedClick()) {
        return;
      }

      this.dispatchSelect();
    });
    button.addEventListener('contextmenu', this.handleContextMenu);
    button.addEventListener('pointerdown', this.handlePointerDown);
    button.addEventListener('pointerup', this.cancelLongPress);
    button.addEventListener('pointercancel', this.cancelLongPress);
    button.addEventListener('pointerleave', this.cancelLongPress);

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = this.chat.title;

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = this.chat.updatedAtLabel;

    const lastMessage = document.createElement('span');
    lastMessage.className = 'last-message';
    lastMessage.textContent = this.chat.lastMessage;

    button.append(title, time, lastMessage);

    // Render the unread badge only when there is an actual unread counter to show.
    if (this.chat.unreadCount > 0) {
      const unread = document.createElement('span');
      unread.className = 'unread';
      unread.textContent = String(this.chat.unreadCount);
      button.append(unread);
    }
    this.replaceChildren(button);
  }

  /**
   * Opens the chat command menu instead of the browser context menu.
   */
  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const point = this.getMenuPoint(event);
    this.dispatchContextMenu(point.clientX, point.clientY);
  };

  /**
   * Starts touch and pen long press handling for context actions.
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
   * Prevents the synthetic click after a successful long press from selecting the chat.
   */
  private consumeSuppressedClick(): boolean {
    if (!this.suppressNextClick) {
      return false;
    }

    this.suppressNextClick = false;
    return true;
  }

  /**
   * Uses pointer coordinates when available and falls back to the row bounds for keyboard context menus.
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
   * Emits the selected chat id without exposing list state to the row.
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
   * Emits the chat context menu request for the shared menu layer.
   */
  private dispatchContextMenu(clientX: number, clientY: number): void {
    if (!this.chat) {
      return;
    }

    const detail: AppContextMenuDetail = {
      clientX,
      clientY,
      entity: {
        type: 'chat',
        chat: this.chat,
        isActive: this.selected
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

}

customElements.define('x-chat-card', XChatCard);
