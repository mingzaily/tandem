/** Back and forward between pages, the way a browser does it. */
export interface NavHistory<T> {
  entries: T[];
  index: number;
}

const MAX_ENTRIES = 100;

export const startHistory = <T,>(entry: T): NavHistory<T> => ({ entries: [entry], index: 0 });
export const currentEntry = <T,>(history: NavHistory<T>): T => history.entries[history.index];
export const canGoBack = <T,>(history: NavHistory<T>) => history.index > 0;
export const canGoForward = <T,>(history: NavHistory<T>) => history.index < history.entries.length - 1;

export function pushEntry<T>(history: NavHistory<T>, entry: T): NavHistory<T> {
  if (JSON.stringify(currentEntry(history)) === JSON.stringify(entry)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), entry].slice(-MAX_ENTRIES);
  return { entries, index: entries.length - 1 };
}

export function replaceEntry<T>(history: NavHistory<T>, entry: T): NavHistory<T> {
  const entries = [...history.entries];
  entries[history.index] = entry;
  return { entries, index: history.index };
}

export const goBack = <T,>(history: NavHistory<T>): NavHistory<T> =>
  canGoBack(history) ? { ...history, index: history.index - 1 } : history;
export const goForward = <T,>(history: NavHistory<T>): NavHistory<T> =>
  canGoForward(history) ? { ...history, index: history.index + 1 } : history;
