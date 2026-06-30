export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'nothing-chat.theme-preference';

const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/**
 * Checks user-controlled theme text before applying it to document state.
 */
export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Restores the local theme preference and falls back to system colors.
 */
export function readThemePreference(storage?: Storage): ThemePreference {
  try {
    const targetStorage = storage ?? window.localStorage;
    const storedPreference = targetStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedPreference) ? storedPreference : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/**
 * Applies manual theme overrides and clears them for system color mode.
 */
export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement
): void {
  if (preference === 'system') {
    root.removeAttribute('data-theme');
    return;
  }

  root.dataset.theme = preference;
}

/**
 * Persists the user preference locally without involving backend state.
 */
export function setThemePreference(
  preference: ThemePreference,
  storage?: Storage,
  root: HTMLElement = document.documentElement
): void {
  applyThemePreference(preference, root);

  try {
    const targetStorage = storage ?? window.localStorage;
    if (preference === 'system') {
      targetStorage.removeItem(THEME_STORAGE_KEY);
      return;
    }

    targetStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Keep the in-memory visual state even when storage is unavailable.
  }
}

/**
 * Restores and applies the saved preference during app startup.
 */
export function initializeThemePreference(): ThemePreference {
  const preference = readThemePreference();
  applyThemePreference(preference);

  return preference;
}
