import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, PDFOperator, PDFOperatorNames, PDFNumber } from 'pdf-lib';
import { type TextAnnotation } from '../../shared/types/pdf';
import { analyzeTextLayerHealth, type TextLayerHealthStatus } from './textLayerHealth';

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
  textHealth: TextLayerHealthStatus;
  textHealthReasons: string[];
  textItemCount: number;
  textSample: string;
}

export const isAnalysisOcrCandidate = (analysis: PageAnalysis | null | undefined): boolean => (
  analysis?.isScanned === true ||
  analysis?.textHealth === 'suspectEncoding' ||
  analysis?.textHealth === 'unsupported'
);

export const isNativeHiddenOcrAnalysis = (analysis: PageAnalysis | null | undefined): boolean => (
  analysis?.textHealth === 'hiddenOcr'
);

const HIDDEN_TEXT_RATIO_THRESHOLD = 0.8;

const textShowOperators = new Set<number>([
  pdfjsLib.OPS.showText,
  pdfjsLib.OPS.showSpacedText,
  pdfjsLib.OPS.nextLineShowText,
  pdfjsLib.OPS.nextLineSetSpacingShowText,
].filter((op): op is number => typeof op === 'number'));

const detectHiddenTextOperatorRatio = async (page: pdfjsLib.PDFPageProxy): Promise<number | null> => {
  try {
    const operatorList = await page.getOperatorList();
    let textRenderingMode = 0;
    const textRenderingModeStack: number[] = [];
    let textShowCount = 0;
    let hiddenTextShowCount = 0;

    operatorList.fnArray.forEach((fn, index) => {
      if (fn === pdfjsLib.OPS.save) {
        textRenderingModeStack.push(textRenderingMode);
        return;
      }

      if (fn === pdfjsLib.OPS.restore) {
        textRenderingMode = textRenderingModeStack.pop() ?? 0;
        return;
      }

      if (fn === pdfjsLib.OPS.setTextRenderingMode) {
        const args = operatorList.argsArray[index] as unknown;
        const nextMode = Array.isArray(args) ? Number(args[0]) : Number(args);
        if (Number.isFinite(nextMode)) {
          textRenderingMode = nextMode;
        }
        return;
      }

      if (!textShowOperators.has(fn)) return;
      textShowCount += 1;
      if (textRenderingMode === 3) {
        hiddenTextShowCount += 1;
      }
    });

    return textShowCount === 0 ? null : hiddenTextShowCount / textShowCount;
  } catch (err) {
    console.warn('PDF operator analysis failed', err);
    return null;
  }
};

export const analyzePage = async (page: pdfjsLib.PDFPageProxy): Promise<PageAnalysis> => {
  try {
    const textContent = await page.getTextContent();
    const baseHealth = analyzeTextLayerHealth(textContent);
    const operatorHiddenTextRatio = await detectHiddenTextOperatorRatio(page);
    const health = (
      baseHealth.status !== 'imageOnly' &&
      operatorHiddenTextRatio !== null &&
      operatorHiddenTextRatio >= HIDDEN_TEXT_RATIO_THRESHOLD
    ) ? {
      ...baseHealth,
      status: 'hiddenOcr' as const,
      reasons: Array.from(new Set([...baseHealth.reasons, 'mostly-hidden-text-operators'])),
      hiddenTextRatio: Math.max(baseHealth.hiddenTextRatio, operatorHiddenTextRatio),
    } : baseHealth;
    const hasText = health.itemCount > 0 && health.status !== 'imageOnly';
    const hasOCR = health.status === 'hiddenOcr';
    const isScanned = health.status === 'imageOnly' || health.status === 'sparse';

    return {
      hasText,
      hasOCR,
      isScanned,
      textHealth: health.status,
      textHealthReasons: health.reasons,
      textItemCount: health.itemCount,
      textSample: health.sample,
    };
  } catch (err) {
    console.warn('PDF text analysis failed', err);
    return {
      hasText: false,
      hasOCR: false,
      isScanned: false,
      textHealth: 'unsupported',
      textHealthReasons: ['text-extraction-failed'],
      textItemCount: 0,
      textSample: '',
    };
  }
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

export function createTextRenderingModeOperator(mode: number): PDFOperator {
  return PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [PDFNumber.of(mode)]);
}

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
      copiedPage.pushOperators(createTextRenderingModeOperator(3));

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
      copiedPage.pushOperators(createTextRenderingModeOperator(0));
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

export const cleanOcrUnavailableMessage = 'Native Clean OCR is unavailable in this environment.';

export const cleanOcrFromPage = async (docInfo: PdfDocumentInfo, pageNumber: number): Promise<Blob> => {
  if (!window.antigravityPdf?.cleanOcrPage) {
    throw new Error(cleanOcrUnavailableMessage);
  }

  const arrayBuffer = await docInfo.file.arrayBuffer();
  const pdfBytes = new Uint8Array(arrayBuffer);

  const result = await window.antigravityPdf.cleanOcrPage({ pdfBytes, pageNumber });
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  const outputBytes = new Uint8Array(result.pdfBytes);
  const outputBuffer = outputBytes.buffer.slice(
    outputBytes.byteOffset,
    outputBytes.byteOffset + outputBytes.byteLength,
  );

  return new Blob([outputBuffer], { type: 'application/pdf' });
};
