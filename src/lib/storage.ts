/**
 * Minimal localStorage helpers.
 *
 * try/catch guards private-browsing quota errors; all values are JSON-encoded.
 */
export function readStoredString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — non-fatal */
  }
}
