import type { Item } from './items';

export interface TaskHistory {
  taskId: string;
  items: Item[];
  ready: boolean;
  visit: object;
}

const EMPTY_HISTORY: Item[] = [];
/** The render that selects B can only consume B's history, before any effects run. */
export const historyForTask = (history: TaskHistory | null, taskId: string | null): Item[] =>
  history?.taskId === taskId ? history.items : EMPTY_HISTORY;

export const historyReadyForTask = (history: TaskHistory | null, taskId: string | null, visit: object): boolean =>
  history?.taskId === taskId && history?.ready === true && history.visit === visit;

/** Native reads can overlap on selection, turn completion and external-file follow. */
export class HistoryReads {
  private pending = new Map<string, symbol>();
  begin(taskId: string) {
    const token = Symbol(taskId);
    this.pending.set(taskId, token);
    const isCurrent = () => this.pending.get(taskId) === token;
    return {
      isCurrent,
      release: () => { if (isCurrent()) this.pending.delete(taskId); },
    };
  }
}
