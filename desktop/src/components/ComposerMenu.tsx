import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition } from '../lib/useAnchoredPosition';

const TRIGGER =
  'inline-flex h-[30px] min-w-0 items-center gap-1 rounded-full border border-transparent bg-transparent px-2.5 text-13 transition-colors duration-[var(--motion-fast)] enabled:hover:border-[var(--border-default)] enabled:hover:bg-[var(--composer-pill-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50';
const PANEL =
  'fixed z-50 rounded-[12px] border border-[var(--cmd-palette-border)] bg-[var(--cmd-palette-bg)] shadow-[shadow:var(--shadow-menu)]';
const PANEL_BODY = 'overflow-y-auto p-2';
const PANEL_MAX_HEIGHT_PX = 340;
export const MENU_ROW =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-13 text-[var(--cmd-palette-item-text)] hover:bg-[var(--cmd-palette-item-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-default disabled:opacity-45';

export interface ComposerMenuOwner {
  id: string;
  panel: RefObject<HTMLDivElement | null>;
}

interface ComposerMenuProps {
  label: string;
  title?: string;
  trigger: ReactNode;
  triggerClassName?: string;
  align?: 'left' | 'right';
  side?: 'above' | 'below';
  allowFlip?: boolean;
  /** Replaces the scrolling, padded body, for a panel that lays out its own columns. */
  bodyClassName?: string;
  panelMaxHeight?: number;
  width: number;
  disabled?: boolean;
  children: (close: () => void, owner: ComposerMenuOwner) => ReactNode;
}

export function ComposerMenu({
  label,
  title,
  trigger,
  triggerClassName = 'text-[var(--text-primary)]',
  align = 'left',
  side = 'above',
  allowFlip = true,
  bodyClassName = PANEL_BODY,
  panelMaxHeight = PANEL_MAX_HEIGHT_PX,
  width,
  disabled = false,
  children,
}: ComposerMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const position = useAnchoredPosition(open, root, width, panelMaxHeight, align, side, 6, allowFlip);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      const branch = event.target instanceof Element ? event.target.closest('[data-composer-menu-owner]') : null;
      if (!root.current?.contains(event.target as Node) && branch?.getAttribute('data-composer-menu-owner') !== id) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setOpen(false);
        root.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, id]);

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-label={label}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`${TRIGGER} ${triggerClassName}`}
      >
        {trigger}
      </button>
      {open && position ? createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label={label}
          data-composer-menu-owner={id}
          className={`${PANEL} ${bodyClassName}`}
          style={position}
        >
          {children(() => setOpen(false), { id, panel })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
