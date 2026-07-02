import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanOcrFromPage,
  cleanOcrUnavailableMessage,
  diagnoseGlyphText,
  glyphDiagnosticsUnavailableMessage,
  glyphRepairUnavailableMessage,
  repairGlyphText,
  type PdfDocumentInfo,
} from './utils';
import {
  type AntigravityPdfBridge,
  type CleanOcrInput,
  type GlyphDiagnosticsInput,
  type GlyphRepairInput,
} from '../../shared/types/electron';

const originalBridge = window.antigravityPdf;

const createDocInfo = (bytes: number[] = [1, 2, 3]): PdfDocumentInfo => ({
  id: 'doc-1',
  file: new File([new Uint8Array(bytes)], 'source.pdf', { type: 'application/pdf' }),
  name: 'source.pdf',
  pdfjsDoc: {} as PdfDocumentInfo['pdfjsDoc'],
  pageCount: 4,
});

afterEach(() => {
  if (originalBridge) {
    window.antigravityPdf = originalBridge;
  } else {
    delete window.antigravityPdf;
  }
});

describe('Clean OCR renderer bridge', () => {
  it('throws a precise unavailable error outside Electron', async () => {
    delete window.antigravityPdf;

    await expect(cleanOcrFromPage(createDocInfo(), 2)).rejects.toThrow(cleanOcrUnavailableMessage);
  });

  it('passes PDF bytes and a 1-indexed page number to the native bridge', async () => {
    const capturedInputs: CleanOcrInput[] = [];
    const bridge: AntigravityPdfBridge = {
      async cleanOcrPage(input) {
        capturedInputs.push(input);
        return { ok: true, pdfBytes: new Uint8Array([9, 8, 7]) };
      },
      async diagnoseGlyphText() {
        throw new Error('not used');
      },
      async repairGlyphText() {
        throw new Error('not used');
      },
    };
    window.antigravityPdf = bridge;

    const blob = await cleanOcrFromPage(createDocInfo([5, 6, 7]), 3);
    const output = new Uint8Array(await blob.arrayBuffer());
    const [input] = capturedInputs;
    if (!input) {
      throw new Error('Expected Clean OCR bridge input to be captured.');
    }

    expect(input.pageNumber).toBe(3);
    expect(Array.from(input.pdfBytes)).toEqual([5, 6, 7]);
    expect(Array.from(output)).toEqual([9, 8, 7]);
  });

  it('surfaces typed native bridge failures as errors', async () => {
    window.antigravityPdf = {
      async cleanOcrPage() {
        return {
          ok: false,
          error: {
            code: 'page-out-of-range',
            message: 'Clean OCR page 9 is outside this 4-page PDF.',
          },
        };
      },
      async diagnoseGlyphText() {
        throw new Error('not used');
      },
      async repairGlyphText() {
        throw new Error('not used');
      },
    };

    await expect(cleanOcrFromPage(createDocInfo(), 9)).rejects.toThrow('Clean OCR page 9 is outside this 4-page PDF.');
  });
});

describe('Glyph diagnostics renderer bridge', () => {
  it('throws a precise unavailable error outside Electron', async () => {
    delete window.antigravityPdf;

    await expect(diagnoseGlyphText(createDocInfo(), [2])).rejects.toThrow(glyphDiagnosticsUnavailableMessage);
  });

  it('passes PDF bytes and page numbers to the native bridge', async () => {
    const capturedInputs: GlyphDiagnosticsInput[] = [];
    const bridge: AntigravityPdfBridge = {
      async cleanOcrPage() {
        throw new Error('not used');
      },
      async diagnoseGlyphText(input) {
        capturedInputs.push(input);
        return {
          ok: true,
          report: {
            pageCount: 4,
            encrypted: false,
            signatureCount: 0,
            pagesAnalyzed: 1,
            fontCount: 1,
            glyphEvents: 2,
            unmappedGlyphs: 0,
            deterministicCandidateFonts: 0,
            pages: [],
          },
        };
      },
      async repairGlyphText() {
        throw new Error('not used');
      },
    };
    window.antigravityPdf = bridge;

    const report = await diagnoseGlyphText(createDocInfo([4, 5, 6]), [3]);
    const [input] = capturedInputs;
    if (!input) {
      throw new Error('Expected glyph diagnostics bridge input to be captured.');
    }

    expect(input.pageNumbers).toEqual([3]);
    expect(Array.from(input.pdfBytes)).toEqual([4, 5, 6]);
    expect(report).toMatchObject({ pageCount: 4, pagesAnalyzed: 1, fontCount: 1 });
  });
});

describe('Glyph repair renderer bridge', () => {
  it('throws a precise unavailable error outside Electron', async () => {
    delete window.antigravityPdf;

    await expect(repairGlyphText(createDocInfo(), [2])).rejects.toThrow(glyphRepairUnavailableMessage);
  });

  it('passes PDF bytes and page numbers to the native repair bridge', async () => {
    const capturedInputs: GlyphRepairInput[] = [];
    const bridge: AntigravityPdfBridge = {
      async cleanOcrPage() {
        throw new Error('not used');
      },
      async diagnoseGlyphText() {
        throw new Error('not used');
      },
      async repairGlyphText(input) {
        capturedInputs.push(input);
        return {
          ok: true,
          pdfBytes: new Uint8Array([8, 9, 10]),
          report: {
            pageCount: 4,
            encrypted: false,
            signatureCount: 0,
            pagesAnalyzed: 1,
            fontsConsidered: 1,
            fontsRepaired: 1,
            mappingsAdded: 3,
            protectedDocument: false,
            validation: {
              reloaded: true,
              visualPagesCompared: 1,
              maxChangedPixelRatio: 0,
              maxChannelDelta: 0,
              beforeTextLength: 3,
              afterTextLength: 3,
              extractionChangedPages: 0,
            },
            afterDiagnostics: {
              pageCount: 4,
              encrypted: false,
              signatureCount: 0,
              pagesAnalyzed: 1,
              fontCount: 1,
              glyphEvents: 3,
              unmappedGlyphs: 0,
              deterministicCandidateFonts: 0,
              pages: [],
            },
            fonts: [],
          },
        };
      },
    };
    window.antigravityPdf = bridge;

    const { blob, report } = await repairGlyphText(createDocInfo([7, 8, 9]), [3]);
    const [input] = capturedInputs;
    if (!input) {
      throw new Error('Expected glyph repair bridge input to be captured.');
    }

    expect(input.pageNumbers).toEqual([3]);
    expect(Array.from(input.pdfBytes)).toEqual([7, 8, 9]);
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([8, 9, 10]);
    expect(report).toMatchObject({ fontsRepaired: 1, mappingsAdded: 3 });
  });
});
