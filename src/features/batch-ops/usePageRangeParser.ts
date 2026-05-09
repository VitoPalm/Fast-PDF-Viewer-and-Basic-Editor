import { useMemo } from 'react';

export interface RangeParseResult {
  /** Sorted, deduplicated 1-indexed page numbers */
  pages: number[];
  /** Per-token errors for inline validation highlighting */
  errors: { token: string; reason: string }[];
  /** True when at least one valid page exists and no errors */
  isValid: boolean;
  /** Raw token count (for UI display) */
  tokenCount: number;
}

/**
 * Parse a page-range expression string.
 *
 * Supported syntax:
 *   "5"          → page 5
 *   "1-45"       → pages 1 through 45
 *   "120-end"    → pages 120 through last page
 *   "1-45, 78"   → union of ranges
 *   spaces/tabs are ignored
 */
export function parsePageRange(input: string, totalPages: number): RangeParseResult {
  const pages = new Set<number>();
  const errors: { token: string; reason: string }[] = [];

  if (!input.trim()) {
    return { pages: [], errors: [], isValid: false, tokenCount: 0 };
  }

  const tokens = input.split(',').map(t => t.trim()).filter(Boolean);

  for (const token of tokens) {
    // Range: "X-Y" or "X-end"
    if (token.includes('-')) {
      const parts = token.split('-').map(p => p.trim());
      if (parts.length !== 2) {
        errors.push({ token, reason: 'Invalid range format' });
        continue;
      }

      const [startStr, endStr] = parts;
      const start = parseInt(startStr, 10);

      if (isNaN(start) || start < 1) {
        errors.push({ token, reason: `Invalid start page "${startStr}"` });
        continue;
      }
      if (start > totalPages) {
        errors.push({ token, reason: `Page ${start} exceeds total (${totalPages})` });
        continue;
      }

      let end: number;
      if (endStr.toLowerCase() === 'end' || endStr === '') {
        end = totalPages;
      } else {
        end = parseInt(endStr, 10);
        if (isNaN(end)) {
          errors.push({ token, reason: `Invalid end page "${endStr}"` });
          continue;
        }
      }

      if (end > totalPages) {
        end = totalPages; // Clamp silently
      }
      if (end < start) {
        errors.push({ token, reason: `End (${end}) is before start (${start})` });
        continue;
      }

      for (let i = start; i <= end; i++) pages.add(i);
    } else {
      // Single page
      const num = parseInt(token, 10);
      if (isNaN(num)) {
        errors.push({ token, reason: `"${token}" is not a valid page number` });
        continue;
      }
      if (num < 1 || num > totalPages) {
        errors.push({ token, reason: `Page ${num} out of range (1-${totalPages})` });
        continue;
      }
      pages.add(num);
    }
  }

  const sorted = Array.from(pages).sort((a, b) => a - b);
  return {
    pages: sorted,
    errors,
    isValid: sorted.length > 0 && errors.length === 0,
    tokenCount: tokens.length,
  };
}

/**
 * React hook wrapper with memoization.
 */
export function usePageRangeParser(input: string, totalPages: number): RangeParseResult {
  return useMemo(() => parsePageRange(input, totalPages), [input, totalPages]);
}
