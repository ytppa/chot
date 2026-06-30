/**
 * Provides consistent hover and keyboard focus behavior for the remaining Shadow DOM buttons.
 */
export const BUTTON_INTERACTION_CSS = `
  button {
    transition:
      filter 120ms ease,
      border-color 120ms ease,
      box-shadow 120ms ease,
      background-color 120ms ease;
  }

  button:not(:disabled):hover {
    filter: brightness(0.96);
  }

  button:focus {
    outline: none;
  }

  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  button:disabled {
    filter: none;
  }
`;
