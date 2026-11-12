import type { Agent, PendingRequest, Run, TurnEvent } from './types';
import { appendTurnEvent } from './events';

export interface RunEvent {
  runId: string;
  taskId: string | null;
  agent: Agent;
  prompt?: string;
  startedAtMs: number;
  elapsedMs: number;
  seq: number;
  event: TurnEvent;
}

export interface LiveSnapshot {
  seq: number;
  runs: Run[];
}

/** One connection's snapshot boundary. A new handshake starts a new sequence space. */
export class LiveSync {
  private epoch = 0;
  private sequence = 0;
  private waiting = true;
  private held: RunEvent[] = [];

  reset(): number {
    this.epoch++;
    this.sequence = 0;
    this.waiting = true;
    this.held = [];
    return this.epoch;
  }

  current(epoch: number): boolean {
    return epoch === this.epoch;
  }

  begin(): number {
    this.epoch++;
    this.waiting = true;
    return this.epoch;
  }

  receive(event: RunEvent): RunEvent[] {
    if (this.waiting) {
      this.held.push(event);
      return [];
    }
    if (event.seq <= this.sequence) return [];
    this.sequence = event.seq;
    return [event];
  }

  restore(epoch: number, snapshot: LiveSnapshot): RunEvent[] | null {
    if (!this.current(epoch)) return null;
    this.sequence = snapshot.seq;
    this.waiting = false;
    const held = this.held;
    this.held = [];
    const active = new Set(snapshot.runs.map((run) => run.runId));
    const completed = new Set(
      held
        .filter((update) => update.event.type === 'finished' && !active.has(update.runId))
        .map((update) => update.runId),
    );
    return held.flatMap((event) =>
      event.seq <= snapshot.seq && completed.has(event.runId) ? [event] : this.receive(event),
    );
  }
}

export function appendRunEvent(runs: Run[], update: RunEvent): Run[] {
  const found = runs.find((run) => run.runId === update.runId);
  const next: Run = {
    runId: update.runId,
    taskId: update.taskId,
    agent: update.agent,
    prompt: update.prompt ?? found?.prompt ?? '',
    startedAtMs: update.startedAtMs,
    elapsedMs: update.elapsedMs,
    events: appendTurnEvent(found?.events ?? [], update.event),
  };
  return found ? runs.map((run) => (run.runId === update.runId ? next : run)) : [...runs, next];
}

export function pendingRequests(runs: Run[]) {
  return runs.flatMap((run) => {
    if (run.events.some((event) => event.type === 'finished')) return [];
    const settled = new Set(
      run.events.filter((event) => event.type === 'requestSettled').map((event) => event.requestId),
    );
    return run.events.filter(
      (event): event is PendingRequest =>
        (event.type === 'permissionRequest' || event.type === 'question') && !settled.has(event.requestId),
    );
  });
}
