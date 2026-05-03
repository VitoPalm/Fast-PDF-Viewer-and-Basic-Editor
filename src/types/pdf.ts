import { type PdfDocumentInfo, type PdfPageInfo } from '../utils/pdf';

export interface TextAnnotation {
  id: string;
  pageId: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

export interface PdfContextType {
  documents: Record<string, PdfDocumentInfo>;
  pages: PdfPageInfo[];
  activePageId: string | null;
  selectedPageIds: Set<string>;
  annotations: TextAnnotation[];
  isLoading: boolean;
  addFiles: (files: File[]) => Promise<void>;
  setPages: React.Dispatch<React.SetStateAction<PdfPageInfo[]>>;
  setActivePageId: (id: string | null) => void;
  removePage: (id: string) => void;
  removePages: (ids: string[]) => void;
  extractPages: (ids: string[]) => void;
  clearAll: () => void;
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
