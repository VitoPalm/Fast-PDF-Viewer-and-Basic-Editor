import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { type PdfDocumentInfo, type PdfPageInfo, loadPdfDocument } from '../utils/pdf';

export interface TextAnnotation {
  id: string;
  pageId: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

interface PdfContextType {
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
  // Multi-select
  togglePageSelection: (id: string) => void;
  selectPageRange: (startIndex: number, endIndex: number) => void;
  selectPagesByNumbers: (pageNumbers: number[]) => void;
  selectAll: () => void;
  clearSelection: () => void;
  invertSelection: () => void;
}

const PdfContext = createContext<PdfContextType | undefined>(undefined);

export const PdfProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [documents, setDocuments] = useState<Record<string, PdfDocumentInfo>>({});
  const [pages, setPages] = useState<PdfPageInfo[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [annotations, setAnnotations] = useState<TextAnnotation[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const addAnnotation = useCallback((annot: TextAnnotation) => {
    setAnnotations(prev => [...prev, annot]);
  }, []);

  const updateAnnotation = useCallback((id: string, updates: Partial<TextAnnotation>) => {
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
  }, []);

  const addFiles = useCallback(async (files: File[]) => {
    setIsLoading(true);
    try {
      const newDocs: Record<string, PdfDocumentInfo> = {};
      const newPages: PdfPageInfo[] = [];

      for (const file of files) {
        const docId = uuidv4();
        const docInfo = await loadPdfDocument(file, docId);
        newDocs[docId] = docInfo;

        for (let i = 1; i <= docInfo.pageCount; i++) {
          const pageId = uuidv4();
          newPages.push({
            id: pageId,
            docId,
            originalPageIndex: i,
          });
        }
      }

      setDocuments(prev => ({ ...prev, ...newDocs }));
      setPages(prev => {
        const updated = [...prev, ...newPages];
        if (updated.length > 0 && !activePageId) {
          setActivePageId(updated[0].id);
        }
        return updated;
      });
    } catch (err) {
      console.error("Error loading PDFs", err);
      alert("Error loading PDF files.");
    } finally {
      setIsLoading(false);
    }
  }, [activePageId]);

  const removePage = useCallback((id: string) => {
    setPages(prev => {
      const updated = prev.filter(p => p.id !== id);
      if (activePageId === id) {
        setActivePageId(updated.length > 0 ? updated[0].id : null);
      }
      return updated;
    });
    setSelectedPageIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [activePageId]);

  /** Remove multiple pages at once */
  const removePages = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setPages(prev => {
      const updated = prev.filter(p => !idSet.has(p.id));
      if (activePageId && idSet.has(activePageId)) {
        setActivePageId(updated.length > 0 ? updated[0].id : null);
      }
      return updated;
    });
    setSelectedPageIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
  }, [activePageId]);

  /** Keep only the specified pages (in their current order), discard everything else */
  const extractPages = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setPages(prev => {
      const updated = prev.filter(p => idSet.has(p.id));
      if (activePageId && !idSet.has(activePageId)) {
        setActivePageId(updated.length > 0 ? updated[0].id : null);
      }
      return updated;
    });
    setSelectedPageIds(new Set());
  }, [activePageId]);

  const clearAll = useCallback(() => {
    setDocuments({});
    setPages([]);
    setActivePageId(null);
    setSelectedPageIds(new Set());
  }, []);

  // ---- Multi-select ----
  const togglePageSelection = useCallback((id: string) => {
    setSelectedPageIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectPageRange = useCallback((startIndex: number, endIndex: number) => {
    setPages(prev => {
      const lo = Math.min(startIndex, endIndex);
      const hi = Math.max(startIndex, endIndex);
      const ids = prev.slice(lo, hi + 1).map(p => p.id);
      setSelectedPageIds(prevSel => {
        const next = new Set(prevSel);
        ids.forEach(id => next.add(id));
        return next;
      });
      return prev;
    });
  }, []);

  /** Select pages by their 1-indexed position in the pages array */
  const selectPagesByNumbers = useCallback((pageNumbers: number[]) => {
    setPages(prev => {
      const newSel = new Set<string>();
      for (const num of pageNumbers) {
        const page = prev[num - 1]; // 1-indexed → 0-indexed
        if (page) newSel.add(page.id);
      }
      setSelectedPageIds(newSel);
      return prev;
    });
  }, []);

  const selectAll = useCallback(() => {
    setPages(prev => {
      setSelectedPageIds(new Set(prev.map(p => p.id)));
      return prev;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPageIds(new Set());
  }, []);

  const invertSelection = useCallback(() => {
    setPages(prev => {
      setSelectedPageIds(prevSel => {
        const next = new Set<string>();
        prev.forEach(p => {
          if (!prevSel.has(p.id)) next.add(p.id);
        });
        return next;
      });
      return prev;
    });
  }, []);

  return (
    <PdfContext.Provider value={{
      documents, pages, activePageId, selectedPageIds, annotations, isLoading,
      addFiles, setPages, setActivePageId, removePage, removePages, extractPages, clearAll,
      addAnnotation, updateAnnotation, removeAnnotation,
      togglePageSelection, selectPageRange, selectPagesByNumbers,
      selectAll, clearSelection, invertSelection
    }}>
      {children}
    </PdfContext.Provider>
  );
};

export const usePdf = () => {
  const context = useContext(PdfContext);
  if (!context) throw new Error("usePdf must be used within PdfProvider");
  return context;
};
