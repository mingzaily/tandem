import type { Item } from './items';

/** User text, newest first. Streaming assistant output preserves the previous array identity. */
export function deriveInputHistory(items: Item[], previous: readonly string[] = []): readonly string[] {
  const entries = items.flatMap((item) => item.type === 'user' && item.text.trim() ? [item.text] : []).reverse();
  return entries.length === previous.length && entries.every((value, index) => value === previous[index]) ? previous : entries;
}

export type HistoryDirection = 'older' | 'newer';
export interface InputHistoryNavigation {
  entries: readonly string[];
  index: number;
  draft: string;
  value: string;
}

/** A browsing session holds its own order until it returns to the original draft. */
export function browseInputHistory(history: readonly string[], current: InputHistoryNavigation | null, value: string, direction: HistoryDirection): { value: string; navigation: InputHistoryNavigation | null } | null {
  let navigation = current;
  if (navigation && navigation.value !== value) return null;
  if (!navigation) {
    if (direction === 'newer' || value.trim() || !history.length) return null;
    navigation = { entries: [...history], index: -1, draft: value, value };
  }
  const index = direction === 'older' ? Math.min(navigation.index + 1, navigation.entries.length - 1) : navigation.index - 1;
  if (index === navigation.index) return null;
  if (index < 0) return { value: navigation.draft, navigation: null };
  const next = navigation.entries[index];
  return { value: next, navigation: { ...navigation, index, value: next } };
}

export function inputHistoryDirection(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): HistoryDirection | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  return event.key === 'ArrowUp' ? 'older' : event.key === 'ArrowDown' ? 'newer' : null;
}
