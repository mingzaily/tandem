import { describe, expect, it } from 'vitest';
import type { ToolItem } from './items';
import { describePermission, describeTool, explorationSummary, formatAge, formatDuration } from './tools';

const tool = (name: string, input: unknown, overrides: Partial<ToolItem> = {}): ToolItem => ({
  type: 'tool',
  id: name,
  name,
  input: JSON.stringify(input),
  result: 'x',
  isError: false,
  truncated: false,
  ...overrides,
});

describe('describeTool', () => {
  it('shows file tools as a file name with line stats', () => {
    const display = describeTool(tool('Edit', { file_path: '/a/b.ts', old_string: 'x', new_string: 'y\nz' }));
    expect(display.fileName).toBe('b.ts');
    expect(display.stats).toEqual({ added: 2, removed: 1 });
  });

  it('leaves out stats when the input was clipped', () => {
    const display = describeTool(tool('Edit', { file_path: '/a', old_string: 'x', new_string: 'y' }, { truncated: true }));
    expect(display.stats).toBeNull();
  });

  it('lets a command description replace the verb and keeps the command below', () => {
    const display = describeTool(tool('Bash', { command: 'ls -la', description: 'List files' }));
    expect(display).toMatchObject({ verb: '', text: 'List files', command: 'ls -la' });
    expect(describeTool(tool('Bash', { command: 'ls' }))).toMatchObject({ text: 'ls', command: null });
  });

  it('names unknown tools', () => {
    expect(describeTool(tool('Skill', {})).text).toBe('Skill');
    expect(describeTool(tool('Grep', { pattern: 'foo' })).text).toBe('foo');
  });

  it('survives input that is not JSON', () => {
    expect(describeTool({ ...tool('Bash', {}), input: '{broken' }).text).toBe('');
  });
});

describe('explorationSummary', () => {
  it('counts reads, searches and listings', () => {
    const items = [tool('Read', {}), tool('Read', {}), tool('Grep', {}), tool('Bash', {})];
    expect(explorationSummary(items)).toMatch(/2.*·.*(1|once)/);
    expect(explorationSummary([tool('Bash', {})])).toBe('');
  });
});

describe('formats', () => {
  it('uses the largest useful unit for durations', () => {
    expect(formatDuration(0)).toMatch(/1/);
    expect(formatDuration(65_000)).toMatch(/1.*5/);
    expect(formatDuration(3_660_000)).toMatch(/1.*1/);
  });

  it('shortens ages', () => {
    const now = 10_000_000_000;
    expect(formatAge(now - 30 * 60_000, now)).toMatch(/30/);
    expect(formatAge(now - 3 * 3_600_000, now)).toMatch(/3/);
    expect(formatAge(now - 2 * 86_400_000, now)).toMatch(/2/);
    expect(formatAge(now + 1000, now)).not.toMatch(/-/);
  });
});

describe('describePermission', () => {
  it('shows the exact operation being approved', () => {
    expect(describePermission('Bash', '{"command":"rm -rf x"}').detail).toBe('rm -rf x');
    expect(describePermission('Write', '{"file_path":"/a/b"}').detail).toBe('/a/b');
    expect(describePermission('Read', '{"file_path":"/a/b"}').detail).toBe('/a/b');
  });

  it('falls back to the full input for tools it does not know', () => {
    const input = '{"url":"x"}';
    expect(describePermission('mcp__x__y', input).detail).toBe(input);
    expect(describePermission('mcp__x__y', input).title).toContain('mcp__x__y');
  });
});
