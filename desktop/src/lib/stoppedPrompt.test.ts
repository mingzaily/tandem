import { describe, expect, it } from 'vitest';
import type { Message } from './api';
import { promptRecorded } from './stoppedPrompt';

const user = (text: string, timestamp?: string): Message => ({ id: text, kind: 'user', text, isError: false, truncated: false, timestamp });
const started = Date.parse('2026-11-12T13:00:00Z');

describe('a stopped prompt', () => {
  it('counts as recorded when the CLI wrote it during this turn', () => {
    expect(promptRecorded([user('删掉旧的构建', '2026-11-12T13:00:02Z')], '删掉旧的构建', started)).toBe(true);
  });

  it('is lost when only an earlier message has the same words', () => {
    expect(promptRecorded([user('继续', '2026-11-12T12:30:00Z')], '继续', started)).toBe(false);
    expect(promptRecorded([], '继续', started)).toBe(false);
  });

  it('tolerates a CLI clock a little behind and attachments-only prompts', () => {
    expect(promptRecorded([user('hi', '2026-11-12T12:59:58Z')], 'hi', started)).toBe(true);
    expect(promptRecorded([], '   ', started)).toBe(true);
  });
});
