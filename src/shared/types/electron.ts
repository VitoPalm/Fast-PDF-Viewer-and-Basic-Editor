export type CleanOcrErrorCode =
  | 'invalid-input'
  | 'page-out-of-range'
  | 'ghostscript-failed'
  | 'unavailable';

export interface CleanOcrInput {
  pdfBytes: Uint8Array;
  pageNumber: number;
}

export type CleanOcrResult =
  | { ok: true; pdfBytes: Uint8Array }
  | { ok: false; error: { code: CleanOcrErrorCode; message: string } };

export interface AntigravityPdfBridge {
  cleanOcrPage(input: CleanOcrInput): Promise<CleanOcrResult>;
}

declare global {
  interface Window {
    antigravityPdf?: AntigravityPdfBridge;
  }
}
