import { BookText, ChevronDown, Plug, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { type AgentInventory } from '../lib/api';
import { t } from '../lib/i18n';

type Kind = 'mcp' | 'skills';
type Scope = 'global' | 'project';

interface ResourceRow {
  key: string;
  name: string;
  /** One line after the name: the transport and command, or the skill's description. */
  detail: string;
  scope: Scope;
  /** Where it was read from, shown on hover. */
  source: string;
  badge?: string;
  /** The extension that loads it, named in the group title. */
  provider?: string;
}

/** pi-mcp-adapter's import kinds, by the name each client goes by. */
const IMPORT_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code', 'claude-desktop': 'Claude Desktop', codex: 'Codex', cursor: 'Cursor', windsurf: 'Windsurf', vscode: 'VS Code',
};

function rowsOf(inventory: AgentInventory, kind: Kind): ResourceRow[] {
  return kind === 'mcp'
    ? inventory.mcpServers.map((server) => ({
      key: `${server.scope}:${server.source}:${server.name}`,
      name: server.name,
      scope: server.scope,
      source: server.source,
      detail: [server.transport, server.command].filter(Boolean).join(' · '),
      badge: server.importedFrom ? t('resourceImportedFrom', { source: IMPORT_NAMES[server.importedFrom] ?? server.importedFrom }) : undefined,
      provider: server.provider,
    }))
    : inventory.skills.map((skill) => ({
      key: `${skill.scope}:${skill.path}`,
      name: skill.name,
      scope: skill.scope,
      source: skill.path,
      detail: skill.description,
      badge: skill.managed ? t('resourceManaged') : undefined,
    }));
}

/** The reference's segmented control: a chip track with the chosen option raised on it. */
function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { id: T; text: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return <div role="radiogroup" aria-label={label} className="flex h-7 shrink-0 items-center gap-0.5 rounded-full bg-[var(--surface-chip)] p-0.5">
    {options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={value === option.id} onClick={() => onChange(option.id)}
      className={`flex h-6 items-center gap-1.5 rounded-full px-2.5 text-12 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
        value === option.id
          ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}>
      {option.text}
    </button>)}
  </div>;
}

function Group({ title, rows, icon }: { title: string; rows: ResourceRow[]; icon: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return <div className="flex flex-col">
    <button type="button" onClick={() => setCollapsed((current) => !current)} aria-expanded={!collapsed}
      className="flex items-center gap-1 self-start rounded-md px-2 pb-0.5 text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
      <ChevronDown size={12} aria-hidden className={`text-[var(--text-tertiary)] transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`} />
      <span className="text-11 font-medium tracking-[0.5px] text-[var(--text-tertiary)]">{title}</span>
      <span className="text-11 tabular-nums text-[var(--text-tertiary)] opacity-60">{rows.length}</span>
    </button>
    {collapsed ? null : <div role="list" aria-label={title} className="flex flex-col">
      {rows.map((row) => <div key={row.key} role="listitem" data-tooltip={row.source}
        className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-[7px] transition-colors hover:bg-[var(--settings-menu-bg-hover)]">
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center text-[var(--text-secondary)]">{icon}</span>
        <span className="selectable shrink-0 truncate text-14 font-medium text-[var(--settings-section-title)] max-w-[45%]">{row.name}</span>
        <span data-tooltip={row.detail} className="selectable min-w-0 flex-1 truncate text-12 text-[var(--text-tertiary)]">{row.detail}</span>
        {row.badge ? <span className="shrink-0 rounded-full bg-[var(--surface-chip)] px-2 py-0.5 text-11 font-medium text-[var(--text-secondary)]">{row.badge}</span> : null}
      </div>)}
    </div>}
  </div>;
}

/**
 * The scrolling part of an agent's detail: a sticky toolbar to switch between MCP servers and
 * skills, pick the project and filter, then the list grouped by where each entry is configured.
 * Laid out like the reference's provider model list (`UnifiedModelList`).
 */
export default function AgentResources({ inventory, error, projectPicker }: {
  inventory: AgentInventory | null;
  error: string | null;
  projectPicker: ReactNode;
}) {
  const [kind, setKind] = useState<Kind>('mcp');
  const [query, setQuery] = useState('');
  const all = useMemo(() => (inventory ? rowsOf(inventory, kind) : []), [inventory, kind]);
  const needle = query.trim().toLowerCase();
  const rows = needle ? all.filter((row) => `${row.name} ${row.detail}`.toLowerCase().includes(needle)) : all;
  // Grouped by where each entry is configured and, for Pi, by the extension that loads it.
  const groups = (['project', 'global'] as const).flatMap((scope) => {
    const inScope = rows.filter((row) => row.scope === scope);
    return [...new Set(inScope.map((row) => row.provider))].map((provider) => ({
      key: `${scope}:${provider ?? ''}`,
      title: [provider, t(scope === 'global' ? 'resourceGlobal' : 'resourceProject')].filter(Boolean).join(' · '),
      rows: inScope.filter((row) => row.provider === provider),
    }));
  });
  const errors = inventory?.errors.filter((item) => item.section === kind) ?? [];
  const notes = inventory?.notes.filter((note) => note.section === kind) ?? [];
  const icon = kind === 'mcp' ? <Plug size={15} strokeWidth={1.8} /> : <BookText size={15} strokeWidth={1.8} />;
  const count = (section: Kind) => (inventory ? (section === 'mcp' ? inventory.mcpServers.length : inventory.skills.length) : null);

  return <div className="flex flex-col">
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 bg-[var(--settings-theme-card-bg)] px-5 pb-2 pt-2.5">
      <Segmented label={t('resourceKind')} value={kind} onChange={setKind} options={(['mcp', 'skills'] as const).map((id) => ({
        id,
        text: <>{t(id === 'mcp' ? 'resourceMcp' : 'resourceSkills')}{count(id) !== null ? <span className="tabular-nums opacity-60">{count(id)}</span> : null}</>,
      }))} />
      <span className="min-w-0 flex-1" />
      {projectPicker}
      <label className="flex h-8 min-w-0 basis-[180px] items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 focus-within:border-[var(--focus-ring)]">
        <Search size={14} aria-hidden className="shrink-0 text-[var(--text-tertiary)]" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('resourceSearch')} aria-label={t('resourceSearch')}
          className="min-w-0 flex-1 bg-transparent text-13 text-[var(--settings-section-title)] outline-none placeholder:text-[var(--text-placeholder)]" />
      </label>
    </div>
    {notes.map((note) => <div key={note.kind} className="border-t border-[var(--settings-theme-card-border)] px-5 py-3 text-13 text-[var(--text-tertiary)]">
      {note.kind === 'piMcpDisabled' ? t('resourcePiMcpDisabled') : t('resourceMcpImports', { sources: note.detail })}
    </div>)}
    {errors.map((item, index) => <div key={index} role="alert" className="selectable border-t border-[var(--settings-theme-card-border)] px-5 py-3 text-13 text-[var(--text-danger)] [overflow-wrap:anywhere]">
      {item.path}：{item.reason}
    </div>)}
    <div className="border-t border-[var(--settings-theme-card-border)]">
      <div className="flex flex-col gap-4 px-3 pb-4 pt-1.5">
        {!inventory ? (
          <p role={error ? 'alert' : 'status'} className="px-2 py-4 text-center text-13 text-[var(--text-tertiary)]">{error ?? t('resourceReading')}</p>
        ) : groups.length === 0 ? (
          errors.length || notes.some((note) => note.kind === 'piMcpDisabled') ? null : (
            <p className="px-2 py-4 text-center text-13 text-[var(--text-tertiary)]">
              {needle ? t('resourceNoMatch') : t(kind === 'mcp' ? 'resourceNoMcp' : 'resourceNoSkills')}
            </p>
          )
        ) : (
          groups.map((group) => <Group key={`${kind}:${group.key}`} title={group.title} rows={group.rows} icon={icon} />)
        )}
      </div>
    </div>
  </div>;
}
