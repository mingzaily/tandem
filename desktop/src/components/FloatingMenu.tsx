import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const WINDOW_MARGIN_PX = 8;

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
      if (!panel.current?.contains(event.target as Node)) onClose();
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
  }, [onClose]);

  return createPortal(
    <div
      ref={panel}
      role="menu"
      aria-label={label}
      style={{ ...position, width }}
      className="fixed z-50 flex flex-col gap-0.5 rounded-[12px] border border-[var(--cmd-palette-border)] bg-[var(--cmd-palette-bg)] p-1.5 shadow-[shadow:var(--shadow-menu)]"
    >
      {children}
    </div>,
    document.body,
  );
}
