interface Bounds { left: number; right: number; top: number; bottom: number }

/** Viewport coordinates let composer menus leave the scrolling input area. */
export function composerMenuPosition(
  bounds: Bounds,
  viewport: { width: number; height: number },
  width: number,
  panelMaxHeight: number,
  align: 'left' | 'right',
  side: 'above' | 'below',
  gap = 6,
  allowFlip = true,
): { left: number; width: number; maxHeight: number; top?: number; bottom?: number } {
  const margin = 8;
  const panelWidth = Math.min(width, viewport.width - margin * 2);
  const left = Math.max(margin, Math.min(align === 'right' ? bounds.right - panelWidth : bounds.left, viewport.width - panelWidth - margin));
  const above = Math.max(0, bounds.top - 56 - gap);
  const below = Math.max(0, viewport.height - bounds.bottom - 16 - gap);
  const preferred = side === 'above' ? above : below;
  const opposite = side === 'above' ? below : above;
  const placement = allowFlip && preferred < panelMaxHeight && opposite > preferred ? (side === 'above' ? 'below' : 'above') : side;
  const available = placement === 'above' ? above : below;
  return {
    left,
    width: panelWidth,
    maxHeight: Math.max(0, Math.min(panelMaxHeight, available)),
    ...(placement === 'above' ? { bottom: viewport.height - bounds.top + gap } : { top: bounds.bottom + gap }),
  };
}
