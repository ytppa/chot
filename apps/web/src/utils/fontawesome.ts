export type FontAwesomeIconName = 'chevron-down' | 'chevron-left' | 'paper-plane';

const FONT_AWESOME_ICON_PATHS: Record<FontAwesomeIconName, string> = {
  'chevron-down': '/vendor/fontawesome/svgs/solid/chevron-down.svg',
  'chevron-left': '/vendor/fontawesome/svgs/solid/chevron-left.svg',
  'paper-plane': '/vendor/fontawesome/svgs/solid/paper-plane.svg'
};

/**
 * Provides shared Shadow DOM CSS for locally served Font Awesome mask icons.
 */
export const FONT_AWESOME_ICON_CSS = `
  .fa-icon {
    display: inline-block;
    flex: 0 0 auto;
    width: 1em;
    height: 1em;
    background: currentColor;
    -webkit-mask: var(--fa-icon-url) center / contain no-repeat;
    mask: var(--fa-icon-url) center / contain no-repeat;
  }

  .fa-icon-chevron-down {
    --fa-icon-url: url("${FONT_AWESOME_ICON_PATHS['chevron-down']}");
  }

  .fa-icon-chevron-left {
    --fa-icon-url: url("${FONT_AWESOME_ICON_PATHS['chevron-left']}");
  }

  .fa-icon-paper-plane {
    --fa-icon-url: url("${FONT_AWESOME_ICON_PATHS['paper-plane']}");
  }
`;

/**
 * Creates one decorative Font Awesome icon node while keeping button labels accessible.
 */
export function createFontAwesomeIcon(name: FontAwesomeIconName): HTMLElement {
  const icon = document.createElement('span');
  icon.className = `fa-icon fa-icon-${name}`;
  icon.setAttribute('aria-hidden', 'true');

  return icon;
}
