export type RegisterRequest = {
  login: string;
  password: string;
  displayName: string;
};

export type LoginRequest = {
  login: string;
  password: string;
};

export type ApiClientOptions = {
  baseUrl?: string;
};

/**
 * Wraps HTTP calls so components do not depend on fetch details.
 */
export class ApiClient {
  private readonly baseUrl: string;

  public constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api';
  }

  /**
   * Sends registration data to the future auth API.
   */
  public async register(payload: RegisterRequest): Promise<Response> {
    return this.post('/auth/register', payload);
  }

  /**
   * Sends login credentials to the future auth API.
   */
  public async login(payload: LoginRequest): Promise<Response> {
    return this.post('/auth/login', payload);
  }

  /**
   * Requests the current authenticated user from the future auth API.
   */
  public async me(): Promise<Response> {
    return fetch(`${this.baseUrl}/auth/me`, {
      credentials: 'include'
    });
  }

  /**
   * Sends a JSON POST request with cookie credentials included.
   */
  private async post(path: string, payload: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  }
}

