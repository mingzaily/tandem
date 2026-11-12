/** A result and a confirmation in the same task share one Dock badge item. */
export function attentionTaskCount(unread: readonly string[], waiting: Iterable<string>, available: Iterable<string>, archived: readonly string[]): number {
  const visible = new Set(available);
  const excluded = new Set(archived);
  return [...new Set([...unread, ...waiting])].filter((id) => visible.has(id) && !excluded.has(id)).length;
}

export const shouldMarkUnread = (cancelled: boolean, taskId: string, selectedId: string | null, focused: boolean) =>
  !cancelled && (taskId !== selectedId || !focused);
