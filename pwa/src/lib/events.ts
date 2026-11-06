import type { TurnEvent } from './types';

/** Keep streamed text compact without mutating a previous React state or snapshot. */
export function appendTurnEvent(events: TurnEvent[], event: TurnEvent): TurnEvent[] {
  const last = events.at(-1);
  if (
    (last?.type === 'textDelta' && event.type === 'textDelta') ||
    (last?.type === 'thinkingDelta' && event.type === 'thinkingDelta')
  ) {
    return [...events.slice(0, -1), { ...last, text: last.text + event.text }];
  }
  return [...events, event];
}
