interface Rect { left: number; right: number; top: number; bottom: number }

/** Keep the configuration beside the full menu, aligned with its row and inside the viewport. */
export function modelFlyoutPosition(anchor: Rect, panel: Rect, height: number, viewport: { width: number; height: number }) {
  const margin = 8, gap = 4;
  const width = Math.min(264, viewport.width - margin * 2);
  const leftCandidate = panel.left - gap - width;
  const rightCandidate = panel.right + gap;
  const side = leftCandidate >= margin ? 'left' : rightCandidate + width <= viewport.width - margin ? 'right'
    : leftCandidate >= viewport.width - rightCandidate - width ? 'left' : 'right';
  const left = Math.max(margin, Math.min(side === 'left' ? leftCandidate : rightCandidate, viewport.width - width - margin));
  const panelMaxTop = panel.bottom - height;
  const top = Math.max(margin, Math.min(Math.max(Math.min(anchor.top - 12, panelMaxTop), Math.min(panel.top, panelMaxTop)), viewport.height - height - margin));
  return { left, top, width, maxHeight: viewport.height - margin * 2, side };
}
