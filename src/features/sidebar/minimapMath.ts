export interface MinimapMetrics {
  pageCount: number;
  pageLineHeight: number;
  gap: number;
  listHeight: number;
  listScrollOffset: number;
  listTotalHeight: number;
}

export interface MinimapViewport {
  totalHeight: number;
  top: number;
  height: number;
}

export function getMinimapItemHeight(pageLineHeight: number, gap: number): number {
  return pageLineHeight + gap;
}

export function getMinimapPageIndexFromPoint(params: {
  clientY: number;
  containerTop: number;
  minimapScrollTop: number;
  pageCount: number;
  pageLineHeight: number;
  gap: number;
}): number | null {
  const itemHeight = getMinimapItemHeight(params.pageLineHeight, params.gap);
  const localY = params.clientY - params.containerTop + params.minimapScrollTop;
  const pageIndex = Math.floor(localY / itemHeight);

  if (pageIndex < 0 || pageIndex >= params.pageCount) return null;
  return pageIndex;
}

export function getMinimapViewport(metrics: MinimapMetrics): MinimapViewport {
  const itemHeight = getMinimapItemHeight(metrics.pageLineHeight, metrics.gap);
  const totalHeight = metrics.pageCount * itemHeight;
  const rawHeight = metrics.listTotalHeight > 0
    ? (metrics.listHeight / metrics.listTotalHeight) * totalHeight
    : totalHeight;
  const height = Math.min(totalHeight, Math.max(rawHeight, 12));
  const listScrollableHeight = Math.max(metrics.listTotalHeight - metrics.listHeight, 0);
  const minimapScrollableHeight = Math.max(totalHeight - height, 0);
  const top = listScrollableHeight > 0
    ? (metrics.listScrollOffset / listScrollableHeight) * minimapScrollableHeight
    : 0;

  return {
    totalHeight,
    top: Math.max(0, Math.min(top, minimapScrollableHeight)),
    height,
  };
}
