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

// One DOM listener for the page, however many callers want the value. Both the
// auth screen and the chat controller need to hear about an OS change, and they
// come and go at different times; registering a media-query listener per caller
// gave the same state two owners and no way to release either.
const subscribers = new Set<(theme: Theme) => void>();
let query: MediaQueryList | null = null;

function onSystemChange(event: MediaQueryListEvent): void {
  // A deliberate toggle is never overwritten by the OS.
  if (storedTheme()) return;
  const theme: Theme = event.matches ? 'dark' : 'light';
  for (const subscriber of [...subscribers]) subscriber(theme);
}

/**
 * Follows the OS only while no explicit choice is stored. The returned cleanup
 * releases just this subscriber; the shared listener is removed once the last
 * one has gone.
 */
export function watchSystemTheme(next: (theme: Theme) => void): () => void {
  subscribers.add(next);
  if (!query) {
    query = window.matchMedia(DARK_QUERY);
    query.addEventListener('change', onSystemChange);
  }
  return () => {
    if (!subscribers.delete(next) || subscribers.size || !query) return;
    query.removeEventListener('change', onSystemChange);
    query = null;
  };
}
