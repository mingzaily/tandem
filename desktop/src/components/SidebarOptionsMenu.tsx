import { Check, ChevronRight, CircleDot, Clock, Layers, SquareTerminal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../lib/i18n';
import type { SidebarOptions } from '../lib/sidebarModel';
import { MENU_ROW } from './ComposerMenu';
import { FloatingMenu } from './FloatingMenu';

/** Pointer hover and keyboard focus share the same submenu, as in the sidebar reference. */
function Submenu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const keep = () => clearTimeout(closeTimer.current);
  const open = () => {
    keep();
    const bounds = trigger.current!.getBoundingClientRect();
    setAnchor({ x: bounds.right + 6 + 208 > window.innerWidth ? bounds.left - 214 : bounds.right + 6, y: bounds.top - 6 });
  };
  const leave = () => { closeTimer.current = setTimeout(() => setAnchor(null), 160); };
  return <div onPointerEnter={open} onPointerLeave={leave}>
    <button ref={trigger} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={!!anchor}
      className={`${MENU_ROW} ${anchor ? 'bg-[var(--cmd-palette-item-hover)]' : ''}`} onClick={open}
      onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); open(); } }}>
      {icon}<span className="flex-1">{label}</span><ChevronRight size={13} aria-hidden />
    </button>
    {anchor ? <FloatingMenu {...anchor} width={208} label={label} onClose={() => setAnchor(null)}>
      <div onPointerEnter={keep} onPointerLeave={leave} onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); setAnchor(null); trigger.current?.focus(); }
      }}>{children}</div>
    </FloatingMenu> : null}
  </div>;
}

const SORT_LABELS = { time: 'sidebarSortTime', type: 'sidebarSortType', priority: 'sidebarSortPriority' } as const;

export function SidebarOptionsMenu({ value, onChange }: { value: SidebarOptions; onChange: (value: SidebarOptions) => void }) {
  return <>
    <Submenu label={t('sidebarGrouping')} icon={<Layers size={15} aria-hidden />}>
      <button type="button" role="menuitemcheckbox" aria-checked={value.groupByCli} className={MENU_ROW} onClick={() => onChange({ ...value, groupByCli: !value.groupByCli })}>
        <SquareTerminal size={15} aria-hidden /><span className="flex-1">{t('sidebarGroupCli')}</span>{value.groupByCli ? <Check size={14} aria-hidden /> : null}
      </button>
    </Submenu>
    <Submenu label={t('sidebarSorting')} icon={<Clock size={15} aria-hidden />}>
      {(['time', 'type', 'priority'] as const).map((sort) => <button key={sort} type="button" role="menuitemradio" aria-checked={value.sort === sort} className={MENU_ROW} onClick={() => onChange({ ...value, sort })}>
        {sort === 'time' ? <Clock size={15} aria-hidden /> : sort === 'type' ? <SquareTerminal size={15} aria-hidden /> : <CircleDot size={15} aria-hidden />}<span className="flex-1">{t(SORT_LABELS[sort])}</span>{value.sort === sort ? <Check size={14} aria-hidden /> : null}
      </button>)}
    </Submenu>
  </>;
}
