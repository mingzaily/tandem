import { Client } from './client';
import type {
  Agent,
  Decision,
  Message,
  ModelOption,
  Run,
  TaskContext,
  TaskSummary,
  UsageWindows,
} from './types';
export const client = new Client();
export const api = {
  host: () =>
    client.request<{
      name: string;
      version: string;
      agents: Agent[];
      projects: { cwd: string; name: string }[];
      conversationRoots: string[];
    }>('host.info'),
  tasks: () =>
    client.request<{ tasks: TaskSummary[]; external: { taskId: string; isBusy: boolean }[] }>('tasks.list'),
  read: (agent: Agent, id: string, before?: number) =>
    client.request<{ messages: Message[]; context: TaskContext; total: number }>('task.read', {
      agent,
      id,
      before,
      limit: 200,
    }),
  info: (agent: Agent) =>
    client.request<{ models: ModelOption[]; usage: UsageWindows | null }>('agent.info', { agent }),
  snapshot: (onResult?: (value: { seq: number; runs: Run[] }) => void) =>
    client.request<{ seq: number; runs: Run[] }>('live.snapshot', {}, onResult),
  send: (p: {
    agent: Agent;
    taskId: string | null;
    cwd: string | null;
    prompt: string;
    model: string | null;
    effort: string | null;
    permissionMode: string | null;
  }) => client.request<{ runId: string }>('turn.send', p),
  stop: (taskId: string) => client.request('turn.cancel', { taskId }),
  answer: (taskId: string, requestId: string, decision: Decision) =>
    client.request('request.answer', { taskId, requestId, decision }),
};
