import type { TaskQueue } from './api';

export const QUEUE_ROW_ESTIMATE = 32;

export function visibleQueueCount(count: number, expanded: boolean): number {
  return expanded || count <= 4 ? count : 3;
}

/** Measured centers keep pointer sorting aligned with the displayed font size. */
export function queueInsertionIndex(rows: readonly { start: number; end: number }[], offset: number): number {
  const index = rows.findIndex(({ start, end }) => offset < (start + end) / 2);
  return index < 0 ? rows.length : index;
}

/** Pointer insertion slots become final indices after the dragged row is removed. */
export function queueDropTarget(count: number, from: number, insertion: number): number {
  const target = insertion > from ? insertion - 1 : insertion;
  return Math.max(0, Math.min(count - 1, target));
}

export function queueKeyboardTarget(count: number, from: number, key: string): number | null {
  switch (key) {
    case 'ArrowUp': return Math.max(0, from - 1);
    case 'ArrowDown': return Math.min(count - 1, from + 1);
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

/** IPC responses can arrive after a newer queue event. */
export function mergeQueue(current: Record<string, TaskQueue>, queue: TaskQueue): Record<string, TaskQueue> {
  return (current[queue.taskId]?.revision ?? -1) >= queue.revision
    ? current
    : { ...current, [queue.taskId]: queue };
}
