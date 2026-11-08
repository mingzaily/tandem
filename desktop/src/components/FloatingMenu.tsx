import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const WINDOW_MARGIN_PX = 8;
const MenuTree = createContext<string | null>(null);

interface FloatingMenuProps {
  x: number;
  y: number;
  width?: number;
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** A menu that opens at a point. It leaves the sidebar's DOM, whose scrolling would clip it. */
export function FloatingMenu({ x, y, width = 200, label, onClose, children }: FloatingMenuProps) {
  const inheritedTree = useContext(MenuTree);
  const id = useId();
  const tree = inheritedTree ?? id;
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!panel.current) return;
    const { offsetWidth, offsetHeight } = panel.current;
    setPosition({
      left: Math.max(WINDOW_MARGIN_PX, Math.min(x, window.innerWidth - offsetWidth - WINDOW_MARGIN_PX)),
      top: Math.max(WINDOW_MARGIN_PX, Math.min(y, window.innerHeight - offsetHeight - WINDOW_MARGIN_PX)),
    });
  }, [x, y]);

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (!(event.target as Element).closest(`[data-menu-tree="${tree}"]`)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose, tree]);

  return createPortal(
    <MenuTree.Provider value={tree}><div
      ref={panel}
      role="menu"
      aria-label={label}
      data-menu-tree={tree}
      onKeyDown={(event) => {
        if ((event.target as Element).closest('[role="menu"]') !== panel.current) return;
        const items = [...panel.current!.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')].filter((item) => !item.disabled);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
      }}
      style={{ ...position, width }}
      className="fixed z-50 flex flex-col gap-0.5 rounded-[12px] border border-[var(--cmd-palette-border)] bg-[var(--cmd-palette-bg)] p-1.5 shadow-[shadow:var(--shadow-menu)]"
    >
      {children}
    </div></MenuTree.Provider>,
    document.body,
  );
}
