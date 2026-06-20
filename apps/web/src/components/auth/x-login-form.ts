export type LoginFormSubmitDetail = {
  login: string;
  password: string;
};

/**
 * Renders the login form and emits credentials without knowing auth transport details.
 */
export class XLoginForm extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  /**
   * Renders the form when the element enters the document.
   */
  public connectedCallback(): void {
    this.render();
  }

  /**
   * Builds the login form DOM with stable controls and labels.
   */
  private render(): void {
    const form = document.createElement('form');
    form.className = 'form';
    form.addEventListener('submit', (event) => {
      this.handleSubmit(event);
    });

    const title = document.createElement('h2');
    title.textContent = 'Вход';

    const loginInput = this.createInput('login', 'Логин', 'text');
    const passwordInput = this.createInput('password', 'Пароль', 'password');

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = 'Войти';

    form.append(title, loginInput.wrapper, passwordInput.wrapper, submitButton);
    this.root.replaceChildren(this.createStyles(), form);
  }

  /**
   * Creates one labeled input group for auth fields.
   */
  private createInput(name: string, labelText: string, type: string): { wrapper: HTMLLabelElement } {
    const wrapper = document.createElement('label');
    const label = document.createElement('span');
    const input = document.createElement('input');

    label.textContent = labelText;
    input.name = name;
    input.type = type;
    input.required = true;
    input.autocomplete = name === 'password' ? 'current-password' : 'username';

    wrapper.append(label, input);

    return { wrapper };
  }

  /**
   * Emits a composed event so the app shell can handle login from outside Shadow DOM.
   */
  private handleSubmit(event: SubmitEvent): void {
    event.preventDefault();

    const formData = new FormData(event.currentTarget as HTMLFormElement);
    this.dispatchEvent(
      new CustomEvent<LoginFormSubmitDetail>('auth-login-submit', {
        bubbles: true,
        composed: true,
        detail: {
          login: String(formData.get('login') ?? ''),
          password: String(formData.get('password') ?? '')
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

customElements.define('x-login-form', XLoginForm);

