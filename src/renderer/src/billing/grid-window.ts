export interface WindowInput {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  columns: number;
  total: number;
  overscanRows: number;
}

export interface ItemRange {
  start: number;
  end: number;
}

export function columnCount(width: number, minTile: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (minTile + gap)));
}

export function gridHeight(total: number, columns: number, rowHeight: number, gap: number): number {
  if (total === 0) return 0;
  return Math.ceil(total / columns) * rowHeight - gap;
}

export function visibleRange(input: WindowInput): ItemRange {
  const { scrollTop, viewportHeight, rowHeight, columns, total, overscanRows } = input;
  if (total === 0) return { start: 0, end: 0 };
  const rows = Math.ceil(total / columns);
  const firstRow = Math.min(
    rows - 1,
    Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows),
  );
  const lastRow = Math.min(
    rows - 1,
    Math.floor((scrollTop + viewportHeight) / rowHeight) + overscanRows,
  );
  return { start: firstRow * columns, end: Math.min(total, (lastRow + 1) * columns) };
}

export function pagesForRange(range: ItemRange, pageSize: number): number[] {
  if (range.end <= range.start) return [];
  const first = Math.floor(range.start / pageSize);
  const last = Math.floor((range.end - 1) / pageSize);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function scrollTopFor(
  index: number,
  current: { scrollTop: number; viewportHeight: number },
  layout: { rowHeight: number; columns: number; gap: number },
): number {
  const rowTop = Math.floor(index / layout.columns) * layout.rowHeight;
  const rowBottom = rowTop + layout.rowHeight - layout.gap;
  if (rowTop < current.scrollTop) return rowTop;
  if (rowBottom > current.scrollTop + current.viewportHeight) {
    return rowBottom - current.viewportHeight;
  }
  return current.scrollTop;
}
