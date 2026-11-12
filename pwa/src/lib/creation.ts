import type { Agent, Run, TaskSummary } from './types';
import type { RunEvent } from './live';

type Outcome = { taskId: string | null; startedAtMs: number; finished: boolean; error: string | null };
type Input = { agent: Agent; cwd: string; prompt: string };

/** Started identifies a new task before its native file or tasks.list entry exists. */
export class TaskCreation {
  private input: Input | null = null;
  private runId: string | null = null;
  private observed = new Map<string, Outcome>();

  begin(input: Input) {
    this.clear();
    this.input = input;
  }

  accept(runId: string) {
    this.runId = runId;
    for (const id of this.observed.keys()) if (id !== runId) this.observed.delete(id);
  }

  receive(update: RunEvent) {
    if (!this.input || (this.runId && update.runId !== this.runId)) return;
    if (update.event.type !== 'started' && update.event.type !== 'finished') return;
    this.observed.set(update.runId, {
      taskId: update.taskId,
      startedAtMs: update.startedAtMs,
      finished: update.event.type === 'finished',
      error: update.event.type === 'finished' && update.event.isError ? (update.event.message ?? '') : null,
    });
  }

  restore(runs: Run[]) {
    if (!this.input) return;
    for (const run of runs) {
      if (this.runId && run.runId !== this.runId) continue;
      this.observed.set(run.runId, {
        taskId: run.taskId,
        startedAtMs: run.startedAtMs,
        finished: false,
        error: null,
      });
    }
  }

  resolve(tasks: TaskSummary[]): { task?: TaskSummary; readHistory?: boolean; error?: string } {
    const outcome = this.runId ? this.observed.get(this.runId) : undefined;
    if (!outcome || !this.input) return {};
    const saved = tasks.find((task) => task.id === outcome.taskId);
    if (outcome.error !== null && !saved) return { error: outcome.error };
    if (!outcome.taskId) return {};
    const task = saved ?? {
      id: outcome.taskId,
      agent: this.input.agent,
      cwd: this.input.cwd,
      title: this.input.prompt.trim().split('\n')[0].slice(0, 80),
      updatedAtMs: outcome.startedAtMs,
    };
    return { task, readHistory: Boolean(saved) || outcome.finished };
  }

  clear() {
    this.input = null;
    this.runId = null;
    this.observed.clear();
  }
}
