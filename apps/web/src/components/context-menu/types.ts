import type { ChatSummary, MessageSummary } from '../../app/store.js';

export type ContextMenuCommandId = 'chat.open' | 'chat.markRead' | 'message.copyText';

export type ContextMenuEntity =
  | {
      type: 'chat';
      chat: ChatSummary;
      isActive: boolean;
    }
  | {
      type: 'message';
      message: MessageSummary;
    };

export type ContextMenuCommand = {
  id: ContextMenuCommandId;
  label: string;
  disabled?: boolean;
};

export type AppContextMenuDetail = {
  clientX: number;
  clientY: number;
  entity: ContextMenuEntity;
};

export type AppMenuCommandDetail = {
  command: ContextMenuCommand;
  entity: ContextMenuEntity;
};
