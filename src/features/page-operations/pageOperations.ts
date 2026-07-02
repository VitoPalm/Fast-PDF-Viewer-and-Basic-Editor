export interface PageLike {
  id: string;
}

function hasSamePageOrder<T extends PageLike>(previousPages: T[], nextPages: T[]): boolean {
  return previousPages.length === nextPages.length &&
    previousPages.every((page, index) => page.id === nextPages[index]?.id);
}

export function pageIdsByNumbers<T extends PageLike>(pages: T[], pageNumbers: number[]): string[] {
  return pageNumbers.flatMap(pageNumber => {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.length) {
      return [];
    }

    return [pages[pageNumber - 1].id];
  });
}

export function selectPageIdsByNumbers<T extends PageLike>(
  pages: T[],
  pageNumbers: number[],
): Set<string> {
  return new Set(pageIdsByNumbers(pages, pageNumbers));
}

export function removePagesById<T extends PageLike>(pages: T[], ids: Iterable<string>): T[] {
  const idSet = new Set(ids);
  return pages.filter(page => !idSet.has(page.id));
}

export function keepOnlyPagesById<T extends PageLike>(pages: T[], ids: Iterable<string>): T[] {
  const idSet = new Set(ids);
  return pages.filter(page => idSet.has(page.id));
}

export function extractPagesById<T extends PageLike>(pages: T[], ids: Iterable<string>): T[] {
  return keepOnlyPagesById(pages, ids);
}

export function getNextActivePageId<T extends PageLike>(
  previousPages: T[],
  nextPages: T[],
  activePageId: string | null,
): string | null {
  if (nextPages.length === 0) return null;
  if (activePageId && nextPages.some(page => page.id === activePageId)) return activePageId;

  const previousIndex = activePageId
    ? previousPages.findIndex(page => page.id === activePageId)
    : -1;

  if (previousIndex < 0) return nextPages[0].id;
  return nextPages[Math.min(previousIndex, nextPages.length - 1)].id;
}

export function reorderPage<T>(items: T[], sourceIndex: number, destinationIndex: number): T[] {
  if (!Number.isInteger(sourceIndex) || !Number.isInteger(destinationIndex)) return items;
  if (sourceIndex < 0 || sourceIndex >= items.length) return items;
  if (destinationIndex < 0 || destinationIndex >= items.length) return items;
  if (sourceIndex === destinationIndex) return items;

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(destinationIndex, 0, moved);
  return next;
}

export function reorderSinglePage<T>(items: T[], sourceIndex: number, destinationIndex: number): T[] {
  return reorderPage(items, sourceIndex, destinationIndex);
}

export function reorderSelectedPageBlock<T extends PageLike>(
  pages: T[],
  selectedIds: Iterable<string>,
  draggedId: string,
  destinationIndex: number,
): T[] {
  if (!Number.isInteger(destinationIndex)) return pages;
  if (destinationIndex < 0 || destinationIndex >= pages.length) return pages;

  const draggedIndex = pages.findIndex(page => page.id === draggedId);
  if (draggedIndex < 0) return pages;

  const selectedIdSet = new Set(selectedIds);
  if (!selectedIdSet.has(draggedId) || selectedIdSet.size <= 1) {
    return reorderPage(pages, draggedIndex, destinationIndex);
  }

  const selectedPages = pages.filter(page => selectedIdSet.has(page.id));
  const remainingPages = pages.filter(page => !selectedIdSet.has(page.id));
  const selectedBeforeDestination = pages
    .slice(0, destinationIndex)
    .filter(page => selectedIdSet.has(page.id)).length;
  const insertionIndex = Math.max(
    0,
    Math.min(destinationIndex - selectedBeforeDestination, remainingPages.length),
  );

  const next = [...remainingPages];
  next.splice(insertionIndex, 0, ...selectedPages);
  return hasSamePageOrder(pages, next) ? pages : next;
}
