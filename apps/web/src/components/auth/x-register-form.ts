export type RegisterFormSubmitDetail = {
  login: string;
  password: string;
  displayName: string;
};

/**
 * Renders the registration form for pending user requests.
 */
export class XRegisterForm extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  /**
   * Renders the form when the element enters the document.
   */
  public connectedCallback(): void {
    this.render();
  }

  /**
   * Builds the registration form DOM.
   */
  private render(): void {
    const form = document.createElement('form');
    form.className = 'form';
    form.addEventListener('submit', (event) => {
      this.handleSubmit(event);
    });

    const title = document.createElement('h2');
    title.textContent = 'Регистрация';

    const displayNameInput = this.createInput('displayName', 'Имя', 'text');
    const loginInput = this.createInput('login', 'Логин', 'text');
    const passwordInput = this.createInput('password', 'Пароль', 'password');

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = 'Отправить';

    form.append(title, displayNameInput.wrapper, loginInput.wrapper, passwordInput.wrapper, submitButton);
    this.root.replaceChildren(this.createStyles(), form);
  }

  /**
   * Creates one labeled input group for registration fields.
   */
  private createInput(name: string, labelText: string, type: string): { wrapper: HTMLLabelElement } {
    const wrapper = document.createElement('label');
    const label = document.createElement('span');
    const input = document.createElement('input');

    label.textContent = labelText;
    input.name = name;
    input.type = type;
    input.required = true;
    input.autocomplete = name === 'password' ? 'new-password' : 'username';

    wrapper.append(label, input);

    return { wrapper };
  }

  /**
   * Emits a composed event so the app shell can send the registration request.
   */
  private handleSubmit(event: SubmitEvent): void {
    event.preventDefault();

    const formData = new FormData(event.currentTarget as HTMLFormElement);
    this.dispatchEvent(
      new CustomEvent<RegisterFormSubmitDetail>('auth-register-submit', {
        bubbles: true,
        composed: true,
        detail: {
          login: String(formData.get('login') ?? ''),
          password: String(formData.get('password') ?? ''),
          displayName: String(formData.get('displayName') ?? '')
        }
      })
    );
  }

  /**
   * Defines local form styles without leaking selectors into the app shell.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      .form {
        display: grid;
        gap: 14px;
      }

      h2 {
        margin: 0 0 4px;
        font-size: 20px;
        line-height: 1.2;
      }

      label {
        display: grid;
        gap: 6px;
        color: var(--color-text-muted);
        font-size: 13px;
      }

      input {
        width: 100%;
        min-height: 40px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 8px 10px;
        color: var(--color-text);
        background: var(--color-panel);
      }

      button {
        min-height: 40px;
        border: 0;
        border-radius: var(--radius-sm);
        padding: 8px 14px;
        color: #fff;
        background: var(--color-accent);
      }
    `;

    return style;
  }
}

customElements.define('x-register-form', XRegisterForm);

