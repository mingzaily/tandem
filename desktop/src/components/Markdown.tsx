import { Children, createContext, isValidElement, memo, useContext, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import { Copy, FileText, FolderOpen, ExternalLink } from 'lucide-react';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { openExternal, openTaskPath, resolveTaskPath, type Agent } from '../lib/api';
import { localFileTarget, shouldRenderFileChip } from '../lib/fileLinks';
import { t } from '../lib/i18n';
import { FloatingMenu } from './FloatingMenu';
import { MENU_ROW } from './ComposerMenu';
import '../styles/markdown.css';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [[rehypeHighlight, { detect: false }]] as const;

export const TaskFileContext = createContext<{ agent: Agent; id: string; cwd: string | null } | null>(null);

function labelText(children: ReactNode): string {
  return Children.toArray(children).map((child) => isValidElement<{ children?: ReactNode }>(child) ? labelText(child.props.children) : String(child)).join('');
}

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const task = useContext(TaskFileContext);
  const path = href ? localFileTarget(href) : null;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chip = path !== null && shouldRenderFileChip(path, labelText(children));
  const absolutePath = path && !path.startsWith('/') && !path.startsWith('~/') && task?.cwd ? `${task.cwd}/${path}` : path;
  const open = (action: 'open' | 'reveal') => {
    setError(null);
    if (task && path) void openTaskPath(task.agent, task.id, path, action).catch((reason) => setError(String(reason)));
  };
  return <>
    <a href={href} data-tooltip={error ?? absolutePath ?? undefined}
      className={chip ? 'file-reference-chip' : undefined}
      onClick={(event) => { event.preventDefault(); if (path) open('open'); else if (href) void openExternal(href); }}
      onContextMenu={path ? (event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); } : undefined}>
      {chip ? <FileText size={12} aria-hidden className="shrink-0 text-[var(--chat-input-chip-icon)]" /> : null}{children}
    </a>
    {error ? <span role="alert" className="ml-1 text-12 text-[var(--text-danger)]">{error}</span> : null}
    {menu && path ? <FloatingMenu {...menu} label={t('fileMenu')} onClose={() => setMenu(null)}>
      <button type="button" role="menuitem" className={MENU_ROW} onClick={() => { setMenu(null); open('open'); }}><ExternalLink size={15} aria-hidden />{t('fileOpen')}</button>
      <button type="button" role="menuitem" className={MENU_ROW} onClick={() => { setMenu(null); open('reveal'); }}><FolderOpen size={15} aria-hidden />{t('fileReveal')}</button>
      <button type="button" role="menuitem" className={MENU_ROW} onClick={() => { setMenu(null); if (task) void resolveTaskPath(task.agent, task.id, path).then((resolved) => navigator.clipboard.writeText(resolved)).catch((reason) => setError(String(reason))); }}><Copy size={15} aria-hidden />{t('fileCopyPath')}</button>
    </FloatingMenu> : null}
  </>;
}

const components: Components = {
  a: MarkdownLink,
  // Task content must not trigger network requests, so remote images show as text.
  img: ({ alt }) => <span>{alt}</span>,
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md selectable">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins as never}
        components={components}
        urlTransform={(url) => localFileTarget(url) !== null ? url : defaultUrlTransform(url)}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
