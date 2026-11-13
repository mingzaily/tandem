import { useRef, useState } from 'react';
import { setTaskArchived, type TaskArchiveResult, type TaskSummary } from './api';
import { t } from './i18n';
import { preferencesMemory } from './storage';

interface Options {
  onChanged: (result: TaskArchiveResult) => void;
  onSettled: (task: TaskSummary) => void;
}

/** Archive actions share one request per task and publish only confirmed backend state. */
export function useTaskArchive(options: Options) {
  const jobs = useRef(new Set<string>());
  const latest = useRef(options);
  latest.current = options;
  const [archiving, setArchiving] = useState<ReadonlySet<string>>(new Set());
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const change = async (task: TaskSummary, archived: boolean) => {
    if (jobs.current.has(task.id)) return;
    jobs.current.add(task.id);
    setArchiving(new Set(jobs.current));
    setArchiveError(null);
    try {
      await preferencesMemory.operation(async () => {
        const result = await setTaskArchived(task.agent, task.id, archived);
        latest.current.onChanged(result);
        return result.preferences;
      });
    } catch (error) {
      setArchiveError(t('taskArchiveFailed', { title: task.title || t('untitled'), error: String(error) }));
    } finally {
      jobs.current.delete(task.id);
      setArchiving(new Set(jobs.current));
      // A transport or local-settings failure can follow a successful native operation.
      latest.current.onSettled(task);
    }
  };
  return { archiving, archiveError, change };
}
