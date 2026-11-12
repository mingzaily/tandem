import type { Message } from './api';

/** Native timestamps come from the CLI's clock, so a little slack keeps an on-time record. */
const CLOCK_SLACK_MS = 5_000;

/**
 * Whether the CLI wrote a stopped turn's prompt to its native history. Only user messages from
 * this turn count, so an earlier message with the same words does not hide a lost one.
 */
export function promptRecorded(messages: Message[], prompt: string, startedAtMs: number): boolean {
  const wanted = prompt.trim();
  if (!wanted) return true;
  return messages.some((message) => {
    if (message.kind !== 'user' || !message.text.includes(wanted)) return false;
    const at = message.timestamp ? Date.parse(message.timestamp) : NaN;
    return Number.isNaN(at) || at >= startedAtMs - CLOCK_SLACK_MS;
  });
}
