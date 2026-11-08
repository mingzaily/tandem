import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { type AgentInventory } from '../lib/api';
import { t } from '../lib/i18n';

interface ResourceRow { name: string; detail: string; scope: 'global' | 'project'; source: string; managed?: boolean; repository?: string | null }

function ResourceList({ rows, label }: { rows: ResourceRow[]; label: string }) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => 88, getItemKey: (index) => `${rows[index].scope}:${rows[index].source}:${rows[index].name}`, overscan: 3 });
  return <div ref={scroll} role="list" aria-label={label} tabIndex={rows.length > 4 ? 0 : undefined}
    className="overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]" style={{ height: Math.min(352, virtual.getTotalSize()) }}>
    <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
      {virtual.getVirtualItems().map((row) => {
        const resource = rows[row.index];
        return <div key={row.key} ref={virtual.measureElement} data-index={row.index} role="listitem" title={resource.source}
          className="absolute left-0 top-0 w-full border-t border-[var(--settings-theme-card-border)] px-4 py-3" style={{ transform: `translateY(${row.start}px)` }}>
          <div className="flex items-center gap-2">
            <span className="selectable min-w-0 truncate text-13 font-medium text-[var(--settings-section-title)]">{resource.name}</span>
            <span className="shrink-0 rounded-full bg-[var(--surface-chip)] px-2 py-0.5 text-11 text-[var(--text-secondary)]">{t(resource.scope === 'global' ? 'resourceGlobal' : 'resourceProject')}</span>
          </div>
          <p title={resource.detail} className="selectable mt-1 line-clamp-2 text-12 leading-[1.4] text-[var(--text-secondary)] [overflow-wrap:anywhere]">{resource.detail}</p>
          {resource.managed ? <p className="selectable mt-1 truncate text-11 text-[var(--text-tertiary)]">{t('resourceManaged')}{resource.repository ? ` · ${resource.repository}` : ''}</p> : null}
        </div>;
      })}
    </div>
  </div>;
}

function ResourceSection({ inventory, section }: { inventory: AgentInventory; section: 'mcp' | 'skills' }) {
  const title = t(section === 'mcp' ? 'resourceMcp' : 'resourceSkills');
  const errors = inventory.errors.filter((error) => error.section === section);
  const notes = inventory.notes.filter((note) => note.section === section);
  const rows: ResourceRow[] = section === 'mcp'
    ? inventory.mcpServers.map((server) => ({ name: server.name, scope: server.scope, source: server.source, detail: [server.transport, server.command].filter(Boolean).join(' · ') }))
    : inventory.skills.map((skill) => ({ ...skill, source: skill.path, detail: skill.description }));
  return <div>
    <h4 className="border-t border-[var(--settings-theme-card-border)] px-4 pb-2 pt-3 text-13 font-medium text-[var(--settings-section-title)]">{title}<span className="ml-2 text-12 font-normal text-[var(--text-tertiary)]">{rows.length}</span></h4>
    {rows.length ? <ResourceList rows={rows} label={title} /> : errors.length || notes.some((note) => note.kind === 'piMcpDisabled') ? null : <p className="px-4 pb-3 text-12 text-[var(--text-secondary)]">{t(section === 'mcp' ? 'resourceNoMcp' : 'resourceNoSkills')}</p>}
    {notes.map((note) => <p key={note.kind} className="px-4 pb-3 text-12 text-[var(--text-tertiary)]">{note.kind === 'piMcpDisabled' ? t('resourcePiMcpDisabled') : t('resourceMcpImports', { sources: note.detail })}</p>)}
    {errors.map((error, index) => <p key={index} role="alert" className="selectable px-4 pb-3 text-12 text-[var(--text-danger)] [overflow-wrap:anywhere]">{error.path}：{error.reason}</p>)}
  </div>;
}

export default function AgentResources({ inventory, error }: { inventory: AgentInventory | null; error: string | null }) {
  if (!inventory) return <p role={error ? 'alert' : 'status'} className="px-4 py-3 text-12 text-[var(--text-secondary)]">{error ?? t('resourceReading')}</p>;
  return <><ResourceSection inventory={inventory} section="mcp" /><ResourceSection inventory={inventory} section="skills" /></>;
}
