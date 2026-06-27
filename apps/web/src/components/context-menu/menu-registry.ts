import type { ContextMenuCommand, ContextMenuEntity } from './types.js';

/**
 * Builds the available context commands from the entity state known by the UI.
 */
export function buildContextMenuCommands(entity: ContextMenuEntity): ContextMenuCommand[] {
  if (entity.type === 'chat') {
    return buildChatCommands(entity);
  }

  return buildMessageCommands(entity);
}

/**
 * Creates direct chat commands without leaking chat state into the menu component.
 */
function buildChatCommands(entity: Extract<ContextMenuEntity, { type: 'chat' }>): ContextMenuCommand[] {
  const commands: ContextMenuCommand[] = [
    {
      id: 'chat.open',
      label: 'Открыть чат'
    }
  ];

  // Offer read reset only when the chat actually has something unread.
  if (entity.chat.unreadCount > 0) {
    commands.push({
      id: 'chat.markRead',
      label: 'Пометить прочитанным'
    });
  }

  return commands;
}

/**
 * Creates message commands for the plain text message surface.
 */
function buildMessageCommands(entity: Extract<ContextMenuEntity, { type: 'message' }>): ContextMenuCommand[] {
  return [
    {
      id: 'message.copyText',
      label: 'Копировать текст',
      disabled: entity.message.body.trim() === ''
    }
  ];
}
