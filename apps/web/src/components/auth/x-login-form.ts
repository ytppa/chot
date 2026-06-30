export type LoginFormSubmitDetail = {
  login: string;
  password: string;
};

type DebugLoginPreset = {
  label: string;
  login: string;
  password: string;
};

const DEBUG_LOGIN_PRESETS: DebugLoginPreset[] = [
  {
    label: 'admin',
    login: 'admin',
    password: 'admin'
  },
  {
    label: 'user1',
    login: 'user1',
    password: 'user'
  },
  {
    label: 'user2',
    login: 'user2',
    password: 'user'
  }
];

/**
 * Renders the login form and emits credentials without knowing auth transport details.
 */
export class XLoginForm extends HTMLElement {
  private submitLocked = false;

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

    const debugLoginPanel = this.createDebugLoginPanel();
    const loginInput = this.createInput('login', 'Логин', 'text');
    const passwordInput = this.createInput('password', 'Пароль', 'password');

    const submitButton = document.createElement('button');
    submitButton.type = 'button';
    submitButton.textContent = 'Войти';
    submitButton.addEventListener('click', () => {
      this.submitForm(form);
    });
    submitButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.submitForm(form);
    });

    form.append(title);
    if (debugLoginPanel) {
      form.append(debugLoginPanel);
    }
    form.append(loginInput, passwordInput, submitButton);
    this.replaceChildren(form);
  }

  /**
   * Creates local development shortcuts for quickly switching between seeded users.
   */
  private createDebugLoginPanel(): HTMLElement | null {
    if (!import.meta.env.DEV) {
      return null;
    }

    const panel = document.createElement('div');
    panel.className = 'debug-logins';
    panel.setAttribute('aria-label', 'Быстрый вход');

    for (const preset of DEBUG_LOGIN_PRESETS) {
      panel.append(this.createDebugLoginButton(preset));
    }

    return panel;
  }

  /**
   * Creates one debug login shortcut that reuses the normal auth event contract.
   */
  private createDebugLoginButton(preset: DebugLoginPreset): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'debug-login-button';
    button.type = 'button';
    button.textContent = preset.label;
    button.addEventListener('click', () => {
      this.submitCredentials({
        login: preset.login,
        password: preset.password
      });
    });

    return button;
  }

  /**
   * Creates one compact auth input with placeholder text instead of a visible label.
   */
  private createInput(name: string, labelText: string, type: string): HTMLInputElement {
    const input = document.createElement('input');

    input.name = name;
    input.type = type;
    input.placeholder = labelText;
    input.setAttribute('aria-label', labelText);
    input.required = true;
    input.autocomplete = name === 'password' ? 'current-password' : 'username';

    return input;
  }

  /**
   * Emits a login event so the app shell can handle credentials outside the form component.
   */
  private handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    this.submitForm(event.currentTarget as HTMLFormElement);
  }

  /**
   * Reads credentials and emits them to the app shell.
   */
  private submitForm(form: HTMLFormElement): void {
    if (this.submitLocked) {
      return;
    }

    if (!form.reportValidity()) {
      return;
    }

    const formData = new FormData(form);
    this.submitCredentials({
      login: String(formData.get('login') ?? ''),
      password: String(formData.get('password') ?? '')
    });
  }

  /**
   * Emits the normalized credentials and briefly locks repeated submissions.
   */
  private submitCredentials(detail: LoginFormSubmitDetail): void {
    if (this.submitLocked) {
      return;
    }

    this.submitLocked = true;
    window.setTimeout(() => {
      this.submitLocked = false;
    }, 750);

    this.dispatchEvent(
      new CustomEvent<LoginFormSubmitDetail>('auth-login-submit', {
        bubbles: true,
        composed: true,
        detail
      })
    );
  }

}

customElements.define('x-login-form', XLoginForm);
