import type { TaskQueue } from './api';

export const QUEUE_ROW_ESTIMATE = 32;

export function visibleQueueCount(count: number, expanded: boolean): number {
  return expanded || count <= 4 ? count : 3;
}

export {
  listInsertionIndex as queueInsertionIndex, listDropTarget as queueDropTarget,
  listPreviewStart as queuePreviewStart, listScrollStep as queueScrollStep,
  type ListRowBounds as QueueRowBounds,
} from './listDrag';

/** Every exit path releases the acquired queue lock once, after any committed reorder. */
export function queueDragTransaction(acquired: Promise<void>, release: () => Promise<void>) {
  let finished: Promise<void> | undefined;
  return (commit?: () => Promise<void>): Promise<void> => finished ??= (async () => {
    await acquired;
    try { await commit?.(); }
    finally { await release(); }
  })();
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
