import { describe, expect, it } from 'vitest';
import { parsePageRange } from './usePageRangeParser';

describe('parsePageRange', () => {
  it('marks mixed valid and invalid tokens as invalid', () => {
    const result = parsePageRange('1-3,9999', 10);

    expect(result.pages).toEqual([1, 2, 3]);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      { token: '9999', reason: 'Page 9999 out of range (1-10)' },
    ]);
  });

  it('does not silently clamp range ends beyond the document length', () => {
    const result = parsePageRange('8-15', 10);

    expect(result.pages).toEqual([]);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      { token: '8-15', reason: 'End page 15 exceeds total (10)' },
    ]);
  });

  it('rejects malformed numeric tokens instead of partially parsing them', () => {
    const result = parsePageRange('2abc, 3-4x', 10);

    expect(result.pages).toEqual([]);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      { token: '2abc', reason: '"2abc" is not a valid page number' },
      { token: '3-4x', reason: 'Invalid end page "4x"' },
    ]);
  });

  it('deduplicates and sorts valid pages', () => {
    const result = parsePageRange('5, 1-3, 2', 5);

    expect(result.pages).toEqual([1, 2, 3, 5]);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
