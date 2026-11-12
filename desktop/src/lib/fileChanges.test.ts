import { describe, expect, it } from 'vitest';
import type { Item, ToolItem } from './items';
import { buildMessageRows, fileChangeLabel, summarizeFileChanges } from './fileChanges';

const tool = (path: string, input: object = {}, overrides: Partial<ToolItem> = {}): ToolItem => ({
  type: 'tool', id: path, name: 'Edit', input: JSON.stringify({ file_path: path, ...input }), result: 'ok', isError: false, truncated: false, ...overrides,
});
const prompt: Item = { type: 'user', id: 'user', text: '修改文件' };

describe('latest turn file changes', () => {
  it('counts completed successful file tools and excludes reads, commands, failures and pending tools', () => {
    const result = summarizeFileChanges([
      prompt, tool('a', {}, { name: 'Read' }), tool('b', {}, { name: 'Bash' }),
      tool('c', {}, { isError: true }), tool('d', {}, { result: null }), tool('e'),
    ], '/project');
    expect(result).toEqual({ files: [{ path: '/project/e', stats: null }], stats: null });
  });

  it('resets at the latest user message while retaining changes across an interruption notice', () => {
    const items: Item[] = [prompt, tool('/old'), { ...prompt, id: 'next' }, tool('/new'), { type: 'notice', id: 'stop', text: '已中断' }];
    expect(summarizeFileChanges(items, null).files.map((file) => file.path)).toEqual(['/new']);
    expect(summarizeFileChanges([...items, { ...prompt, id: 'empty' }], null).files).toEqual([]);
  });

  it('deduplicates paths and accumulates the native patch counts of repeated edits', () => {
    const result = summarizeFileChanges([
      prompt, tool('src/a.ts', { added: 3, removed: 1 }),
      tool('/project/src/./a.ts', { added: 2, removed: 4 }), tool('src/../b.ts', { added: 1, removed: 0 }),
    ], '/project');
    expect(result).toEqual({ files: [{ path: '/project/src/a.ts', stats: { added: 5, removed: 5 } }, { path: '/project/b.ts', stats: { added: 1, removed: 0 } }], stats: { added: 6, removed: 5 } });
  });

  it('shows file counts without inventing line totals from replacement snippets or Write content', () => {
    const result = summarizeFileChanges([
      tool('/a', { old_string: 'a\nb', new_string: 'a\nc' }), tool('/b', { content: 'new contents' }, { name: 'Write' }),
    ], null);
    expect(result.files).toHaveLength(2);
    expect(result.stats).toBeNull();
    expect(result.files.every((file) => file.stats === null)).toBe(true);
  });

  it('keeps partial native line counts out of both the file total and aggregate total', () => {
    const result = summarizeFileChanges([tool('/a', { added: 3, removed: 1 }), tool('/a'), tool('/b', { added: 1, removed: 0 })], null);
    expect(result.files[0].stats).toBeNull();
    expect(result.files[1].stats).toEqual({ added: 1, removed: 0 });
    expect(result.stats).toBeNull();
  });

  it('keeps clipped or malformed native inputs out of line totals', () => {
    const result = summarizeFileChanges([
      tool('/a', {}, { input: '{broken' }), tool('/b', { added: 3, removed: 1 }, { truncated: true }), tool('/c', { added: -1, removed: 0 }),
    ], null);
    expect(result.files.map((file) => file.path)).toEqual(['/b', '/c']);
    expect(result.stats).toBeNull();
  });
});

describe('file changes in the message stream', () => {
  it('keeps each turn summary beside its result after another user message arrives', () => {
    const rows = buildMessageRows([
      prompt, tool('src/a.ts', { added: 3, removed: 1 }), { type: 'assistant', id: 'answer-1', text: '完成第一轮' },
      { ...prompt, id: 'user-2' }, tool('src/a.ts', { added: 2, removed: 0 }), { type: 'assistant', id: 'answer-2', text: '完成第二轮' },
      { ...prompt, id: 'user-3' },
    ], false, '/project');
    expect(rows.map(({ type }) => type)).toEqual(['user', 'group', 'assistant', 'changes', 'user', 'group', 'assistant', 'changes', 'user']);
    const summaries = rows.filter((row) => row.type === 'changes');
    expect(summaries.map(({ id, stats }) => ({ id, stats }))).toEqual([
      { id: 'changes-user', stats: { added: 3, removed: 1 } },
      { id: 'changes-user-2', stats: { added: 2, removed: 0 } },
    ]);
  });

  it('retains earlier cards while the latest turn is still running', () => {
    const items: Item[] = [prompt, tool('/a'), { ...prompt, id: 'user-2' }, tool('/b')];
    expect(buildMessageRows(items, true, null).filter(({ type }) => type === 'changes').map(({ id }) => id)).toEqual(['changes-user']);
    expect(buildMessageRows(items, false, null).filter(({ type }) => type === 'changes').map(({ id }) => id)).toEqual(['changes-user', 'changes-user-2']);
  });

  it('keeps edits before and after a steer in the same active turn without a premature change card', () => {
    const items: Item[] = [prompt, tool('/a'), { type: 'user', id: 'steer', text: 'also b', steered: true }, tool('/b'), { type: 'assistant', id: 'answer', text: 'done' }];
    expect(buildMessageRows(items, true, null).filter((row) => row.type === 'changes')).toEqual([]);
    const completed = buildMessageRows(items, false, null).filter((row) => row.type === 'changes');
    expect(completed).toHaveLength(1);
    expect(completed[0].files.map(({ path }) => path)).toEqual(['/a', '/b']);
    expect(summarizeFileChanges(items, null).files.map(({ path }) => path)).toEqual(['/a', '/b']);
  });

  it('keeps interruptions and compaction inside the same file-change turn', () => {
    const rows = buildMessageRows([
      prompt, tool('/a'), { type: 'notice', id: 'stop', text: '已中断' }, { type: 'compaction', id: 'compact' }, tool('/b'),
    ], false, null);
    const summary = rows.at(-1);
    expect(summary?.type === 'changes' && summary.files.map(({ path }) => path)).toEqual(['/a', '/b']);
    expect(rows.filter(({ type }) => type === 'changes')).toHaveLength(1);
  });

  it('leaves turns without successful file edits free of summary cards', () => {
    expect(buildMessageRows([prompt, tool('/a', {}, { isError: true }), { ...prompt, id: 'next' }], false, null).some(({ type }) => type === 'changes')).toBe(false);
    expect(buildMessageRows([], false, null)).toEqual([]);
  });
});

describe('readable file labels', () => {
  it('leads with the filename and uses a project-relative parent directory', () => {
    expect(fileChangeLabel('/project/src/settings/form.tsx', '/project')).toEqual({ name: 'form.tsx', directory: 'src/settings' });
    expect(fileChangeLabel('/project/README.md', '/project')).toEqual({ name: 'README.md', directory: '' });
  });

  it('keeps the outside directory distinguishable and handles root projects', () => {
    expect(fileChangeLabel('/project-other/src/a.ts', '/project')).toEqual({ name: 'a.ts', directory: '/project-other/src' });
    expect(fileChangeLabel('/tmp/a.ts', '/')).toEqual({ name: 'a.ts', directory: 'tmp' });
    expect(fileChangeLabel('README.md', null)).toEqual({ name: 'README.md', directory: '' });
  });
});
