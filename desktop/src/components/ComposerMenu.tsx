import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const TRIGGER =
  'inline-flex h-[30px] min-w-0 items-center gap-1 rounded-full border border-transparent bg-transparent px-2.5 text-13 transition-colors duration-[var(--motion-fast)] enabled:hover:border-[var(--border-default)] enabled:hover:bg-[var(--composer-pill-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50';
const PANEL =
  'absolute z-20 rounded-[12px] border border-[var(--cmd-palette-border)] bg-[var(--cmd-palette-bg)] shadow-[var(--shadow-menu)]';
const PANEL_BODY = 'overflow-y-auto p-2';
const PANEL_MAX_HEIGHT_PX = 340;
/** Keeps the panel clear of the title bar, which would otherwise cut off its first rows. */
const PANEL_TOP_MARGIN_PX = 56;
const PANEL_BOTTOM_MARGIN_PX = 16;
export const MENU_ROW =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-13 text-[var(--cmd-palette-item-text)] hover:bg-[var(--cmd-palette-item-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-45';

interface ComposerMenuProps {
  label: string;
  title?: string;
  trigger: ReactNode;
  triggerClassName?: string;
  align?: 'left' | 'right';
  side?: 'above' | 'below';
  /** Replaces the scrolling, padded body, for a panel that lays out its own columns. */
  bodyClassName?: string;
  panelMaxHeight?: number;
  width: number;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}

export function ComposerMenu({
  label,
  title,
  trigger,
  triggerClassName = 'text-[var(--text-primary)]',
  align = 'left',
  side = 'above',
  bodyClassName = PANEL_BODY,
  panelMaxHeight = PANEL_MAX_HEIGHT_PX,
  width,
  disabled = false,
  children,
}: ComposerMenuProps) {
  const [open, setOpen] = useState(false);
  const [maxHeight, setMaxHeight] = useState(PANEL_MAX_HEIGHT_PX);
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const bounds = root.current.getBoundingClientRect();
    const available =
      side === 'above' ? bounds.top - PANEL_TOP_MARGIN_PX : window.innerHeight - bounds.bottom - PANEL_BOTTOM_MARGIN_PX;
    setMaxHeight(Math.min(panelMaxHeight, available));
  }, [open, side, panelMaxHeight]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-label={label}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`${TRIGGER} ${triggerClassName}`}
      >
        {trigger}
      </button>
      {open ? (
        <div
          className={`${PANEL} ${bodyClassName} ${align === 'right' ? 'right-0' : 'left-0'} ${
            side === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
          style={{ width, maxHeight }}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
