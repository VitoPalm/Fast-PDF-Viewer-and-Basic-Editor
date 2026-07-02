import { type GlyphDiagnosticsReport } from './glyph';

export type CleanOcrErrorCode =
  | 'invalid-input'
  | 'page-out-of-range'
  | 'ghostscript-failed'
  | 'unavailable';

export type GlyphDiagnosticsErrorCode =
  | 'invalid-input'
  | 'page-out-of-range'
  | 'sidecar-unavailable'
  | 'sidecar-failed'
  | 'parse-failed';

export interface CleanOcrInput {
  pdfBytes: Uint8Array;
  pageNumber: number;
}

export type CleanOcrResult =
  | { ok: true; pdfBytes: Uint8Array }
  | { ok: false; error: { code: CleanOcrErrorCode; message: string } };

export interface GlyphDiagnosticsInput {
  pdfBytes: Uint8Array;
  pageNumbers: number[];
}

export type GlyphDiagnosticsResult =
  | { ok: true; report: GlyphDiagnosticsReport }
  | { ok: false; error: { code: GlyphDiagnosticsErrorCode; message: string } };

export interface AntigravityPdfBridge {
  cleanOcrPage(input: CleanOcrInput): Promise<CleanOcrResult>;
  diagnoseGlyphText(input: GlyphDiagnosticsInput): Promise<GlyphDiagnosticsResult>;
}

declare global {
  interface Window {
    antigravityPdf?: AntigravityPdfBridge;
  }
}
