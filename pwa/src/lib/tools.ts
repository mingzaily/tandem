import { t } from './i18n';

const VERBS = {
  Read: 'toolRead',
  Edit: 'toolEdit',
  MultiEdit: 'toolEdit',
  Write: 'toolWrite',
  NotebookEdit: 'toolEdit',
  Bash: 'toolRun',
  Glob: 'toolSearch',
  Grep: 'toolSearch',
  WebFetch: 'toolFetch',
  WebSearch: 'toolSearch',
  TodoWrite: 'toolUpdate',
  LS: 'toolList',
} as const;

const string = (value: unknown) => (typeof value === 'string' ? value : '');

/** Keep raw input in the expanded detail; the main row says what the tool did. */
export function toolPresentation(
  name: string,
  raw: string,
): { label: string; detail: string; title: string } {
  let input: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>;
  } catch {
    /* Plain command text is valid input too. */
  }
  const separator = name.startsWith('mcp__') ? '__' : name.startsWith('mcp:') ? ':' : null;
  if (separator) {
    const [server, ...parts] = name.slice(3 + separator.length).split(separator);
    if (server && parts.length) {
      return {
        label: `${t('toolCall')} ${server} · ${parts.join(separator).replace(/_+/g, ' ')}`,
        detail: '',
        title: name,
      };
    }
  }
  const key = VERBS[name as keyof typeof VERBS];
  if (!key) return { label: name, detail: '', title: name };
  const path = string(input.file_path) || string(input.notebook_path);
  const command = string(input.command) || (name === 'Bash' && !Object.keys(input).length ? raw : '');
  const detail = path
    ? path.split('/').pop() || path
    : command || string(input.pattern) || string(input.query) || string(input.url) || string(input.path);
  return { label: t(key), detail, title: path || command || name };
}
