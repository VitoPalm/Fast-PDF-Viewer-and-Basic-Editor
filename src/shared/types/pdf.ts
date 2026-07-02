import React from 'react';
import { type PdfDocumentInfo, type PdfPageInfo } from '../../features/pdf-engine/utils';
import { type GlyphJob } from '../../context/glyphRepairJob';
import { type ImportJob } from '../../context/importJob';
import { type OcrJob, type OcrJobOptions } from '../../context/ocrJob';

export interface TextAnnotation {
  id: string;
  pageId: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

export interface PendingPageUndo {
  description: string;
  expiresAt: number;
}

export interface PageMutationConfirmOptions {
  title?: string;
  nextRangeInput?: string;
}

export interface PdfContextType {
  documents: Record<string, PdfDocumentInfo>;
  pages: PdfPageInfo[];
  activePageId: string | null;
  selectedPageIds: Set<string>;
  annotations: TextAnnotation[];
  isLoading: boolean;
  importJob: ImportJob;
  ocrJob: OcrJob;
  glyphJob: GlyphJob;
  addFiles: (files: File[]) => Promise<void>;
  cancelImport: () => void;
  startGlyphDiagnostics: (pageIds: string[]) => Promise<void>;
  cancelGlyphDiagnostics: () => void;
  startOcr: (pageIds: string[], options: OcrJobOptions) => Promise<void>;
  cancelOcr: () => void;
  retryFailedOcr: () => Promise<void>;
  setPages: React.Dispatch<React.SetStateAction<PdfPageInfo[]>>;
  setActivePageId: (id: string | null) => void;
  replacePage: (pageId: string, newBlob: Blob) => Promise<void>;
  removePage: (id: string) => void;
  removePages: (ids: string[]) => void;
  extractPages: (ids: string[]) => void;
  clearAll: () => void;
  removePageWithUndo: (id: string) => void;
  removePagesWithUndo: (ids: string[], options?: PageMutationConfirmOptions) => void;
  keepOnlyPagesWithUndo: (ids: string[], options?: PageMutationConfirmOptions) => void;
  clearAllWithUndo: () => void;
  reorderPage: (sourceIndex: number, destinationIndex: number) => void;
  reorderSelectedPages: (draggedId: string, destinationIndex: number) => void;
  pendingUndo: PendingPageUndo | null;
  undoLastPageMutation: () => void;
  addAnnotation: (annot: TextAnnotation) => void;
  updateAnnotation: (id: string, updates: Partial<TextAnnotation>) => void;
  removeAnnotation: (id: string) => void;
  togglePageSelection: (id: string) => void;
  selectPageRange: (startIndex: number, endIndex: number) => void;
  selectPagesByNumbers: (pageNumbers: number[]) => void;
  selectAll: () => void;
  clearSelection: () => void;
  invertSelection: () => void;
  rangeInput: string;
  setRangeInput: (val: string) => void;
}
