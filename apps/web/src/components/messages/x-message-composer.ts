import { createFontAwesomeIcon } from '../../utils/fontawesome.js';

export type MessageComposerSubmitDetail = {
  body: string;
};

/**
 * Renders the plain text message composer.
 */
export class XMessageComposer extends HTMLElement {
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
    this.querySelector<HTMLTextAreaElement>('textarea')?.focus();
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
    this.replaceChildren(form);
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

}

customElements.define('x-message-composer', XMessageComposer);
