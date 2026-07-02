import { describe, expect, it } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { analyzePage, createTextRenderingModeOperator } from './utils';

const textContent = {
  items: [
    {
      str: 'Invisible OCR text that is still extracted by PDF.js',
      dir: 'ltr',
      transform: [1, 0, 0, 1, 0, 0],
      width: 240,
      height: 12,
      fontName: 'f1',
      hasEOL: false,
    },
    {
      str: 'Another extracted hidden line with enough readable words',
      dir: 'ltr',
      transform: [1, 0, 0, 1, 0, 20],
      width: 260,
      height: 12,
      fontName: 'f1',
      hasEOL: false,
    },
  ],
  styles: {},
  lang: null,
};

describe('pdf engine utilities', () => {
  it('detects native hidden OCR from operator text rendering mode', async () => {
    const page = {
      getTextContent: async () => textContent,
      getOperatorList: async () => ({
        fnArray: [
          pdfjsLib.OPS.setTextRenderingMode,
          pdfjsLib.OPS.showText,
          pdfjsLib.OPS.showText,
        ],
        argsArray: [
          [3],
          ['hidden one'],
          ['hidden two'],
        ],
      }),
    } as unknown as pdfjsLib.PDFPageProxy;

    const analysis = await analyzePage(page);

    expect(analysis).toMatchObject({
      hasOCR: true,
      textHealth: 'hiddenOcr',
    });
    expect(analysis.textHealthReasons).toContain('mostly-hidden-text-operators');
  });

  it('restores text rendering mode across operator save and restore', async () => {
    const page = {
      getTextContent: async () => textContent,
      getOperatorList: async () => ({
        fnArray: [
          pdfjsLib.OPS.save,
          pdfjsLib.OPS.setTextRenderingMode,
          pdfjsLib.OPS.showText,
          pdfjsLib.OPS.restore,
          pdfjsLib.OPS.showText,
        ],
        argsArray: [
          [],
          [3],
          ['hidden one'],
          [],
          ['visible again'],
        ],
      }),
    } as unknown as pdfjsLib.PDFPageProxy;

    const analysis = await analyzePage(page);

    expect(analysis.hasOCR).toBe(false);
    expect(analysis.textHealth).not.toBe('hiddenOcr');
  });

  it('creates numeric PDF text rendering mode operands', () => {
    expect(String(createTextRenderingModeOperator(3))).toBe('3 Tr');
    expect(String(createTextRenderingModeOperator(0))).toBe('0 Tr');
  });
});
