import type { MessageSummary } from '../../app/store.js';
import { BUTTON_INTERACTION_CSS } from '../../utils/button-interactions.js';
import { FONT_AWESOME_ICON_CSS, createFontAwesomeIcon } from '../../utils/fontawesome.js';
import type { MessageBubbleData, MessageGroupPlacement, XMessageBubble } from './x-message-bubble.js';

import './x-message-bubble.js';

const AUTO_SCROLL_THRESHOLD_PX = 300;
const LOAD_OLDER_THRESHOLD_PX = 80;
const MESSAGE_GROUP_WINDOW_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STICKY_DATE_TOP_PX = 8;
const STICKY_DATE_HIDE_DELAY_MS = 2000;
const STICKY_DATE_TOLERANCE_PX = 1;

export type MessageListLoadOlderDetail = {
  reason: 'button' | 'scroll';
};

export type MessageListScrollAnchor = {
  scrollTop: number;
  scrollHeight: number;
};

type RenderableMessage = {
  message: MessageSummary;
  groupPlacement: MessageGroupPlacement;
  showAuthor: boolean;
  groupedWithPrevious: boolean;
};

type DateMessageGroup = {
  key: string;
  label: string;
  messages: RenderableMessage[];
};

/**
 * Renders messages for the active chat and requests older history near the top.
 */
export class XMessageList extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  private messages: MessageSummary[] = [];

  private shouldScrollToBottomOnRender = true;

  private initialScrollTop: number | null = null;

  private scrollAnchor: MessageListScrollAnchor | null = null;

  private hasOlderMessages = false;

  private isLoadingOlderMessages = false;

  private hasRequestedOlderMessages = false;

  private stickyDateIdleTimer: number | null = null;

  /**
   * Updates message data and re-renders the list.
   */
  public set data(messages: MessageSummary[]) {
    this.messages = messages;
    this.render();
  }

  /**
   * Controls whether the next render should stick the viewport to the newest message.
   */
  public set stickToBottomOnRender(value: boolean) {
    this.shouldScrollToBottomOnRender = value;
  }

  /**
   * Restores the previous scroll offset when the user is reading older messages.
   */
  public set restoredScrollTop(value: number | null) {
    this.initialScrollTop = value;
    this.scrollAnchor = null;
  }

  /**
   * Restores the viewport after older messages are prepended above it.
   */
  public set restoredScrollAnchor(value: MessageListScrollAnchor | null) {
    this.scrollAnchor = value;
    this.initialScrollTop = null;
  }

  /**
   * Shows or hides the affordance for loading earlier history.
   */
  public set hasMoreOlderMessages(value: boolean) {
    this.hasOlderMessages = value;
  }

  /**
   * Shows that an older-history request is already in progress.
   */
  public set loadingOlderMessages(value: boolean) {
    this.isLoadingOlderMessages = value;
    if (!value) {
      this.hasRequestedOlderMessages = false;
    }
  }

  /**
   * Renders an empty message list when attached before data arrives.
   */
  public connectedCallback(): void {
    this.addEventListener('scroll', this.handleScroll, { passive: true });
    this.render();
  }

  /**
   * Releases scroll listeners when the list leaves the page.
   */
  public disconnectedCallback(): void {
    this.removeEventListener('scroll', this.handleScroll);
    this.clearStickyDateIdleTimer();
  }

  /**
   * Checks whether the visible area is close enough to the newest message.
   */
  public isNearBottom(thresholdPx = AUTO_SCROLL_THRESHOLD_PX): boolean {
    return this.getDistanceFromBottom() <= thresholdPx;
  }

  /**
   * Returns the current distance between viewport bottom and content bottom.
   */
  public getDistanceFromBottom(): number {
    return Math.max(0, this.scrollHeight - this.clientHeight - this.scrollTop);
  }

  /**
   * Builds message rows through message bubble elements.
   */
  private render(): void {
    const loadOlderButton = document.createElement('button');
    loadOlderButton.className = 'load-older';
    loadOlderButton.type = 'button';
    loadOlderButton.disabled = this.isLoadingOlderMessages;
    loadOlderButton.hidden = !this.hasOlderMessages && !this.isLoadingOlderMessages;
    loadOlderButton.textContent = this.isLoadingOlderMessages ? 'Загружаем...' : 'Загрузить ещё';
    loadOlderButton.addEventListener('click', () => {
      this.requestOlderMessages('button');
    });

    const list = document.createElement('section');
    list.className = 'list';
    list.setAttribute('aria-label', 'Сообщения');

    for (const dateGroup of this.createDateGroups()) {
      list.append(this.createDateGroupElement(dateGroup));
    }

    const bottomAnchor = document.createElement('div');
    bottomAnchor.className = 'bottom-anchor';
    bottomAnchor.setAttribute('aria-hidden', 'true');
    list.append(bottomAnchor);

    const jumpButton = document.createElement('button');
    jumpButton.className = 'jump-to-bottom';
    jumpButton.type = 'button';
    jumpButton.title = 'Вниз';
    jumpButton.setAttribute('aria-label', 'Прокрутить вниз');
    jumpButton.append(createFontAwesomeIcon('chevron-down'));
    jumpButton.addEventListener('click', () => {
      this.scrollToLatestMessage();
    });

    this.root.replaceChildren(this.createStyles(), loadOlderButton, list, jumpButton);
    this.applyInitialScroll();
  }

  /**
   * Splits loaded messages by day and adds per-message grouping metadata.
   */
  private createDateGroups(): DateMessageGroup[] {
    const groups: DateMessageGroup[] = [];

    for (let index = 0; index < this.messages.length; index += 1) {
      const message = this.messages[index];
      if (!message) {
        continue;
      }

      const previousMessage = this.messages[index - 1] ?? null;
      const nextMessage = this.messages[index + 1] ?? null;
      const groupedWithPrevious = previousMessage ? canGroupMessages(previousMessage, message) : false;
      const groupedWithNext = nextMessage ? canGroupMessages(message, nextMessage) : false;
      const dateKey = getMessageDateKey(message);
      const currentGroup = groups.at(-1);
      const renderableMessage: RenderableMessage = {
        message,
        groupPlacement: getGroupPlacement(groupedWithPrevious, groupedWithNext),
        showAuthor: !message.isOwn && !groupedWithPrevious,
        groupedWithPrevious
      };

      if (currentGroup && currentGroup.key === dateKey) {
        currentGroup.messages.push(renderableMessage);
        continue;
      }

      groups.push({
        key: dateKey,
        label: formatDateGroupLabel(message.createdAtMs),
        messages: [renderableMessage]
      });
    }

    return groups;
  }

  /**
   * Builds one dated block so the date badge can stick only inside its own day.
   */
  private createDateGroupElement(dateGroup: DateMessageGroup): HTMLElement {
    const section = document.createElement('section');
    section.className = 'date-group';
    section.dataset.dateKey = dateGroup.key;
    section.append(this.createDateDivider(dateGroup));

    for (const renderableMessage of dateGroup.messages) {
      section.append(this.createMessageBubble(renderableMessage));
    }

    return section;
  }

  /**
   * Creates the service date marker shown between calendar days.
   */
  private createDateDivider(dateGroup: DateMessageGroup): HTMLElement {
    const divider = document.createElement('div');
    divider.className = 'date-divider';

    const time = document.createElement('time');
    time.dateTime = dateGroup.key;
    time.textContent = dateGroup.label;

    divider.append(time);
    return divider;
  }

  /**
   * Creates a message bubble with grouping data derived from neighboring messages.
   */
  private createMessageBubble(renderableMessage: RenderableMessage): XMessageBubble {
    const bubble = document.createElement('x-message-bubble') as XMessageBubble;
    const data: MessageBubbleData = {
      message: renderableMessage.message,
      groupPlacement: renderableMessage.groupPlacement,
      showAuthor: renderableMessage.showAuthor
    };

    bubble.classList.toggle('is-grouped-with-previous', renderableMessage.groupedWithPrevious);
    bubble.data = data;

    return bubble;
  }

  /**
   * Applies the requested scroll behavior after DOM layout has settled.
   */
  private applyInitialScroll(): void {
    window.requestAnimationFrame(() => {
      if (this.shouldScrollToBottomOnRender) {
        this.scheduleScrollToLatestMessage();
        return;
      } else if (this.scrollAnchor) {
        this.scrollTop = this.scrollHeight - this.scrollAnchor.scrollHeight + this.scrollAnchor.scrollTop;
      } else if (this.initialScrollTop !== null) {
        this.scrollTop = this.initialScrollTop;
      }

      this.updateJumpButtonVisibility();
      this.showStickyDateUntilIdle();
      this.requestOlderMessagesIfNeeded();
    });
  }

  /**
   * Repeats bottom alignment across layout frames so freshly rendered content cannot leave the feed at the top.
   */
  private scheduleScrollToLatestMessage(): void {
    this.scrollToLatestMessage();
    window.requestAnimationFrame(() => {
      this.scrollToLatestMessage();
      window.requestAnimationFrame(() => {
        this.scrollToLatestMessage();
      });
    });
  }

  /**
   * Keeps the floating jump button and older-history trigger in sync with scroll.
   */
  private readonly handleScroll = (): void => {
    this.showStickyDateUntilIdle();
    this.updateJumpButtonVisibility();
    this.requestOlderMessagesIfNeeded();
  };

  /**
   * Requests older history when the reader reaches the top edge of loaded messages.
   */
  private requestOlderMessagesIfNeeded(): void {
    if (this.scrollTop > LOAD_OLDER_THRESHOLD_PX) {
      return;
    }

    this.requestOlderMessages('scroll');
  }

  /**
   * Emits one composed event so the shell can fetch the next message page.
   */
  private requestOlderMessages(reason: MessageListLoadOlderDetail['reason']): void {
    if (!this.hasOlderMessages || this.isLoadingOlderMessages || this.hasRequestedOlderMessages) {
      return;
    }

    this.hasRequestedOlderMessages = true;
    this.dispatchEvent(
      new CustomEvent<MessageListLoadOlderDetail>('messages-load-older', {
        bubbles: true,
        composed: true,
        detail: {
          reason
        }
      })
    );
  }

  /**
   * Scrolls to the newest message and hides the jump affordance.
   */
  private scrollToLatestMessage(): void {
    this.scrollTop = Math.max(0, this.scrollHeight - this.clientHeight);
    this.showStickyDateUntilIdle();
    this.updateJumpButtonVisibility();
  }

  /**
   * Shows the sticky date while the reader moves and hides it after scrolling pauses.
   */
  private showStickyDateUntilIdle(): void {
    this.root.querySelectorAll<HTMLElement>('.date-divider.is-idle-hidden').forEach((divider) => {
      divider.classList.remove('is-idle-hidden');
    });
    this.updateStickyDateState();
    this.clearStickyDateIdleTimer();
    this.stickyDateIdleTimer = window.setTimeout(() => {
      this.stickyDateIdleTimer = null;
      this.hideIdleStickyDate();
    }, STICKY_DATE_HIDE_DELAY_MS);
  }

  /**
   * Hides only the date divider that is currently pinned to the top of the feed.
   */
  private hideIdleStickyDate(): void {
    this.updateStickyDateState();
    this.root.querySelector<HTMLElement>('.date-divider.is-stuck')?.classList.add('is-idle-hidden');
  }

  /**
   * Marks the date divider whose day group currently owns the sticky top line.
   */
  private updateStickyDateState(): void {
    this.root.querySelectorAll<HTMLElement>('.date-divider.is-stuck').forEach((divider) => {
      divider.classList.remove('is-stuck');
    });

    const stickyDivider = this.findCurrentStickyDateDivider();
    stickyDivider?.classList.add('is-stuck');
  }

  /**
   * Finds the date group crossing the sticky marker line inside the scroll viewport.
   */
  private findCurrentStickyDateDivider(): HTMLElement | null {
    const hostTop = this.getBoundingClientRect().top;
    const stickyLineY = hostTop + STICKY_DATE_TOP_PX + STICKY_DATE_TOLERANCE_PX;
    let currentDivider: HTMLElement | null = null;

    this.root.querySelectorAll<HTMLElement>('.date-group').forEach((group) => {
      const groupRect = group.getBoundingClientRect();
      if (groupRect.top <= stickyLineY && groupRect.bottom > stickyLineY) {
        currentDivider = group.querySelector<HTMLElement>('.date-divider');
      }
    });

    return currentDivider;
  }

  /**
   * Cancels the pending sticky-date fade timer before creating a new one.
   */
  private clearStickyDateIdleTimer(): void {
    if (this.stickyDateIdleTimer === null) {
      return;
    }

    window.clearTimeout(this.stickyDateIdleTimer);
    this.stickyDateIdleTimer = null;
  }

  /**
   * Shows the jump button only when the reader is away from the bottom of the feed.
   */
  private updateJumpButtonVisibility(): void {
    const jumpButton = this.root.querySelector<HTMLButtonElement>('.jump-to-bottom');
    if (!jumpButton) {
      return;
    }

    jumpButton.hidden = this.isNearBottom();
  }

  /**
   * Defines the scrollable message stack used by the shell.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        min-height: 0;
        container-type: inline-size;
        --message-list-max-width: 720px;
        --message-list-half-width: 360px;
        --jump-to-bottom-gap: 6px;
        --jump-to-bottom-width: 42px;
      }

      ${FONT_AWESOME_ICON_CSS}

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      .list {
        width: min(100%, var(--message-list-max-width));
        min-height: 100%;
        margin: 0 auto;
        display: grid;
        align-content: end;
        padding: 18px;
      }

      .date-group {
        min-width: 0;
        display: grid;
        align-content: start;
      }

      .date-group + .date-group {
        margin-top: 16px;
      }

      .bottom-anchor {
        width: 1px;
        height: 1px;
        pointer-events: none;
      }

      .date-divider {
        position: sticky;
        top: ${STICKY_DATE_TOP_PX}px;
        z-index: 2;
        justify-self: center;
        margin: 0 0 8px;
        pointer-events: none;
        opacity: 1;
        transform: translateY(0);
        transition:
          opacity 180ms ease,
          transform 180ms ease;
      }

      .date-divider.is-stuck.is-idle-hidden {
        opacity: 0;
        transform: translateY(-4px);
      }

      .date-divider time {
        display: block;
        border: 1px solid rgb(148 163 184 / 24%);
        border-radius: 999px;
        padding: 4px 10px;
        color: var(--color-text-muted);
        background: var(--color-panel);
        background: color-mix(in srgb, var(--color-panel) 86%, transparent);
        font-size: 12px;
        line-height: 1.2;
        backdrop-filter: blur(8px);
      }

      x-message-bubble {
        min-width: 0;
        margin-top: 10px;
      }

      x-message-bubble.is-grouped-with-previous {
        margin-top: 3px;
      }

      .load-older {
        cursor: pointer;
        display: block;
        min-height: 32px;
        margin: 14px auto 0;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 0 12px;
        color: var(--color-text);
        background: var(--color-panel);
      }

      .load-older:disabled {
        cursor: default;
        color: var(--color-text-muted);
      }

      .load-older[hidden] {
        display: none;
      }

      .jump-to-bottom {
        cursor: pointer;
        display: grid;
        place-items: center;
        position: sticky;
        bottom: 14px;
        z-index: 2;
        width: var(--jump-to-bottom-width);
        min-height: 42px;
        margin: -48px 0 14px calc(50% + var(--message-list-half-width) + var(--jump-to-bottom-gap));
        border: 0;
        border-radius: 999px;
        padding: 0;
        color: #fff;
        background: var(--color-accent);
        box-shadow: 0 8px 24px rgb(15 23 42 / 18%);
      }

      .jump-to-bottom .fa-icon {
        width: 16px;
        height: 16px;
      }

      @container (max-width: 804px) {
        .jump-to-bottom {
          margin-right: 18px;
          margin-left: auto;
        }
      }

      .jump-to-bottom[hidden] {
        display: none;
      }

      ${BUTTON_INTERACTION_CSS}
    `;

    return style;
  }
}

/**
 * Checks whether two neighboring messages should be rendered as one visual group.
 */
function canGroupMessages(previousMessage: MessageSummary, nextMessage: MessageSummary): boolean {
  return (
    previousMessage.senderId === nextMessage.senderId &&
    getMessageDateKey(previousMessage) === getMessageDateKey(nextMessage) &&
    Math.abs(nextMessage.createdAtMs - previousMessage.createdAtMs) <= MESSAGE_GROUP_WINDOW_MS
  );
}

/**
 * Converts neighbor relations into a compact bubble placement marker.
 */
function getGroupPlacement(groupedWithPrevious: boolean, groupedWithNext: boolean): MessageGroupPlacement {
  if (groupedWithPrevious && groupedWithNext) {
    return 'middle';
  }

  if (groupedWithPrevious) {
    return 'last';
  }

  if (groupedWithNext) {
    return 'first';
  }

  return 'single';
}

/**
 * Returns a local calendar key so cross-midnight messages never merge.
 */
function getMessageDateKey(message: MessageSummary): string {
  const date = createSafeDate(message.createdAtMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Formats the sticky date badge in the same compact style as common messengers.
 */
function formatDateGroupLabel(timestampMs: number): string {
  const date = createSafeDate(timestampMs);
  const todayStart = getLocalDayStart(new Date());
  const messageStart = getLocalDayStart(date);
  const dayDifference = Math.round((todayStart.getTime() - messageStart.getTime()) / DAY_MS);

  if (dayDifference === 0) {
    return 'Сегодня';
  }

  if (dayDifference === 1) {
    return 'Вчера';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

/**
 * Normalizes invalid timestamps to the current date instead of breaking rendering.
 */
function createSafeDate(timestampMs: number): Date {
  if (Number.isFinite(timestampMs) && timestampMs > 0) {
    return new Date(timestampMs);
  }

  return new Date();
}

/**
 * Creates a local midnight date for day-level comparisons.
 */
function getLocalDayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

customElements.define('x-message-list', XMessageList);
