import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition } from '../lib/useAnchoredPosition';

/** AppearanceSection.FamilyDropdown geometry, shared by theme and display language. */
/** `compact` sizes the trigger to its text, for a toolbar beside other small controls. */
export function SettingsSelect<T extends string>({ label, value, options, onChange, compact = false }: { label: string; value: T; options: { id: T; text: string }[]; onChange: (value: T) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const position = useAnchoredPosition(open, root, 320, 288, 'right', 'below', 6);
  const close = () => { setOpen(false); root.current?.querySelector('button')?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false); };
    const outsideFocus = (event: FocusEvent) => { if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('focusin', outsideFocus);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('focusin', outsideFocus); };
  }, [open]);
  useEffect(() => { if (open) panel.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.focus(); }, [open, active, position]);
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length); }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setActive(event.key === 'Home' ? 0 : options.length - 1); }
  };
  return <div ref={root} className={`relative max-w-full ${compact ? 'w-auto max-w-[220px]' : 'w-[320px]'}`}>
    <button type="button" role="combobox" aria-label={label} aria-controls={id} aria-expanded={open} aria-haspopup="listbox"
      onClick={() => { setActive(Math.max(0, options.findIndex((option) => option.id === value))); setOpen(!open); }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(0, options.findIndex((option) => option.id === value))); setOpen(true); } }}
      className={`flex w-full items-center justify-between rounded-full border ${compact ? 'h-8 gap-2 px-3' : 'h-9 gap-3 px-3.5'} border-[var(--settings-input-border)] bg-[var(--settings-input-bg)] text-13 text-[var(--settings-input-text)] outline-none transition-colors hover:bg-[var(--settings-menu-bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]`}>
      <span className="min-w-0 truncate">{options.find((option) => option.id === value)?.text}</span><ChevronDown size={14} aria-hidden className="shrink-0 text-[var(--settings-eye-icon)]" />
    </button>
    {open && position ? createPortal(<div ref={panel} id={id} role="listbox" aria-label={label} onKeyDown={keys} style={position}
      className="fixed z-50 flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-xl border border-[var(--settings-input-border)] bg-[var(--settings-theme-card-bg)] p-2 shadow-[shadow:var(--shadow-menu)]">
      {options.map((option, index) => <button key={option.id} type="button" role="option" aria-selected={option.id === value} data-option-index={index} tabIndex={active === index ? 0 : -1}
        onClick={() => { onChange(option.id); close(); }} className="flex h-9 shrink-0 items-center justify-between gap-3 rounded-lg px-3 text-left text-13 text-[var(--settings-input-text)] outline-none hover:bg-[var(--settings-menu-bg-hover)] focus:bg-[var(--settings-menu-bg-hover)]">
        <span className="min-w-0 truncate">{option.text}</span>{option.id === value ? <Check size={16} aria-hidden className="shrink-0 text-[var(--settings-theme-icon-active)]" /> : null}
      </button>)}
    </div>, document.body) : null}
  </div>;
}
