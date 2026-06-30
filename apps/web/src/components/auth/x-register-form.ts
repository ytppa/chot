export type RegisterFormSubmitDetail = {
  login: string;
  password: string;
  displayName: string;
};

/**
 * Renders the registration form for pending user requests.
 */
export class XRegisterForm extends HTMLElement {
  private submitLocked = false;

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
    submitButton.type = 'button';
    submitButton.textContent = 'Отправить';
    submitButton.addEventListener('click', () => {
      this.submitForm(form);
    });
    submitButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.submitForm(form);
    });

    form.append(title, displayNameInput.wrapper, loginInput.wrapper, passwordInput.wrapper, submitButton);
    this.replaceChildren(form);
  }

  /**
   * Creates one labeled input group with browser validation matching the API contract.
   */
  private createInput(name: string, labelText: string, type: string): { wrapper: HTMLLabelElement } {
    const wrapper = document.createElement('label');
    const label = document.createElement('span');
    const input = document.createElement('input');
    const hint = this.createInputHint(name);

    label.textContent = labelText;
    input.name = name;
    input.type = type;
    input.required = true;
    input.autocomplete = name === 'password' ? 'new-password' : 'username';
    this.applyInputRules(input, name);

    wrapper.append(label, input);
    if (hint) {
      wrapper.append(hint);
    }

    return { wrapper };
  }

  /**
   * Adds constraints before submit so invalid payloads are caught in the browser.
   */
  private applyInputRules(input: HTMLInputElement, name: string): void {
    if (name === 'login') {
      input.minLength = 3;
      input.maxLength = 64;
      return;
    }

    if (name === 'password') {
      input.minLength = 8;
      input.maxLength = 256;
      return;
    }

    if (name === 'displayName') {
      input.maxLength = 120;
    }
  }

  /**
   * Creates a compact hint for fields where validation is not obvious.
   */
  private createInputHint(name: string): HTMLSpanElement | null {
    if (name !== 'password') {
      return null;
    }

    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'Минимум 8 символов';

    return hint;
  }

  /**
   * Emits a registration event so the app shell can send the request.
   */
  private handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    this.submitForm(event.currentTarget as HTMLFormElement);
  }

  /**
   * Reads registration data and emits it to the app shell.
   */
  private submitForm(form: HTMLFormElement): void {
    if (this.submitLocked) {
      return;
    }

    if (!form.reportValidity()) {
      return;
    }

    this.submitLocked = true;
    window.setTimeout(() => {
      this.submitLocked = false;
    }, 750);

    const formData = new FormData(form);
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

}

customElements.define('x-register-form', XRegisterForm);
