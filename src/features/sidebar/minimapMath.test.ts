import { describe, expect, it } from 'vitest';
import { getMinimapPageIndexFromPoint, getMinimapViewport } from './minimapMath';

describe('minimap math', () => {
  it('includes the minimap internal scroll offset when mapping clicks', () => {
    expect(getMinimapPageIndexFromPoint({
      clientY: 120,
      containerTop: 100,
      minimapScrollTop: 400,
      pageCount: 200,
      pageLineHeight: 3,
      gap: 1,
    })).toBe(105);
  });

  it('returns null for clicks outside available pages', () => {
    expect(getMinimapPageIndexFromPoint({
      clientY: 10,
      containerTop: 100,
      minimapScrollTop: 0,
      pageCount: 20,
      pageLineHeight: 3,
      gap: 1,
    })).toBeNull();
  });

  it('keeps viewport top within minimap bounds', () => {
    const viewport = getMinimapViewport({
      pageCount: 665,
      pageLineHeight: 3,
      gap: 1,
      listHeight: 700,
      listScrollOffset: 999999,
      listTotalHeight: 665 * 88,
    });

    expect(viewport.top + viewport.height).toBeLessThanOrEqual(viewport.totalHeight);
  });
});
