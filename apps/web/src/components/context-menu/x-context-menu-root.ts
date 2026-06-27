import { BUTTON_INTERACTION_CSS } from '../../utils/button-interactions.js';
import { buildContextMenuCommands } from './menu-registry.js';
import type {
  AppContextMenuDetail,
  AppMenuCommandDetail,
  ContextMenuCommand,
  ContextMenuEntity
} from './types.js';

type OpenMenuState = {
  x: number;
  y: number;
  entity: ContextMenuEntity;
  commands: ContextMenuCommand[];
  activeIndex: number;
};

const MENU_MARGIN_PX = 8;
const MENU_WIDTH_PX = 220;
const MENU_ROW_HEIGHT_PX = 38;
const MENU_VERTICAL_PADDING_PX = 12;

/**
 * Owns the single floating context menu layer for chat UI commands.
 */
export class XContextMenuRoot extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  private menuState: OpenMenuState | null = null;

  /**
   * Starts global listeners that close or steer the open menu.
   */
  public connectedCallback(): void {
    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.addEventListener('keydown', this.handleDocumentKeyDown, true);
    window.addEventListener('scroll', this.handleGlobalClose, true);
    window.addEventListener('resize', this.handleGlobalClose);
    this.render();
  }

  /**
   * Removes global listeners when the root leaves the app shell.
   */
  public disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.removeEventListener('keydown', this.handleDocumentKeyDown, true);
    window.removeEventListener('scroll', this.handleGlobalClose, true);
    window.removeEventListener('resize', this.handleGlobalClose);
  }

  /**
   * Opens a menu for the requested UI entity at a viewport position.
   */
  public open(detail: AppContextMenuDetail): void {
    const commands = buildContextMenuCommands(detail.entity);
    if (commands.length === 0) {
      this.close();
      return;
    }

    this.menuState = {
      ...this.calculateMenuPosition(detail.clientX, detail.clientY, commands.length),
      entity: detail.entity,
      commands,
      activeIndex: findFirstEnabledCommandIndex(commands)
    };

    this.render();
    window.requestAnimationFrame(() => {
      this.focusActiveCommand();
    });
  }

  /**
   * Closes the menu and clears any entity-specific command state.
   */
  public close(): void {
    if (!this.menuState) {
      return;
    }

    this.menuState = null;
    this.render();
  }

  /**
   * Renders either an empty layer or the active command list.
   */
  private render(): void {
    if (!this.menuState) {
      this.root.replaceChildren(this.createStyles());
      return;
    }

    this.root.replaceChildren(this.createStyles(), this.createMenu(this.menuState));
  }

  /**
   * Builds the accessible menu element with one button per command.
   */
  private createMenu(state: OpenMenuState): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.role = 'menu';
    menu.setAttribute('aria-label', 'Действия');
    menu.style.left = `${state.x}px`;
    menu.style.top = `${state.y}px`;

    state.commands.forEach((command, index) => {
      menu.append(this.createCommandButton(command, index, state.activeIndex));
    });

    return menu;
  }

  /**
   * Creates one command button and wires selection through a composed event.
   */
  private createCommandButton(command: ContextMenuCommand, index: number, activeIndex: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = index === activeIndex ? 'item is-active' : 'item';
    button.type = 'button';
    button.role = 'menuitem';
    button.disabled = command.disabled === true;
    button.tabIndex = index === activeIndex ? 0 : -1;
    button.textContent = command.label;
    button.addEventListener('mouseenter', () => {
      this.activateIndex(index);
    });
    button.addEventListener('click', () => {
      this.dispatchCommand(command);
    });

    return button;
  }

  /**
   * Moves visual focus to a command when pointer or keyboard navigation changes it.
   */
  private activateIndex(index: number): void {
    if (!this.menuState || this.menuState.commands[index]?.disabled) {
      return;
    }

    this.menuState = {
      ...this.menuState,
      activeIndex: index
    };
    this.render();
    this.focusActiveCommand();
  }

  /**
   * Sends the chosen command to the app shell and closes the floating layer.
   */
  private dispatchCommand(command: ContextMenuCommand): void {
    if (!this.menuState || command.disabled) {
      return;
    }

    const detail: AppMenuCommandDetail = {
      command,
      entity: this.menuState.entity
    };

    this.dispatchEvent(
      new CustomEvent<AppMenuCommandDetail>('app-menu-command', {
        bubbles: true,
        composed: true,
        detail
      })
    );
    this.close();
  }

  /**
   * Keeps the menu inside the viewport using a conservative fixed size estimate.
   */
  private calculateMenuPosition(clientX: number, clientY: number, commandCount: number): Pick<OpenMenuState, 'x' | 'y'> {
    const estimatedHeight = commandCount * MENU_ROW_HEIGHT_PX + MENU_VERTICAL_PADDING_PX;
    const maxX = Math.max(MENU_MARGIN_PX, window.innerWidth - MENU_WIDTH_PX - MENU_MARGIN_PX);
    const maxY = Math.max(MENU_MARGIN_PX, window.innerHeight - estimatedHeight - MENU_MARGIN_PX);

    return {
      x: clamp(clientX, MENU_MARGIN_PX, maxX),
      y: clamp(clientY, MENU_MARGIN_PX, maxY)
    };
  }

  /**
   * Focuses the active command after render so keyboard users stay inside the menu.
   */
  private focusActiveCommand(): void {
    if (!this.menuState || this.menuState.activeIndex < 0) {
      return;
    }

    const items = this.root.querySelectorAll<HTMLButtonElement>('.item');
    items[this.menuState.activeIndex]?.focus();
  }

  /**
   * Closes the menu when a pointer action starts outside the context layer.
   */
  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.menuState) {
      return;
    }

    if (event.composedPath().includes(this)) {
      return;
    }

    this.close();
  };

  /**
   * Handles Escape, arrow navigation, and command activation from the keyboard.
   */
  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!this.menuState) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveActiveIndex(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveActiveIndex(-1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      this.activateFirstCommand();
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      this.activateLastCommand();
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.dispatchActiveCommand();
    }
  };

  /**
   * Closes the menu when viewport geometry changes enough to make the position stale.
   */
  private readonly handleGlobalClose = (): void => {
    this.close();
  };

  /**
   * Moves active command focus while skipping disabled command rows.
   */
  private moveActiveIndex(direction: 1 | -1): void {
    if (!this.menuState) {
      return;
    }

    const nextIndex = findNextEnabledCommandIndex(this.menuState.commands, this.menuState.activeIndex, direction);
    if (nextIndex >= 0) {
      this.activateIndex(nextIndex);
    }
  }

  /**
   * Activates the first enabled command for Home key navigation.
   */
  private activateFirstCommand(): void {
    if (!this.menuState) {
      return;
    }

    this.activateIndex(findFirstEnabledCommandIndex(this.menuState.commands));
  }

  /**
   * Activates the last enabled command for End key navigation.
   */
  private activateLastCommand(): void {
    if (!this.menuState) {
      return;
    }

    this.activateIndex(findLastEnabledCommandIndex(this.menuState.commands));
  }

  /**
   * Dispatches the currently focused command for keyboard activation.
   */
  private dispatchActiveCommand(): void {
    if (!this.menuState || this.menuState.activeIndex < 0) {
      return;
    }

    const command = this.menuState.commands[this.menuState.activeIndex];
    if (command) {
      this.dispatchCommand(command);
    }
  }

  /**
   * Defines the floating menu visuals without owning any app-specific commands.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        position: fixed;
        inset: 0;
        z-index: 1000;
        pointer-events: none;
      }

      .menu {
        position: fixed;
        min-width: 180px;
        width: max-content;
        max-width: min(${MENU_WIDTH_PX}px, calc(100vw - 16px));
        display: grid;
        gap: 2px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 6px;
        background: var(--color-panel);
        box-shadow: var(--shadow-panel);
        pointer-events: auto;
      }

      .item {
        cursor: pointer;
        width: 100%;
        min-height: 34px;
        border: 0;
        border-radius: var(--radius-sm);
        padding: 0 10px;
        color: var(--color-text);
        background: transparent;
        text-align: left;
      }

      .item:hover,
      .item:focus-visible,
      .item.is-active {
        background: var(--color-accent-soft);
      }

      .item:disabled {
        cursor: default;
        color: var(--color-text-muted);
        opacity: 0.6;
      }

      ${BUTTON_INTERACTION_CSS}
    `;

    return style;
  }
}

/**
 * Finds the first command that can be activated by pointer or keyboard.
 */
function findFirstEnabledCommandIndex(commands: ContextMenuCommand[]): number {
  return commands.findIndex((command) => command.disabled !== true);
}

/**
 * Finds the last command that can be activated by pointer or keyboard.
 */
function findLastEnabledCommandIndex(commands: ContextMenuCommand[]): number {
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    if (commands[index]?.disabled !== true) {
      return index;
    }
  }

  return -1;
}

/**
 * Finds the next enabled command with wrap-around keyboard navigation.
 */
function findNextEnabledCommandIndex(commands: ContextMenuCommand[], currentIndex: number, direction: 1 | -1): number {
  if (commands.length === 0) {
    return -1;
  }

  const startIndex = currentIndex >= 0 ? currentIndex : 0;
  for (let offset = 1; offset <= commands.length; offset += 1) {
    const index = (startIndex + offset * direction + commands.length) % commands.length;
    if (commands[index]?.disabled !== true) {
      return index;
    }
  }

  return -1;
}

/**
 * Restricts a menu coordinate to the visible viewport range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

customElements.define('x-context-menu-root', XContextMenuRoot);
