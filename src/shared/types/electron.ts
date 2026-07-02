import { type GlyphDiagnosticsReport, type GlyphRepairReport } from './glyph';

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

export type GlyphRepairErrorCode = GlyphDiagnosticsErrorCode;

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

export interface GlyphRepairInput extends GlyphDiagnosticsInput {
  replaceExistingToUnicode?: boolean;
  ocrText?: string;
}

export type GlyphDiagnosticsResult =
  | { ok: true; report: GlyphDiagnosticsReport }
  | { ok: false; error: { code: GlyphDiagnosticsErrorCode; message: string } };

export type GlyphRepairResult =
  | { ok: true; pdfBytes: Uint8Array; report: GlyphRepairReport }
  | { ok: false; error: { code: GlyphRepairErrorCode; message: string } };

export interface AntigravityPdfBridge {
  cleanOcrPage(input: CleanOcrInput): Promise<CleanOcrResult>;
  diagnoseGlyphText(input: GlyphDiagnosticsInput): Promise<GlyphDiagnosticsResult>;
  repairGlyphText(input: GlyphRepairInput): Promise<GlyphRepairResult>;
}

declare global {
  interface Window {
    antigravityPdf?: AntigravityPdfBridge;
  }
}
