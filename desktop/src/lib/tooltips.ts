export const TOOLTIP_DELAY_MS = 1000;

/** One pending or visible tooltip at a time; moving within an anchor keeps its original deadline. */
export class TooltipDelay<T> {
  private target: T | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private show: (target: T | null) => void) {}

  enter(target: T | null) {
    if (target === this.target) return;
    this.close();
    this.target = target;
    if (target) this.timer = setTimeout(() => { this.timer = null; this.show(target); }, TOOLTIP_DELAY_MS);
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.target = null;
    this.show(null);
  }
}

/** Optional labels are plain text, independent of the tooltip body. */
export function tooltipTags(source: string): string[] {
  if (!source) return [];
  try {
    const tags: unknown = JSON.parse(source);
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0) : [];
  } catch { return []; }
}

export function tooltipPosition(anchor: { left: number; right: number; top: number; bottom: number }, tip: { width: number; height: number }, viewport: { width: number; height: number }) {
  const gap = 6;
  const inset = 8;
  const left = Math.min(Math.max(inset, anchor.left + (anchor.right - anchor.left - tip.width) / 2), Math.max(inset, viewport.width - tip.width - inset));
  const below = anchor.bottom + gap;
  const top = below + tip.height <= viewport.height - inset ? below : Math.max(inset, anchor.top - gap - tip.height);
  return { left, top };
}
