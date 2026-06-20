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

    const sendButton = document.createElement('button');
    sendButton.type = 'submit';
    sendButton.textContent = 'Отправить';

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
   * Defines stable composer sizing so typing does not shift the layout.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      .composer {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        align-items: end;
        border-top: 1px solid var(--color-border);
        padding: 12px;
        background: var(--color-panel);
      }

      textarea {
        min-height: 42px;
        max-height: 120px;
        resize: vertical;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 9px 10px;
        color: var(--color-text);
        background: var(--color-panel);
      }

      button {
        min-height: 42px;
        border: 0;
        border-radius: var(--radius-sm);
        padding: 0 14px;
        color: #fff;
        background: var(--color-accent);
      }
    `;

    return style;
  }
}

customElements.define('x-message-composer', XMessageComposer);

