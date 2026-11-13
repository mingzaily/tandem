import { Fragment, Schema, type Node as EditorNode, type Slice } from 'prosemirror-model';

/** Only code has structure; prose, lists and Markdown symbols remain editable text. */
export const composerSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'text*', group: 'block', whitespace: 'pre',
      parseDOM: [{ tag: 'p', preserveWhitespace: 'full' }], toDOM: () => ['p', 0],
    },
    code_block: {
      content: 'text*', group: 'block', code: true, defining: true, marks: '',
      attrs: { open: { default: '```' }, close: { default: '```' }, bodyLine: { default: true } },
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
      toDOM: () => ['pre', { class: 'composer-code-surface' }, ['code', 0]],
    },
    text: { group: 'inline' },
  },
});

export function parseComposerDocument(source: string): EditorNode {
  const lines = source.split('\n');
  const nodes: EditorNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)\r?$/.exec(lines[i]);
    if (open && i < lines.length - 1 && !(open[2][0] === '`' && open[3].includes('`'))) {
      let end = i + 1;
      for (; end < lines.length; end++) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(lines[end]);
        if (close && close[1][0] === open[2][0] && close[1].length >= open[2].length) break;
      }
      const body = lines.slice(i + 1, end).join('\n');
      nodes.push(composerSchema.nodes.code_block.create({ open: lines[i], close: lines[end] ?? null, bodyLine: end > i + 1 }, body ? composerSchema.text(body) : undefined));
      i = Math.min(end, lines.length - 1);
    } else nodes.push(composerSchema.nodes.paragraph.create(null, lines[i] ? composerSchema.text(lines[i]) : undefined));
  }
  return composerSchema.nodes.doc.create(null, nodes);
}

/** Literal fence lines inside edited code need a longer enclosing marker. */
function codeSource(node: EditorNode) {
  const opening = /^( {0,3})(`{3,}|~{3,})/.exec(node.attrs.open)!;
  let length = opening[2].length;
  for (const line of node.textContent.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(line)?.[1];
    if (marker?.[0] === opening[2][0]) length = Math.max(length, marker.length + 1);
  }
  const open = opening[1] + opening[2][0].repeat(length) + node.attrs.open.slice(opening[0].length);
  const close = node.attrs.close === null ? null : node.attrs.close.replace(/`{3,}|~{3,}/, (marker: string) => marker[0].repeat(Math.max(marker.length, length)));
  const body = node.textContent;
  return { open, source: open + (body || node.attrs.bodyLine ? '\n' + body : '') + (close === null ? '' : '\n' + close) };
}

const nodeSource = (node: EditorNode) => node.type.name === 'code_block' ? codeSource(node).source : node.textContent;
function serializeFragment(content: Fragment): string {
  const parts: string[] = [];
  content.forEach((node) => parts.push(nodeSource(node)));
  return parts.join('\n');
}
export const serializeComposerDocument = (doc: EditorNode): string => serializeFragment(doc.content);

export function serializeComposerSelection(slice: Slice): string {
  if (slice.content.childCount === 1 && slice.openStart > 0 && slice.openEnd > 0) return slice.content.firstChild!.textContent;
  return serializeFragment(slice.content);
}

export function positionAtSource(doc: EditorNode, sourceOffset: number): number {
  let sourceStart = 0, position = doc.content.size - 1;
  doc.forEach((node, offset) => {
    const source = nodeSource(node);
    if (sourceOffset >= sourceStart && sourceOffset <= sourceStart + source.length) {
      const bodyStart = sourceStart + (node.type.name === 'code_block' ? codeSource(node).open.length + 1 : 0);
      position = offset + 1 + Math.max(0, Math.min(node.content.size, sourceOffset - bodyStart));
    }
    sourceStart += source.length + 1;
  });
  return position;
}

export function sourceAtPosition(doc: EditorNode, position: number): number {
  if (position <= 0) return 0;
  if (position >= doc.content.size) return serializeComposerDocument(doc).length;
  let sourceStart = 0, sourceOffset = 0;
  doc.forEach((node, offset) => {
    if (position >= offset && position < offset + node.nodeSize) {
      sourceOffset = sourceStart + (node.type.name === 'code_block' ? codeSource(node).open.length + 1 : 0)
        + Math.max(0, Math.min(node.content.size, position - offset - 1));
    }
    sourceStart += nodeSource(node).length + 1;
  });
  return sourceOffset;
}
