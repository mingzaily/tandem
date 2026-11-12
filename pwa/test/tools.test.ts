import test from 'node:test';
import assert from 'node:assert/strict';
import { toolPresentation } from '../src/lib/tools.ts';

test('MCP rows show the server and readable tool name, with raw identity available in details', () => {
  assert.deepEqual(toolPresentation('mcp__dbhub__execute_sql', '{"query":"select 1"}'), {
    label: '调用 dbhub · execute sql',
    detail: '',
    title: 'mcp__dbhub__execute_sql',
  });
  assert.equal(toolPresentation('mcp:fetch:read_page', '{}').label, '调用 fetch · read page');
});

test('file rows prioritise a filename while keeping the full path', () => {
  assert.deepEqual(toolPresentation('Edit', '{"file_path":"/work/src/App.tsx"}'), {
    label: '编辑',
    detail: 'App.tsx',
    title: '/work/src/App.tsx',
  });
  assert.equal(toolPresentation('Bash', 'echo ready').detail, 'echo ready');
});

test('unknown tools keep their name and structured parameters remain expandable', () => {
  assert.deepEqual(toolPresentation('custom', '{"command":{"nested":true}}'), {
    label: 'custom',
    detail: '',
    title: 'custom',
  });
  assert.equal(toolPresentation('Read', 'null').detail, '');
});
