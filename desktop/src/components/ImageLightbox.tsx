import { X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../lib/i18n';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const WHEEL_STEP = 0.0025;
const DOUBLE_CLICK_ZOOM = 2.5;

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const zoomTo = (next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setZoom(clamped);
    if (clamped === MIN_ZOOM) setOffset({ x: 0, y: 0 });
  };

  const startDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX - offset.x, y: event.clientY - offset.y, moved: false };
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('imagePreview')}
      onClick={onClose}
      onWheel={(event) => zoomTo(zoom * (1 - event.deltaY * WHEEL_STEP))}
      className="fixed inset-0 z-[60] flex select-none items-center justify-center overflow-hidden bg-black/75"
    >
      <button
        type="button"
        aria-label={t('imagePreviewClose')}
        data-tooltip={t('imagePreviewClose')}
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <X size={16} aria-hidden />
      </button>
      {zoom > MIN_ZOOM ? (
        <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-12 tabular-nums text-white">
          {Math.round(zoom * 100)}%
        </span>
      ) : null}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={() => zoomTo(zoom > MIN_ZOOM ? MIN_ZOOM : DOUBLE_CLICK_ZOOM)}
        onPointerDown={startDrag}
        onPointerMove={(event) => {
          if (drag.current && zoom > MIN_ZOOM) setOffset({ x: event.clientX - drag.current.x, y: event.clientY - drag.current.y });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
        className={`max-h-[90vh] max-w-[90vw] object-contain ${zoom > MIN_ZOOM ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
      />
    </div>,
    document.body,
  );
}

/** An image that opens large on click, where it can be zoomed and dragged to read the details. */
export function ZoomableImage({ src, alt = '', className, children }: { src: string; alt?: string; className?: string; children?: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={t('imagePreviewOpen')}
        data-tooltip={t('imagePreviewOpen')}
        onClick={() => setIsOpen(true)}
        className="block cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        {children ?? <img src={src} alt={alt} draggable={false} className={className} />}
      </button>
      {isOpen ? <Lightbox src={src} alt={alt} onClose={() => setIsOpen(false)} /> : null}
    </>
  );
}
