import { describe, expect, it } from 'vitest';
import {
  extractPagesById,
  getNextActivePageId,
  keepOnlyPagesById,
  pageIdsByNumbers,
  removePagesById,
  reorderPage,
  reorderSelectedPageBlock,
  reorderSinglePage,
  selectPageIdsByNumbers,
} from './pageOperations';

const pages = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));

describe('page operation helpers', () => {
  it('maps 1-indexed page numbers to ids and ignores invalid positions', () => {
    expect(pageIdsByNumbers(pages, [1, 3, 99, 2.5, 3])).toEqual(['a', 'c', 'c']);
    expect(Array.from(selectPageIdsByNumbers(pages, [3, 1, 3, 0]))).toEqual(['c', 'a']);
  });

  it('removes pages by id', () => {
    expect(removePagesById(pages, ['b', 'd']).map(page => page.id)).toEqual(['a', 'c', 'e']);
  });

  it('keeps pages by id in current document order', () => {
    expect(keepOnlyPagesById(pages, ['e', 'b']).map(page => page.id)).toEqual(['b', 'e']);
    expect(extractPagesById(pages, ['d', 'a', 'missing']).map(page => page.id)).toEqual(['a', 'd']);
  });

  it('chooses the next active page near a removed active page', () => {
    const nextPages = removePagesById(pages, ['c']);
    expect(getNextActivePageId(pages, nextPages, 'c')).toBe('d');
  });

  it('returns null when no pages remain activeable', () => {
    expect(getNextActivePageId(pages, [], 'c')).toBeNull();
  });

  it('preserves the active page when it still exists', () => {
    const nextPages = removePagesById(pages, ['a']);
    expect(getNextActivePageId(pages, nextPages, 'c')).toBe('c');
  });

  it('reorders a single page', () => {
    expect(reorderPage(pages, 1, 3).map(page => page.id)).toEqual(['a', 'c', 'd', 'b', 'e']);
    expect(reorderSinglePage(pages, 4, 0).map(page => page.id)).toEqual(['e', 'a', 'b', 'c', 'd']);
  });

  it('keeps original order when a reorder index is invalid', () => {
    expect(reorderPage(pages, 1, 99)).toBe(pages);
  });

  it('reorders a selected block while preserving relative selected order', () => {
    const next = reorderSelectedPageBlock(pages, ['b', 'd'], 'b', 4);
    expect(next.map(page => page.id)).toEqual(['a', 'c', 'b', 'd', 'e']);
  });

  it('keeps original order when selected block drop resolves to the same order', () => {
    expect(reorderSelectedPageBlock(pages, ['b', 'c'], 'b', 2)).toBe(pages);
  });

  it('reorders only the dragged page when it is not selected', () => {
    const next = reorderSelectedPageBlock(pages, ['b', 'd'], 'c', 0);
    expect(next.map(page => page.id)).toEqual(['c', 'a', 'b', 'd', 'e']);
  });
});
