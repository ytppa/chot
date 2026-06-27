import type {
  AuthUserResponse,
  ChatMessagesResponse,
  CreateDirectChatRequest,
  DirectChatResponse,
  DirectChatsResponse,
  LoginRequest,
  PendingUsersResponse,
  ReadChatResponse,
  RegisterRequest,
  UsersResponse
} from '@nothing-chat/shared';

export type { LoginRequest, RegisterRequest } from '@nothing-chat/shared';

export type ApiClientOptions = {
  baseUrl?: string;
};

export type ListChatMessagesOptions = {
  limit?: number;
  beforeSeq?: number | null;
};

export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

/**
 * Carries structured API error details to UI code.
 */
export class ApiClientError extends Error {
  public readonly statusCode: number;

  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Wraps HTTP calls so components do not depend on fetch details.
 */
export class ApiClient {
  private readonly baseUrl: string;

  public constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api';
  }

  /**
   * Sends registration data and returns the pending public user.
   */
  public async register(payload: RegisterRequest): Promise<AuthUserResponse> {
    return this.postJson('/auth/register', payload);
  }

  /**
   * Sends login credentials and stores the session cookie returned by the server.
   */
  public async login(payload: LoginRequest): Promise<AuthUserResponse> {
    return this.postJson('/auth/login', payload);
  }

  /**
   * Requests the current authenticated user from the auth API.
   */
  public async me(): Promise<AuthUserResponse> {
    return this.getJson('/auth/me');
  }

  /**
   * Revokes the current session and clears the session cookie.
   */
  public async logout(): Promise<void> {
    await this.request('/auth/logout', {
      method: 'POST'
    });
  }

  /**
   * Loads active users available for starting direct chats.
   */
  public async listUsers(query = '', limit = 20): Promise<UsersResponse> {
    const params = new URLSearchParams({
      limit: String(limit)
    });

    if (query.trim() !== '') {
      params.set('query', query.trim());
    }

    return this.getJson(`/users?${params.toString()}`);
  }

  /**
   * Loads pending accounts for an authenticated administrator.
   */
  public async listPendingUsers(): Promise<PendingUsersResponse> {
    return this.getJson('/admin/pending-users');
  }

  /**
   * Approves a pending account so the user can log in.
   */
  public async approveUser(userId: string): Promise<AuthUserResponse> {
    return this.postJson(`/admin/users/${userId}/approve`, {});
  }

  /**
   * Rejects a pending account and removes it from the approval queue.
   */
  public async rejectUser(userId: string): Promise<AuthUserResponse> {
    return this.postJson(`/admin/users/${userId}/reject`, {});
  }

  /**
   * Loads direct chats visible to the current user.
   */
  public async listDirectChats(): Promise<DirectChatsResponse> {
    return this.getJson('/chats/direct');
  }

  /**
   * Creates or returns an existing direct chat with the selected user.
   */
  public async createDirectChat(payload: CreateDirectChatRequest): Promise<DirectChatResponse> {
    return this.postJson('/chats/direct', payload);
  }

  /**
   * Loads a page of messages for a chat the current user belongs to.
   */
  public async listChatMessages(
    chatId: string,
    options: ListChatMessagesOptions = {}
  ): Promise<ChatMessagesResponse> {
    const params = new URLSearchParams({
      limit: String(options.limit ?? 50)
    });
    if (options.beforeSeq !== undefined && options.beforeSeq !== null) {
      params.set('beforeSeq', String(options.beforeSeq));
    }

    return this.getJson(`/chats/${chatId}/messages?${params.toString()}`);
  }

  /**
   * Marks the selected chat as read for the current user.
   */
  public async markChatRead(chatId: string): Promise<ReadChatResponse> {
    return this.postJson(`/chats/${chatId}/read`, {});
  }

  /**
   * Sends a JSON POST request and parses the JSON response.
   */
  private async postJson<TResponse>(path: string, payload: unknown): Promise<TResponse> {
    const response = await this.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    return response.json() as Promise<TResponse>;
  }

  /**
   * Sends a GET request and parses the JSON response.
   */
  private async getJson<TResponse>(path: string): Promise<TResponse> {
    const response = await this.request(path, {
      method: 'GET'
    });

    return response.json() as Promise<TResponse>;
  }

  /**
   * Sends one HTTP request with cookie credentials and stable error mapping.
   */
  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include'
    });

    if (!response.ok) {
      throw await this.createError(response);
    }

    return response;
  }

  /**
   * Converts API error envelopes and network edge cases into one client error type.
   */
  private async createError(response: Response): Promise<ApiClientError> {
    const fallbackMessage = response.statusText || 'Request failed.';

    try {
      const payload = (await response.json()) as ApiErrorPayload;
      return new ApiClientError(
        response.status,
        payload.error?.code ?? 'request_failed',
        payload.error?.message ?? fallbackMessage
      );
    } catch {
      return new ApiClientError(response.status, 'request_failed', fallbackMessage);
    }
  }
}
