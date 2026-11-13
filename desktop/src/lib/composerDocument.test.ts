import { describe, expect, it } from 'vitest';
import { DOMSerializer } from 'prosemirror-model';
import { parseComposerDocument, serializeComposerDocument, positionAtSource, sourceAtPosition, serializeComposerSelection } from './composerDocument';

const fixtures = [
  '说明\n```\n短时间内收到了重复请求\n(code: 10100002)\n```',
  '```sh\n\tcommand --flag  \n\n  中文\n```\n后续说明',
  'before\n\n  ````ts\nconst x = "```";\n\n  ````\n\n~~~\nother\n~~~\n',
  '```\n```', '```\n\n```', '```sh\ncode\n', '```\n', '```',
  '正文\r\n```sh\r\n\t中文\r\n```\r\n',
  'inline ```literal```\n- normal list\n',
];

describe('editable composer document', () => {
  it.each(fixtures)('preserves the exact source through the structured document: %j', (source) => {
    expect(serializeComposerDocument(parseComposerDocument(source))).toBe(source);
  });

  it('stores fences as attributes and renders only the editable code body', () => {
    const doc = parseComposerDocument('说明\n```sh\n  echo 中文\n```\n后续');
    const code = doc.child(1);
    expect(code.type.name).toBe('code_block');
    expect(code.textContent).toBe('  echo 中文');
    expect(code.attrs.open).toBe('```sh');
    expect(code.attrs.close).toBe('```');
    expect(doc.textContent).not.toContain('```');
    const spec = DOMSerializer.fromSchema(doc.type.schema).nodes.code_block(code);
    expect(spec).toEqual(['pre', { class: 'composer-code-surface' }, ['code', 0]]);
  });

  it('maps raw source offsets to editable positions and back without exposing fence characters', () => {
    const source = '说明\n```sh\n  echo 中文\n```\n后续';
    const doc = parseComposerDocument(source);
    for (const at of [0, 1, source.indexOf('echo'), source.indexOf('中文') + 1, source.indexOf('后续')]) {
      expect(sourceAtPosition(doc, positionAtSource(doc, at))).toBe(at);
    }
    const codeStart = source.indexOf('  echo');
    expect(sourceAtPosition(doc, positionAtSource(doc, source.indexOf('```sh')))).toBe(codeStart);
  });

  it('maps full-document selection boundaries to the complete raw source', () => {
    const source = '```sh\n  echo 中文\n```';
    const doc = parseComposerDocument(source);
    expect(sourceAtPosition(doc, 0)).toBe(0);
    expect(sourceAtPosition(doc, doc.content.size)).toBe(source.length);
  });

  it('copies selected code text without fences and whole document selections with Markdown', () => {
    const source = '说明\n```sh\n  echo 中文\n```\n后续';
    const doc = parseComposerDocument(source);
    const start = positionAtSource(doc, source.indexOf('echo'));
    expect(serializeComposerSelection(doc.slice(start, start + 'echo 中文'.length))).toBe('echo 中文');
    expect(serializeComposerSelection(doc.slice(0, doc.content.size))).toBe(source);
  });

  it('lengthens a fence when literal fence lines are added inside code', () => {
    const original = parseComposerDocument('```sh\ncode\n```');
    const code = original.firstChild!;
    const changed = original.type.create(null, code.type.create(code.attrs, code.type.schema.text('code\n```\nmore')));
    const source = serializeComposerDocument(changed);
    expect(source).toBe('````sh\ncode\n```\nmore\n````');
    expect(parseComposerDocument(source).firstChild!.textContent).toBe('code\n```\nmore');
  });
});
