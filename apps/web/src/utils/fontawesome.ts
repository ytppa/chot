export type FontAwesomeIconName = 'chevron-down' | 'chevron-left' | 'paper-plane';

/**
 * Creates one decorative Font Awesome icon node while shared SCSS owns the mask path.
 */
export function createFontAwesomeIcon(name: FontAwesomeIconName): HTMLElement {
  const icon = document.createElement('span');
  icon.className = `fa-icon fa-icon-${name}`;
  icon.setAttribute('aria-hidden', 'true');

  return icon;
}
