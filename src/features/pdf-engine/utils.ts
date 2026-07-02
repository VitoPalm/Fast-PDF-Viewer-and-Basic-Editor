import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, PDFOperator, PDFOperatorNames, PDFName } from 'pdf-lib';
import { type TextAnnotation } from '../../shared/types/pdf';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface PdfDocumentInfo {
  id: string; // Unique ID for this document upload
  file: File;
  name: string;
  pdfjsDoc: pdfjsLib.PDFDocumentProxy;
  pageCount: number;
}

export interface PdfPageInfo {
  id: string; // Unique ID for this specific page (for drag and drop)
  docId: string; // The ID of the document it belongs to
  originalPageIndex: number; // 1-indexed
  thumbnailDataUrl?: string; // Cache the thumbnail
  analysisStatus?: 'pending' | 'running' | 'complete' | 'failed';
  analysisError?: string;
  ocrStatus?: 'idle' | 'queued' | 'running' | 'complete' | 'failed' | 'skipped';
  ocrError?: string;
  ocrResult?: {
    items: Array<{ str: string, transform: number[], width: number, height: number }>;
  };
  analysis?: PageAnalysis;
}

export interface PageAnalysis {
  hasText: boolean;
  hasOCR: boolean; // Detected invisible text layer
  isScanned: boolean;
}

export const analyzePage = async (page: pdfjsLib.PDFPageProxy): Promise<PageAnalysis> => {
  const textContent = await page.getTextContent();
  const hasText = textContent.items.length > 0;

  const hasRenderingMode = (item: unknown): item is { renderingMode: number } => (
    typeof item === 'object' &&
    item !== null &&
    'renderingMode' in item &&
    typeof (item as { renderingMode?: unknown }).renderingMode === 'number'
  );

  // OCR detection: check if all text is hidden (renderingMode 3)
  const hasOCR = hasText && textContent.items.some(item => hasRenderingMode(item) && item.renderingMode === 3);

  // If there's no text, or only very little text compared to what might be expected, it's likely scanned.
  const isScanned = !hasText || (hasText && textContent.items.length < 5);

  return { hasText, hasOCR, isScanned };
};

export const analyzeDocument = async (pdfjsDoc: pdfjsLib.PDFDocumentProxy): Promise<PageAnalysis[]> => {
  const results: PageAnalysis[] = [];
  for (let i = 1; i <= pdfjsDoc.numPages; i++) {
    const page = await pdfjsDoc.getPage(i);
    results.push(await analyzePage(page));
  }
  return results;
};

export const loadPdfDocument = async (file: File, docId: string): Promise<PdfDocumentInfo> => {
  const arrayBuffer = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`
  });
  const pdfjsDoc = await loadingTask.promise;

  return {
    id: docId,
    file,
    name: file.name,
    pdfjsDoc,
    pageCount: pdfjsDoc.numPages
  };
};

export const exportModifiedPdf = async (
  documents: Record<string, PdfDocumentInfo>,
  pages: PdfPageInfo[],
  annotations: TextAnnotation[],
  scale: number = 1.5
): Promise<Blob> => {
  const newPdf = await PDFDocument.create();

  // We need to keep track of loaded src documents to avoid reloading the same file multiple times
  const loadedSrcDocs: Record<string, PDFDocument> = {};

  for (const pageInfo of pages) {
    const docInfo = documents[pageInfo.docId];
    if (!docInfo) continue;

    if (!loadedSrcDocs[pageInfo.docId]) {
      const arrayBuffer = await docInfo.file.arrayBuffer();
      loadedSrcDocs[pageInfo.docId] = await PDFDocument.load(arrayBuffer);
    }

    const srcDoc = loadedSrcDocs[pageInfo.docId];

    // Copy the specific page (pdf-lib uses 0-indexed pages)
    const [copiedPage] = await newPdf.copyPages(srcDoc, [pageInfo.originalPageIndex - 1]);
    newPdf.addPage(copiedPage);

    const { height } = copiedPage.getSize();

    // 1. Embed OCR text if present (invisible)
    // Note: OCR items are already normalized to scale 1.0 in handleOCR,
    // so we use coordinates directly without dividing by scale.
    if (pageInfo.ocrResult) {
      // Set rendering mode to invisible (3)
      copiedPage.pushOperators(
        PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [PDFName.of('3')])
      );

      for (const item of pageInfo.ocrResult.items) {
        const x = item.transform[4];
        const y = height - item.transform[5] - item.height;

        copiedPage.drawText(item.str, {
          x,
          y,
          size: item.height,
        });
      }

      // Reset rendering mode to fill (0)
      copiedPage.pushOperators(
        PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [PDFName.of('0')])
      );
    }

    // 2. Apply user annotations
    const pageAnns = annotations.filter(a => a.pageId === pageInfo.id);
    for (const ann of pageAnns) {
      const pdfX = ann.x / scale;
      const pdfY = height - (ann.y / scale) - (ann.fontSize / scale);

      let r = 0, g = 0, b = 0;
      if (ann.color.startsWith('#')) {
        const hex = ann.color.replace('#', '');
        r = parseInt(hex.substring(0, 2), 16) / 255;
        g = parseInt(hex.substring(2, 4), 16) / 255;
        b = parseInt(hex.substring(4, 6), 16) / 255;
      }

      copiedPage.drawText(ann.text, {
        x: pdfX,
        y: pdfY,
        size: ann.fontSize / scale,
        color: rgb(r, g, b),
      });
    }
  }

  const pdfBytes = await newPdf.save();
  return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
};

export const cleanOcrFromPage = async (docInfo: PdfDocumentInfo, pageIndex: number): Promise<Blob> => {
  const arrayBuffer = await docInfo.file.arrayBuffer();
  const pdfBytes = new Uint8Array(arrayBuffer);

  // Hand off to the Node.js backend to run Ghostscript
  const newPdfBytes = await window.ipcRenderer.invoke<Uint8Array>('convert-text-to-paths', pdfBytes, pageIndex);
  const outputBytes = new Uint8Array(newPdfBytes.byteLength);
  outputBytes.set(newPdfBytes);

  return new Blob([outputBytes.buffer], { type: 'application/pdf' });
};
