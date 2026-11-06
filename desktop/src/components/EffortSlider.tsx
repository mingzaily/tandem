import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { t } from '../lib/i18n';
import { effortColor, effortColorAt, effortLabel, effortStops } from '../lib/modelEffort';
import './EffortSlider.css';

export function EffortSlider({ levels, value, defaultLevel, onChange, className = 'border-t border-[var(--model-dropdown-border)] px-3 pb-2.5 pt-2' }: {
  levels: string[];
  value: string | null;
  defaultLevel: string | null;
  onChange: (level: string | null) => void;
  className?: string;
}) {
  const stops = useMemo(() => effortStops(levels, defaultLevel), [levels, defaultLevel]);
  const index = Math.max(0, stops.indexOf(value ?? defaultLevel));
  const last = stops.length - 1;
  const [pointerId, setPointerId] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);
  const position = preview ?? index;
  const active = stops[Math.round(position)];
  const label = active ? effortLabel(active) : t('effortDefault');
  const color = effortColorAt(stops, position);
  const transition = pointerId === null ? 'width var(--motion-fast) var(--motion-ease-out), background-color var(--motion-base) var(--motion-ease-out)' : 'none';
  const thumbTransition = `${pointerId === null ? 'left var(--motion-base) var(--motion-ease-out), background-color var(--motion-base) var(--motion-ease-out), ' : ''}width var(--motion-fast) var(--motion-ease-out), height var(--motion-fast) var(--motion-ease-out)`;
  const commit = (next: number) => {
    const level = stops[next];
    onChange(level === defaultLevel ? null : level);
  };
  const positionOf = (clientX: number) => {
    const { left, width } = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - left) / width)) * last;
  };

  // A model refresh cancels the gesture before the new capability list is painted.
  useLayoutEffect(() => {
    activePointer.current = null;
    setPointerId(null); setPreview(null);
    return () => { activePointer.current = null; };
  }, [levels, defaultLevel]);
  useEffect(() => {
    if (pointerId === null) return;
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId === activePointer.current) setPreview(positionOf(event.clientX));
    };
    const cancel = () => { activePointer.current = null; setPointerId(null); setPreview(null); };
    const up = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== activePointer.current) return;
      commit(Math.round(positionOf(event.clientX)));
      cancel();
    };
    const pointerCancel = (event: globalThis.PointerEvent) => { if (event.pointerId === activePointer.current) cancel(); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('blur', cancel);
    };
  }, [pointerId, stops, defaultLevel, onChange]);

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    event.currentTarget.focus();
    activePointer.current = event.pointerId;
    setPointerId(event.pointerId);
    setPreview(Math.round(positionOf(event.clientX)));
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = ({ ArrowRight: index + 1, ArrowUp: index + 1, ArrowLeft: index - 1, ArrowDown: index - 1, Home: 0, End: last } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    commit(Math.min(last, Math.max(0, next)));
  };

  return (
    <div className={`shrink-0 ${className}`}>
      <div className="flex items-center justify-between text-12 leading-[1.33]">
        <span className="font-medium text-[var(--cmd-palette-item-meta)]">{t('effortMenu')}</span>
        <span className="text-[var(--text-secondary)]">{label}{active && !value && preview === null ? ` · ${t('effortDefault')}` : ''}</span>
      </div>
      {levels.length > 1 ? (
        <div className="group/effort relative min-w-0 flex-1 pl-1.5 pr-2.5">
          <div ref={track} role="slider" tabIndex={0} aria-label={t('effortMenu')}
            aria-valuemin={0} aria-valuemax={last} aria-valuenow={Math.round(position)} aria-valuetext={label}
            onPointerDown={down} onKeyDown={keyDown} data-dragging={pointerId !== null || undefined}
            className="tandem-effort-slider relative flex h-[38px] cursor-ew-resize touch-none items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
            <div className="absolute inset-x-0 h-3 rounded-full bg-[var(--slider-track)]" />
            <div className="absolute left-0 z-[1] h-3 rounded-full" style={{ width: `${position / last * 100}%`, backgroundColor: color, transition }} />
            {stops.map((stop, stopIndex) => stopIndex === 0 || stopIndex === last ? null : (
              <span key={stop ?? 'default'} aria-hidden className="absolute z-[2] size-[5px] -translate-x-1/2 rounded-full"
                style={{ left: `${stopIndex / last * 100}%`, backgroundColor: 'color-mix(in srgb, var(--model-dropdown-bg) 65%, transparent)' }} />
            ))}
            <span data-effort-thumb aria-hidden className="absolute z-[3] -translate-x-1/2 rounded-full border-[2.5px] border-[var(--model-dropdown-bg)]"
              style={{ left: `${position / last * 100}%`, backgroundColor: color, boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 22%, transparent)`, transition: thumbTransition }}>
              <span className={`pointer-events-none absolute bottom-[calc(100%-2px)] left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[7px] bg-[var(--tooltip-bg)] px-2.5 py-1 text-11 text-[var(--tooltip-text)] transition-opacity duration-[var(--motion-fast)] group-hover/effort:opacity-100 ${pointerId === null ? 'opacity-0' : 'opacity-100'}`}>
                <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: effortColor(active) }} />{label}
              </span>
            </span>
          </div>
          {pointerId !== null ? <div aria-hidden className="pointer-events-none absolute inset-x-1 -bottom-0.5 flex justify-between text-10 text-[var(--text-tertiary)]"><span>{stops[0] ? effortLabel(stops[0]) : t('effortDefault')}</span><span>{effortLabel(stops[last]!)}</span></div> : null}
        </div>
      ) : null}
    </div>
  );
}
