import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

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
}

export const loadPdfDocument = async (file: File, docId: string): Promise<PdfDocumentInfo> => {
  const arrayBuffer = await file.arrayBuffer();
  
  // Create a loading task
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdfjsDoc = await loadingTask.promise;

  return {
    id: docId,
    file,
    name: file.name,
    pdfjsDoc,
    pageCount: pdfjsDoc.numPages
  };
};

export const renderPageToCanvas = async (
  pdfjsDoc: pdfjsLib.PDFDocumentProxy, 
  pageNumber: number, 
  canvas: HTMLCanvasElement, 
  scale: number = 1.0
) => {
  const page = await pdfjsDoc.getPage(pageNumber);
  
  const viewport = page.getViewport({ scale });
  
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  const renderContext = {
    canvasContext: canvas.getContext('2d')!,
    canvas,
    viewport: viewport
  };
  
  await page.render(renderContext).promise;
  return { width: viewport.width, height: viewport.height };
};

export const renderPageToDataUrl = async (
  pdfjsDoc: pdfjsLib.PDFDocumentProxy, 
  pageNumber: number, 
  scale: number = 0.2
): Promise<string> => {
  const page = await pdfjsDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  const renderContext = {
    canvasContext: canvas.getContext('2d')!,
    canvas,
    viewport: viewport
  };
  
  await page.render(renderContext).promise;
  return canvas.toDataURL();
};

import { PDFDocument, rgb } from 'pdf-lib';
import { type TextAnnotation } from '../context/PdfContext';

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

    // Apply annotations for this page
    const pageAnns = annotations.filter(a => a.pageId === pageInfo.id);
    const { height } = copiedPage.getSize();

    for (const ann of pageAnns) {
      // pdf-lib origin is bottom-left. Canvas origin is top-left.
      // And we need to adjust for the scaling we used in the viewer.
      
      const pdfX = ann.x / scale;
      // Subtracting the approx font height so the baseline matches roughly
      const pdfY = height - (ann.y / scale) - (ann.fontSize / scale);

      // Parse rgb from hex
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
