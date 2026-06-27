import { BUTTON_INTERACTION_CSS } from '../../utils/button-interactions.js';
import { FONT_AWESOME_ICON_CSS, createFontAwesomeIcon } from '../../utils/fontawesome.js';

export type MessageComposerSubmitDetail = {
  body: string;
};

/**
 * Renders the plain text message composer.
 */
export class XMessageComposer extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  /**
   * Renders the composer when it enters the document.
   */
  public connectedCallback(): void {
    this.render();
  }

  /**
   * Moves typing focus into the message textarea after the shell opens or updates a chat.
   */
  public focusEditor(): void {
    this.root.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  }

  /**
   * Builds the text area and send button.
   */
  private render(): void {
    const form = document.createElement('form');
    form.className = 'composer';
    form.addEventListener('submit', (event) => {
      this.handleSubmit(event);
    });

    const textarea = document.createElement('textarea');
    textarea.name = 'body';
    textarea.rows = 1;
    textarea.placeholder = 'Сообщение';
    textarea.required = true;
    textarea.addEventListener('keydown', this.handleTextareaKeyDown);

    const sendButton = document.createElement('button');
    sendButton.type = 'submit';
    sendButton.setAttribute('aria-label', 'Отправить сообщение');

    const sendLabel = document.createElement('span');
    sendLabel.className = 'send-label';
    sendLabel.textContent = 'Отправить';

    const sendIcon = createFontAwesomeIcon('paper-plane');
    sendIcon.classList.add('send-icon');

    sendButton.append(sendLabel, sendIcon);

    form.append(textarea, sendButton);
    this.root.replaceChildren(this.createStyles(), form);
  }

  /**
   * Emits a send event with trimmed plain text.
   */
  private handleSubmit(event: SubmitEvent): void {
    event.preventDefault();

    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const body = String(formData.get('body') ?? '').trim();
    if (!body) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<MessageComposerSubmitDetail>('message-compose-submit', {
        bubbles: true,
        composed: true,
        detail: {
          body
        }
      })
    );

    form.reset();
  }

  /**
   * Sends on Enter while keeping Shift+Enter available for a newline.
   */
  private readonly handleTextareaKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing
    ) {
      return;
    }

    event.preventDefault();
    const textarea = event.currentTarget as HTMLTextAreaElement;
    textarea.form?.requestSubmit();
  };

  /**
   * Defines stable composer sizing so typing does not shift the layout.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        min-height: 0;
      }

      ${FONT_AWESOME_ICON_CSS}

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      .composer {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        align-items: end;
        border: 0;
        border-radius: var(--composer-shell-radius, calc(var(--radius-sm) + 12px));
        margin-bottom: var(--composer-bottom-offset, 8px);
        padding: 12px;
        background: var(--color-panel);
      }

      textarea {
        min-width: 0;
        width: 100%;
        min-height: 42px;
        max-height: 120px;
        resize: none;
        overflow-y: auto;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 9px 10px;
        color: var(--color-text);
        background: var(--color-panel);
      }

      button {
        cursor: pointer;
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: 0;
        border-radius: var(--radius-sm);
        padding: 0 14px;
        color: #fff;
        background: var(--color-accent);
      }

      .send-icon {
        display: none;
        width: 16px;
        height: 16px;
      }

      button:disabled {
        cursor: default;
      }

      @media (max-width: 760px) {
        button {
          width: 42px;
          padding: 0;
        }

        .send-label {
          display: none;
        }

        .send-icon {
          display: inline-block;
        }
      }

      ${BUTTON_INTERACTION_CSS}
    `;

    return style;
  }
}

customElements.define('x-message-composer', XMessageComposer);
