export interface ListRowBounds { start: number; end: number }

/** Measured centers keep pointer sorting aligned with the displayed font size. */
export function listInsertionIndex(rows: readonly ListRowBounds[], offset: number): number {
  const index = rows.findIndex(({ start, end }) => offset < (start + end) / 2);
  return index < 0 ? rows.length : index;
}

/** Pointer insertion slots become final indices after the dragged row is removed. */
export function listDropTarget(count: number, from: number, insertion: number): number {
  const target = insertion > from ? insertion - 1 : insertion;
  return Math.max(0, Math.min(count - 1, target));
}

/** Preview a move while React keeps ownership of row identities and DOM order. */
export function listPreviewStart(rows: readonly ListRowBounds[], index: number, from: number, target: number): number {
  const row = rows[index];
  const source = rows[from];
  const destination = rows[target];
  if (!row) return 0;
  if (!source || !destination || target === from) return row.start;
  const height = source.end - source.start;
  if (index === from) return target > from ? destination.end - height : destination.start;
  if (target > from && index > from && index <= target) return row.start - height;
  if (target < from && index >= target && index < from) return row.start + height;
  return row.start;
}

export function listScrollStep(pointer: number, top: number, bottom: number, elapsedMs: number): number {
  const zone = Math.min(24, (bottom - top) / 2);
  const direction = pointer < top + zone ? -1 : pointer > bottom - zone ? 1 : 0;
  const edge = direction < 0 ? top + zone - pointer : pointer - (bottom - zone);
  return direction * Math.min(1, Math.max(0, edge / zone)) * 360 * Math.min(32, elapsedMs) / 1000;
}
