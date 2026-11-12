import { applyTurnEvent, buildItems, splitAttachedFiles, type Item, type UserItem } from './items';
import type { Message, Run } from './types';

/** Native history and a live snapshot can contain the same turn. Keep one input and one progress stream. */
export function conversationItems(messages: Message[], runs: Run[]): Item[] {
  let history = buildItems(messages);
  const toolIds = new Map(
    messages.filter((message) => message.toolUseId).map((message) => [message.id, message.toolUseId]),
  );
  for (const run of [...runs].sort((a, b) => a.startedAtMs - b.startedAtMs)) {
    const live = run.events.reduce<Item[]>(applyTurnEvent, []);
    const prompt = splitAttachedFiles(run.prompt ?? '').text;
    const lastUser = history.findLastIndex((item) => item.type === 'user');
    const user = history[lastUser];
    const optimistic = user?.id === `prompt-${run.runId}`;
    const nativeToolIds = new Set(live.filter((item) => item.type === 'tool').map((item) => item.id));
    const tail = history.slice(lastUser + 1);
    const firstText = tail.find(
      (item) => (item.type === 'assistant' || item.type === 'thinking') && item.text.trim(),
    );
    const liveText =
      firstText && live.find((item) => item.type === firstText.type && 'text' in item && item.text.trim());
    const textOverlaps =
      firstText &&
      'text' in firstText &&
      liveText &&
      'text' in liveText &&
      (firstText.text.startsWith(liveText.text) || liveText.text.startsWith(firstText.text));
    const overlaps =
      tail.some((item) => item.type === 'error' && live.some((other) => other.type === 'error' && other.text === item.text)) ||
      tail.some((item) => item.type === 'tool' && nativeToolIds.has(toolIds.get(item.id) ?? '')) ||
      textOverlaps;
    const matching =
      user?.type === 'user' &&
      user.text.trimEnd() === prompt.trimEnd() &&
      (optimistic || (user.at !== undefined ? user.at >= run.startedAtMs : tail.length === 0 || overlaps));
    const pageWithinRun =
      lastUser < 0 &&
      history.length > 0 &&
      (history.some((item) => item.type === 'tool' && nativeToolIds.has(toolIds.get(item.id) ?? '')) ||
        history.every((item) => item.at !== undefined && item.at >= run.startedAtMs));
    const boundary = matching ? lastUser : pageWithinRun ? 0 : history.length;
    const input: UserItem = matching
      ? (user as UserItem)
      : {
          type: 'user',
          id: `${run.runId}:user`,
          text: prompt,
          at: run.startedAtMs,
        };
    const native = history.slice(boundary + (matching ? 1 : 0));
    const progress = mergeProgress(native, live, toolIds);
    history = [
      ...history.slice(0, boundary),
      input,
      ...progress.map((item) => ({ ...item, id: `${run.runId}:${item.id}` })),
    ];
  }
  return history;
}

/** A disk read can be ahead of its snapshot. Retain the longer prefix and completed tool results. */
function mergeProgress(native: Item[], live: Item[], toolIds: Map<string, string | undefined>): Item[] {
  let samePrefix = true;
  const merged = live.map((item, index) => {
    const saved = native[index];
    if (!samePrefix || !saved || saved.type !== item.type) {
      samePrefix = false;
      return item;
    }
    if ((item.type === 'assistant' || item.type === 'thinking') && saved.type === item.type) {
      samePrefix = saved.text.startsWith(item.text) || item.text.startsWith(saved.text);
      return samePrefix && saved.text.length > item.text.length ? { ...item, text: saved.text } : item;
    }
    if (item.type === 'tool' && saved.type === 'tool' && toolIds.get(saved.id) === item.id) {
      return item.result === null && saved.result !== null
        ? { ...item, result: saved.result, isError: saved.isError, truncated: saved.truncated }
        : item;
    }
    samePrefix = false;
    return item;
  });
  return samePrefix ? [...merged, ...native.slice(live.length)] : merged;
}
