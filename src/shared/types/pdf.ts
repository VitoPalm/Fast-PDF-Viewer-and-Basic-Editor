import React from 'react';
import { type PdfDocumentInfo, type PdfPageInfo } from '../../features/pdf-engine/utils';
import { type ImportJob } from '../../context/importJob';

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

export interface PdfContextType {
  documents: Record<string, PdfDocumentInfo>;
  pages: PdfPageInfo[];
  activePageId: string | null;
  selectedPageIds: Set<string>;
  annotations: TextAnnotation[];
  isLoading: boolean;
  importJob: ImportJob;
  addFiles: (files: File[]) => Promise<void>;
  cancelImport: () => void;
  setPages: React.Dispatch<React.SetStateAction<PdfPageInfo[]>>;
  setActivePageId: (id: string | null) => void;
  replacePage: (pageId: string, newBlob: Blob) => Promise<void>;
  removePage: (id: string) => void;
  removePages: (ids: string[]) => void;
  extractPages: (ids: string[]) => void;
  clearAll: () => void;
  removePageWithUndo: (id: string) => void;
  removePagesWithUndo: (ids: string[]) => void;
  keepOnlyPagesWithUndo: (ids: string[]) => void;
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
  ocrQueue: string[];
  setOcrQueue: React.Dispatch<React.SetStateAction<string[]>>;
}
