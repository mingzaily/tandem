import { describe, expect, it } from 'vitest';
import { completedReplyIds, type Item } from './items';

const user = (id: string, steered = false): Item => ({ type: 'user', id, text: id, steered });
const reply = (id: string, text = id): Item => ({ type: 'assistant', id, text });
const tool = (id: string): Item => ({ type: 'tool', id, name: 'Read', input: '{}', result: 'done', isError: false, truncated: false });
const ids = (items: Item[], running = false) => [...completedReplyIds(items, running)];

describe('completed reply actions', () => {
  it('offers one copy action at each completed final reply and excludes intermediate progress', () => {
    expect(ids([user('u1'), reply('progress'), tool('read'), reply('final1'), user('u2'), reply('final2')]))
      .toEqual(['final1', 'final2']);
  });

  it('keeps old completed replies copyable while the new turn is streaming', () => {
    const items = [user('u1'), reply('final1'), user('u2'), reply('streaming')];
    expect(ids(items, true)).toEqual(['final1']);
    expect(ids(items, false)).toEqual(['final1', 'streaming']);
  });

  it('does not turn tool-ending progress or blank text into a finished reply', () => {
    expect(ids([user('u'), reply('progress'), tool('read')])).toEqual([]);
    expect(ids([user('u'), reply('blank', '  ')])).toEqual([]);
    expect(ids([])).toEqual([]);
  });

  it('retains an ended reply across interruption and compaction boundaries', () => {
    expect(ids([user('u'), reply('before-stop'), { type: 'notice', id: 'stop', text: 'stopped' },
      { type: 'compaction', id: 'compact' }, user('next'), reply('running')], true)).toEqual(['before-stop']);
  });

  it('keeps steering within the running turn and ignores empty thinking signatures', () => {
    const items: Item[] = [user('u'), reply('progress'), user('steer', true), reply('final'), { type: 'thinking', id: 'signature', text: '' }];
    expect(ids(items, true)).toEqual([]);
    expect(ids(items)).toEqual(['final']);
  });
});
