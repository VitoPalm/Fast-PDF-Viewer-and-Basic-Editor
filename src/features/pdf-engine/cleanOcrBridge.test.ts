import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanOcrFromPage,
  cleanOcrUnavailableMessage,
  type PdfDocumentInfo,
} from './utils';
import { type AntigravityPdfBridge, type CleanOcrInput } from '../../shared/types/electron';

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
    };

    await expect(cleanOcrFromPage(createDocInfo(), 9)).rejects.toThrow('Clean OCR page 9 is outside this 4-page PDF.');
  });
});
