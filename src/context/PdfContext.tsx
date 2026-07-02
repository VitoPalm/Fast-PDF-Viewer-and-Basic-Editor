import React, { useState, useCallback, type ReactNode, useEffect, useRef, useReducer } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { type PdfDocumentInfo, type PdfPageInfo, loadPdfDocument, analyzePage } from '../features/pdf-engine/utils';
import { type TextAnnotation } from '../shared/types/pdf';
import { OCRService } from '../features/pdf-engine/ocrService';
import {
  applyPageAnalysisUpdateForJob,
  createIdleImportJob,
  createPagePlaceholders,
  importJobReducer,
  isImportJobBusy,
  orderImportedPagesForAnalysis,
} from './importJob';
import {
  getNextActivePageId,
  keepOnlyPagesById,
  removePagesById,
  reorderPage as reorderPageList,
  reorderSelectedPageBlock,
} from '../features/page-operations/pageOperations';
import { PdfContext } from './PdfContextDef';
import './PdfContext.css';

const UNDO_TIMEOUT_MS = 8000;

interface PageStateSnapshot {
  documents: Record<string, PdfDocumentInfo>;
  pages: PdfPageInfo[];
  activePageId: string | null;
  selectedPageIds: Set<string>;
  rangeInput: string;
}

interface PendingUndoState {
  description: string;
  expiresAt: number;
  snapshot: PageStateSnapshot;
}

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

interface PageMutationResult {
  pages: PdfPageInfo[];
  activePageId: string | null;
  selectedPageIds: Set<string>;
  rangeInput: string;
  documents?: Record<string, PdfDocumentInfo>;
}

export const PdfProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [documents, setDocuments] = useState<Record<string, PdfDocumentInfo>>({});
  const [pages, setPages] = useState<PdfPageInfo[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [annotations, setAnnotations] = useState<TextAnnotation[]>([]);
  const [rangeInput, setRangeInput] = useState('');
  const [ocrQueue, setOcrQueue] = useState<string[]>([]);
  const [importJob, dispatchImportJob] = useReducer(importJobReducer, createIdleImportJob());
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [pendingUndoState, setPendingUndoState] = useState<PendingUndoState | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const activePageIdRef = useRef<string | null>(activePageId);
  const currentImportJobIdRef = useRef(0);

  const isLoading = isImportJobBusy(importJob);

  useEffect(() => {
    // Pre-initialize OCR engine in the background
    OCRService.preInitialize().catch(err => console.error("OCR pre-init failed", err));
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    };
  }, []);

  useEffect(() => {
    activePageIdRef.current = activePageId;
  }, [activePageId]);

  const isImportJobCurrent = useCallback((jobId: number) => (
    currentImportJobIdRef.current === jobId
  ), []);

  const getErrorMessage = useCallback((err: unknown): string => (
    err instanceof Error ? err.message : String(err)
  ), []);

  const cancelImport = useCallback(() => {
    const cancelledJobId = currentImportJobIdRef.current;
    currentImportJobIdRef.current += 1;

    if (cancelledJobId > 0) {
      dispatchImportJob({ type: 'cancelled', jobId: cancelledJobId });
    }
  }, []);

  const clearUndoTimer = useCallback(() => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  const startUndoTimer = useCallback((nextUndo: PendingUndoState) => {
    clearUndoTimer();
    setPendingUndoState(nextUndo);
    undoTimerRef.current = window.setTimeout(() => {
      setPendingUndoState(null);
      undoTimerRef.current = null;
    }, UNDO_TIMEOUT_MS);
  }, [clearUndoTimer]);

  const captureSnapshot = useCallback((): PageStateSnapshot => ({
    documents,
    pages,
    activePageId,
    selectedPageIds: new Set(selectedPageIds),
    rangeInput,
  }), [activePageId, documents, pages, rangeInput, selectedPageIds]);

  const applyMutationResult = useCallback((result: PageMutationResult) => {
    if (result.documents) setDocuments(result.documents);
    setPages(result.pages);
    setActivePageId(result.activePageId);
    setSelectedPageIds(result.selectedPageIds);
    setRangeInput(result.rangeInput);
  }, []);

  const requestConfirmedPageMutation = useCallback((
    request: Omit<ConfirmRequest, 'onConfirm'> & { undoDescription: string; beforeApply?: () => void },
    buildResult: (snapshot: PageStateSnapshot) => PageMutationResult | null,
  ) => {
    const snapshot = captureSnapshot();
    const result = buildResult(snapshot);
    if (!result) return;

    setConfirmRequest({
      title: request.title,
      message: request.message,
      confirmLabel: request.confirmLabel,
      danger: request.danger,
      onConfirm: () => {
        setConfirmRequest(null);
        request.beforeApply?.();
        applyMutationResult(result);
        startUndoTimer({
          description: request.undoDescription,
          expiresAt: Date.now() + UNDO_TIMEOUT_MS,
          snapshot,
        });
      },
    });
  }, [applyMutationResult, captureSnapshot, startUndoTimer]);

  const commitImmediatePageMutation = useCallback((
    undoDescription: string,
    buildResult: (snapshot: PageStateSnapshot) => PageMutationResult | null,
  ) => {
    const snapshot = captureSnapshot();
    const result = buildResult(snapshot);
    if (!result) return;

    applyMutationResult(result);
    startUndoTimer({
      description: undoDescription,
      expiresAt: Date.now() + UNDO_TIMEOUT_MS,
      snapshot,
    });
  }, [applyMutationResult, captureSnapshot, startUndoTimer]);

  const undoLastPageMutation = useCallback(() => {
    if (!pendingUndoState) return;
    clearUndoTimer();
    setDocuments(pendingUndoState.snapshot.documents);
    setPages(pendingUndoState.snapshot.pages);
    setActivePageId(pendingUndoState.snapshot.activePageId);
    setSelectedPageIds(new Set(pendingUndoState.snapshot.selectedPageIds));
    setRangeInput(pendingUndoState.snapshot.rangeInput);
    setPendingUndoState(null);
  }, [clearUndoTimer, pendingUndoState]);

  const addAnnotation = useCallback((annot: TextAnnotation) => {
    setAnnotations(prev => [...prev, annot]);
  }, []);

  const updateAnnotation = useCallback((id: string, updates: Partial<TextAnnotation>) => {
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
  }, []);

  const updateAnalysisForImportJob = useCallback((
    jobId: number,
    pageId: string,
    status: PdfPageInfo['analysisStatus'],
    analysis?: PdfPageInfo['analysis'],
    error?: string,
  ) => {
    setPages(prev => applyPageAnalysisUpdateForJob(prev, {
      currentJobId: currentImportJobIdRef.current,
      jobId,
      pageId,
      status,
      analysis,
      error,
    }));
  }, []);

  const analyzeImportedPages = useCallback(async (
    jobId: number,
    importedPages: PdfPageInfo[],
    docsForJob: Record<string, PdfDocumentInfo>,
    activePageForPriority: string | null,
  ) => {
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    if (!isImportJobCurrent(jobId)) return;

    dispatchImportJob({ type: 'analysis-started', jobId });

    const analysisQueue = orderImportedPagesForAnalysis(importedPages, activePageForPriority);
    for (const pageInfo of analysisQueue) {
      if (!isImportJobCurrent(jobId)) return;

      updateAnalysisForImportJob(jobId, pageInfo.id, 'running');

      try {
        const docInfo = docsForJob[pageInfo.docId];
        if (!docInfo) throw new Error(`Missing PDF document for page ${pageInfo.originalPageIndex}`);

        const pageProxy = await docInfo.pdfjsDoc.getPage(pageInfo.originalPageIndex);
        const analysis = await analyzePage(pageProxy);
        if (!isImportJobCurrent(jobId)) return;

        updateAnalysisForImportJob(jobId, pageInfo.id, 'complete', analysis);
      } catch (err) {
        if (!isImportJobCurrent(jobId)) return;

        console.error('Page analysis failed', err);
        updateAnalysisForImportJob(jobId, pageInfo.id, 'failed', undefined, getErrorMessage(err));
      }

      if (!isImportJobCurrent(jobId)) return;
      dispatchImportJob({ type: 'page-analyzed', jobId });
    }

    if (isImportJobCurrent(jobId)) {
      dispatchImportJob({ type: 'completed', jobId });
    }
  }, [getErrorMessage, isImportJobCurrent, updateAnalysisForImportJob]);

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const jobId = currentImportJobIdRef.current + 1;
    currentImportJobIdRef.current = jobId;
    dispatchImportJob({ type: 'started', jobId, filesTotal: files.length });

    const docsForJob: Record<string, PdfDocumentInfo> = {};
    const importedPages: PdfPageInfo[] = [];
    let activePageForPriority = activePageIdRef.current;

    try {
      for (const file of files) {
        if (!isImportJobCurrent(jobId)) return;

        dispatchImportJob({ type: 'loading-file', jobId, fileName: file.name });

        const docId = uuidv4();
        const docInfo = await loadPdfDocument(file, docId);
        if (!isImportJobCurrent(jobId)) return;

        docsForJob[docId] = docInfo;
        dispatchImportJob({
          type: 'pages-discovered',
          jobId,
          fileName: file.name,
          pageCount: docInfo.pageCount,
        });

        const placeholders = createPagePlaceholders(docId, docInfo.pageCount, uuidv4);
        importedPages.push(...placeholders);

        setDocuments(prev => ({ ...prev, [docId]: docInfo }));
        setPages(prev => [...prev, ...placeholders]);

        const firstPlaceholder = placeholders[0];
        if (!activePageForPriority && firstPlaceholder) {
          activePageForPriority = firstPlaceholder.id;
        }
        if (firstPlaceholder) {
          setActivePageId(prev => prev ?? firstPlaceholder.id);
        }

        dispatchImportJob({ type: 'pages-instantiated', jobId, count: placeholders.length });
        dispatchImportJob({ type: 'file-done', jobId });
      }

      if (!isImportJobCurrent(jobId)) return;
      void analyzeImportedPages(jobId, importedPages, docsForJob, activePageForPriority);
    } catch (err) {
      if (!isImportJobCurrent(jobId)) return;

      console.error("Error loading PDFs", err);
      dispatchImportJob({ type: 'failed', jobId, error: getErrorMessage(err) });
    }
  }, [analyzeImportedPages, getErrorMessage, isImportJobCurrent]);

  const replacePage = useCallback(async (pageId: string, newBlob: Blob) => {
    try {
      const docId = uuidv4();
      const file = new File([newBlob], "cleaned_page.pdf", { type: "application/pdf" });
      const docInfo = await loadPdfDocument(file, docId);
      const pageProxy = await docInfo.pdfjsDoc.getPage(1);
      const analysis = await analyzePage(pageProxy);

      setDocuments(prev => ({ ...prev, [docId]: docInfo }));
      setPages(prev => prev.map(p => p.id === pageId ? {
        ...p,
        docId,
        originalPageIndex: 1,
        analysis,
        analysisStatus: 'complete',
        analysisError: undefined,
        ocrResult: undefined,
      } : p));
    } catch (err) {
      console.error("Error replacing page", err);
    }
  }, []);

  const removePage = useCallback((id: string) => {
    setPages(prev => {
      const updated = removePagesById(prev, [id]);
      if (activePageId === id) {
        setActivePageId(getNextActivePageId(prev, updated, activePageId));
      }
      return updated;
    });
    setSelectedPageIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [activePageId]);

  const removePages = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setPages(prev => {
      const updated = removePagesById(prev, idSet);
      if (activePageId && idSet.has(activePageId)) {
        setActivePageId(getNextActivePageId(prev, updated, activePageId));
      }
      return updated;
    });
    setSelectedPageIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
  }, [activePageId]);

  const extractPages = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setPages(prev => {
      const updated = keepOnlyPagesById(prev, idSet);
      if (activePageId && !idSet.has(activePageId)) {
        setActivePageId(getNextActivePageId(prev, updated, activePageId));
      }
      return updated;
    });
    setSelectedPageIds(new Set());
  }, [activePageId]);

  const clearAll = useCallback(() => {
    cancelImport();
    setDocuments({});
    setPages([]);
    setActivePageId(null);
    setSelectedPageIds(new Set());
    setRangeInput('');
  }, [cancelImport]);

  const removePageWithUndo = useCallback((id: string) => {
    const pageIndex = pages.findIndex(page => page.id === id);
    if (pageIndex < 0) return;

    requestConfirmedPageMutation({
      title: 'Remove page?',
      message: `Remove page ${pageIndex + 1}? You can undo this for a few seconds.`,
      confirmLabel: 'Remove',
      danger: true,
      undoDescription: `Removed page ${pageIndex + 1}`,
    }, snapshot => {
      const nextPages = removePagesById(snapshot.pages, [id]);
      if (nextPages.length === snapshot.pages.length) return null;
      const nextSelected = new Set(snapshot.selectedPageIds);
      nextSelected.delete(id);
      return {
        pages: nextPages,
        activePageId: getNextActivePageId(snapshot.pages, nextPages, snapshot.activePageId),
        selectedPageIds: nextSelected,
        rangeInput: snapshot.rangeInput,
      };
    });
  }, [pages, requestConfirmedPageMutation]);

  const removePagesWithUndo = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    const affectedCount = pages.filter(page => idSet.has(page.id)).length;
    if (affectedCount === 0) return;

    requestConfirmedPageMutation({
      title: 'Remove selected pages?',
      message: `Remove ${affectedCount} page${affectedCount === 1 ? '' : 's'}? You can undo this for a few seconds.`,
      confirmLabel: 'Remove',
      danger: true,
      undoDescription: `Removed ${affectedCount} page${affectedCount === 1 ? '' : 's'}`,
    }, snapshot => {
      const nextPages = removePagesById(snapshot.pages, idSet);
      if (nextPages.length === snapshot.pages.length) return null;
      const nextSelected = new Set(snapshot.selectedPageIds);
      idSet.forEach(id => nextSelected.delete(id));
      return {
        pages: nextPages,
        activePageId: getNextActivePageId(snapshot.pages, nextPages, snapshot.activePageId),
        selectedPageIds: nextSelected,
        rangeInput: snapshot.rangeInput,
      };
    });
  }, [pages, requestConfirmedPageMutation]);

  const keepOnlyPagesWithUndo = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    const keptCount = pages.filter(page => idSet.has(page.id)).length;
    if (keptCount === 0 || keptCount === pages.length) return;

    requestConfirmedPageMutation({
      title: 'Keep only these pages?',
      message: `Keep ${keptCount} page${keptCount === 1 ? '' : 's'} and remove ${pages.length - keptCount}? You can undo this for a few seconds.`,
      confirmLabel: 'Keep only',
      danger: true,
      undoDescription: `Kept only ${keptCount} page${keptCount === 1 ? '' : 's'}`,
    }, snapshot => {
      const nextPages = keepOnlyPagesById(snapshot.pages, idSet);
      if (nextPages.length === snapshot.pages.length) return null;
      return {
        pages: nextPages,
        activePageId: getNextActivePageId(snapshot.pages, nextPages, snapshot.activePageId),
        selectedPageIds: new Set(),
        rangeInput: snapshot.rangeInput,
      };
    });
  }, [pages, requestConfirmedPageMutation]);

  const clearAllWithUndo = useCallback(() => {
    if (pages.length === 0) return;

    requestConfirmedPageMutation({
      title: 'Start over?',
      message: `Clear all ${pages.length} page${pages.length === 1 ? '' : 's'} from the workspace? You can undo this for a few seconds.`,
      confirmLabel: 'Start over',
      danger: true,
      undoDescription: 'Cleared workspace',
      beforeApply: cancelImport,
    }, () => ({
      documents: {},
      pages: [],
      activePageId: null,
      selectedPageIds: new Set(),
      rangeInput: '',
    }));
  }, [cancelImport, pages.length, requestConfirmedPageMutation]);

  const reorderPage = useCallback((sourceIndex: number, destinationIndex: number) => {
    commitImmediatePageMutation('Reordered page', snapshot => {
      const nextPages = reorderPageList(snapshot.pages, sourceIndex, destinationIndex);
      if (nextPages === snapshot.pages) return null;
      return {
        pages: nextPages,
        activePageId: snapshot.activePageId,
        selectedPageIds: snapshot.selectedPageIds,
        rangeInput: snapshot.rangeInput,
      };
    });
  }, [commitImmediatePageMutation]);

  const reorderSelectedPages = useCallback((draggedId: string, destinationIndex: number) => {
    commitImmediatePageMutation('Reordered pages', snapshot => {
      const nextPages = reorderSelectedPageBlock(snapshot.pages, snapshot.selectedPageIds, draggedId, destinationIndex);
      if (nextPages === snapshot.pages) return null;
      return {
        pages: nextPages,
        activePageId: snapshot.activePageId,
        selectedPageIds: snapshot.selectedPageIds,
        rangeInput: snapshot.rangeInput,
      };
    });
  }, [commitImmediatePageMutation]);

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

  const selectPagesByNumbers = useCallback((pageNumbers: number[]) => {
    setPages(prev => {
      const newSel = new Set<string>();
      for (const num of pageNumbers) {
        const page = prev[num - 1];
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
      documents, pages, activePageId, selectedPageIds, annotations, isLoading, importJob,
      rangeInput, setRangeInput, ocrQueue, setOcrQueue,
      addFiles, cancelImport, setPages, setActivePageId, replacePage, removePage, removePages, extractPages, clearAll,
      removePageWithUndo, removePagesWithUndo, keepOnlyPagesWithUndo, clearAllWithUndo,
      reorderPage, reorderSelectedPages,
      pendingUndo: pendingUndoState
        ? { description: pendingUndoState.description, expiresAt: pendingUndoState.expiresAt }
        : null,
      undoLastPageMutation,
      addAnnotation, updateAnnotation, removeAnnotation,
      togglePageSelection, selectPageRange, selectPagesByNumbers,
      selectAll, clearSelection, invertSelection
    }}>
      {children}
      {confirmRequest && (
        <div className="confirm-backdrop" role="presentation">
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
          >
            <h2 id="confirm-dialog-title">{confirmRequest.title}</h2>
            <p>{confirmRequest.message}</p>
            <div className="confirm-actions">
              <button className="confirm-secondary" onClick={() => setConfirmRequest(null)}>
                Cancel
              </button>
              <button
                className={confirmRequest.danger ? 'confirm-danger' : 'confirm-primary'}
                onClick={confirmRequest.onConfirm}
              >
                {confirmRequest.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingUndoState && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>{pendingUndoState.description}</span>
          <button onClick={undoLastPageMutation}>Undo</button>
        </div>
      )}
    </PdfContext.Provider>
  );
};
