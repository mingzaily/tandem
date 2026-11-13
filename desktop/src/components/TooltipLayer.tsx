import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TooltipDelay, tooltipPosition, tooltipTags } from '../lib/tooltips';

/** Shared delayed tips cover native controls and portaled menus without per-button timers. */
export function TooltipLayer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [label, setLabel] = useState('');
  const [tagSource, setTagSource] = useState('');
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const delay = new TooltipDelay<HTMLElement>((anchor) => {
      const text = anchor?.isConnected ? anchor.dataset.tooltip : '';
      setTarget(text ? anchor : null);
      setLabel(text ?? '');
      setTagSource(text ? anchor?.dataset.tooltipTags ?? '' : '');
      setPosition(null);
    });
    const anchor = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null;
    const over = (event: PointerEvent) => { if (event.pointerType !== 'touch') delay.enter(anchor(event.target)); };
    const out = (event: PointerEvent) => delay.enter(anchor(event.relatedTarget));
    const focus = (event: FocusEvent) => delay.enter(anchor(event.target));
    const blur = (event: FocusEvent) => delay.enter(anchor(event.relatedTarget));
    const close = () => delay.close();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      close();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  useLayoutEffect(() => {
    if (!target || !tip.current) return;
    const update = () => {
      if (!target.isConnected || !target.dataset.tooltip) { setTarget(null); return; }
      setLabel(target.dataset.tooltip);
      setTagSource(target.dataset.tooltipTags ?? '');
      const next = tooltipPosition(target.getBoundingClientRect(), tip.current!.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
      setPosition((old) => old?.left === next.left && old.top === next.top ? old : next);
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(tip.current);
    const changes = new MutationObserver((records) => {
      if (!target.isConnected) { setTarget(null); return; }
      if (records.some((record) => record.target === target && (record.attributeName === 'data-tooltip' || record.attributeName === 'data-tooltip-tags'))) update();
    });
    changes.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tooltip', 'data-tooltip-tags'] });
    const described = document.activeElement instanceof HTMLElement && target.contains(document.activeElement) ? document.activeElement : target;
    described.setAttribute('aria-describedby', [...new Set([...(described.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? []), id])].join(' '));
    return () => {
      resize.disconnect(); changes.disconnect();
      const rest = described.getAttribute('aria-describedby')?.split(/\s+/).filter((value) => value && value !== id).join(' ');
      if (rest) described.setAttribute('aria-describedby', rest); else described.removeAttribute('aria-describedby');
    };
  }, [target, id]);

  if (!target || !label) return null;
  const tags = tooltipTags(tagSource);
  return createPortal(
    <div ref={tip} id={id} role="tooltip" className="app-tooltip pointer-events-none fixed z-[100] max-w-[min(360px,calc(100vw_-_16px))] whitespace-pre-line break-words rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-1 text-12 font-normal leading-5 text-[var(--text-primary)] shadow-[shadow:var(--shadow-menu)]" style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
      <div>{label}</div>
      {tags.length ? <div className="mt-1 flex flex-wrap gap-1">{tags.map((tag, index) =>
        <span key={index} className="app-tooltip-tag max-w-full whitespace-pre-wrap break-all rounded border border-[var(--border-default)] bg-[var(--surface-hover-soft)] px-1.5 py-px leading-4 text-[var(--text-secondary)]">{tag}</span>,
      )}</div> : null}
    </div>, document.body,
  );
}
