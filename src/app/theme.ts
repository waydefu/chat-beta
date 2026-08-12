// Theme resolution lives outside the chat controller because the controller is
// imported lazily after sign-in, and the auth screen needs the theme before that.

const THEME_KEY = 'chat-lite:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export type Theme = 'light' | 'dark';

export function storedTheme(): Theme | null {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' || stored === 'light' ? stored : null;
}

export function preferredTheme(): Theme {
  return storedTheme() ?? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light');
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function storeTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
}

// Follows the OS only while no explicit choice is stored, so a deliberate
// toggle is never overwritten.
export function watchSystemTheme(next: (theme: Theme) => void): void {
  window.matchMedia(DARK_QUERY).addEventListener('change', (event) => {
    if (storedTheme()) return;
    next(event.matches ? 'dark' : 'light');
  });
}
