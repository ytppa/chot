import type { PublicUser } from '@nothing-chat/shared';

import type { ApiClient } from '../services/api-client.js';
import type { AppStore } from './store.js';

export type AdminApprovalReviewAction = 'approve' | 'reject';

export type AdminApprovalsLoadOptions = {
  quiet?: boolean;
};

export type AdminApprovalsControllerOptions = {
  apiClient: ApiClient;
  store: AppStore;
  getErrorMessage: (error: unknown) => string;
  restoreOnlineStatus: () => void;
};

/**
 * Owns admin approval API calls so the app shell only renders approval UI.
 */
export class AdminApprovalsController {
  private readonly apiClient: ApiClient;

  private readonly store: AppStore;

  private readonly getErrorMessage: (error: unknown) => string;

  private readonly restoreOnlineStatus: () => void;

  public constructor(options: AdminApprovalsControllerOptions) {
    this.apiClient = options.apiClient;
    this.store = options.store;
    this.getErrorMessage = options.getErrorMessage;
    this.restoreOnlineStatus = options.restoreOnlineStatus;
  }

  /**
   * Refreshes approval data only for administrators and clears stale data otherwise.
   */
  public async refreshForUser(user: PublicUser | null, options: AdminApprovalsLoadOptions = {}): Promise<void> {
    if (user?.role !== 'admin') {
      this.store.setPendingUsers([]);
      return;
    }

    await this.load(options);
  }

  /**
   * Loads pending user requests and optionally reports progress in the shell status.
   */
  public async load(options: AdminApprovalsLoadOptions = {}): Promise<void> {
    if (options.quiet !== true) {
      this.store.setStatusText('Loading approvals...');
    }

    try {
      const response = await this.apiClient.listPendingUsers();
      this.store.setPendingUsers(response.users);
      if (options.quiet !== true) {
        this.restoreOnlineStatus();
      }
    } catch (error) {
      if (options.quiet !== true) {
        this.store.setStatusText(this.getErrorMessage(error));
      }
    }
  }

  /**
   * Applies an admin decision and removes the reviewed user from the local queue.
   */
  public async review(userId: string, action: AdminApprovalReviewAction): Promise<void> {
    this.store.setStatusText(action === 'approve' ? 'Approving user...' : 'Rejecting user...');

    try {
      if (action === 'approve') {
        await this.apiClient.approveUser(userId);
      } else {
        await this.apiClient.rejectUser(userId);
      }

      this.store.removePendingUser(userId);
      this.restoreOnlineStatus();
    } catch (error) {
      this.store.setStatusText(this.getErrorMessage(error));
    }
  }
}
