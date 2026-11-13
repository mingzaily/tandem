import type { Item } from './items';

interface ScrollViewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Growing content keeps follow intent; movement away from the tail releases it. */
export function followTailAfterScroll(following: boolean, previousTop: number, viewport: ScrollViewport): boolean {
  if (viewport.scrollHeight <= viewport.clientHeight) return true;
  const delta = viewport.scrollTop - previousTop;
  const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48;
  if (following) return !(delta < -1 && !nearBottom);
  return delta > 1 && nearBottom;
}

/** Native handoff can replace live IDs; transferred messages keep their unread identity. */
export function countAddedMessages(previous: Item[], next: Item[]): number {
  const visible = (item: Item) => item.type === 'assistant' || item.type === 'user' || item.type === 'error';
  const oldIds = new Set(previous.map((item) => item.id));
  const nextIds = new Set(next.map((item) => item.id));
  const transferred = new Map<string, number>();
  const key = (item: Item) => item.type + ':' + ('text' in item ? item.text : '');
  for (const item of previous) if (visible(item) && !nextIds.has(item.id)) transferred.set(key(item), (transferred.get(key(item)) ?? 0) + 1);
  let count = 0;
  for (const item of next) {
    if (!visible(item) || oldIds.has(item.id)) continue;
    const copies = transferred.get(key(item)) ?? 0;
    if (copies > 0) transferred.set(key(item), copies - 1);
    else count++;
  }
  return count;
}
