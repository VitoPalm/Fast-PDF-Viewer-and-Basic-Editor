import React, { useState, useCallback, type ReactNode, useEffect, useRef, useReducer } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { type PdfDocumentInfo, type PdfPageInfo, loadPdfDocument, analyzePage, diagnoseGlyphText } from '../features/pdf-engine/utils';
import { type PageMutationConfirmOptions, type TextAnnotation } from '../shared/types/pdf';
import { OCRService } from '../features/pdf-engine/ocrService';
import { detectLanguage } from '../features/pdf-engine/languageDetector';
import {
  applyPageAnalysisUpdateForJob,
  createIdleImportJob,
  createPagePlaceholders,
  importJobReducer,
  isImportJobBusy,
  orderImportedPagesForAnalysis,
} from './importJob';
import {
  applyPageOcrResultForJob,
  applyPageOcrStatusForJob,
  createIdleOcrJob,
  getOcrCandidatePages,
  isOcrJobBusy,
  ocrJobReducer,
  type OcrJobOptions,
} from './ocrJob';
import {
  applyPageGlyphReportForJob,
  applyPageGlyphStatusForJob,
  createIdleGlyphJob,
  getGlyphDiagnosticsCandidatePages,
  glyphJobReducer,
  isGlyphJobBusy,
} from './glyphRepairJob';
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
const OCR_RENDER_SCALE = 2.0;

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
  const [importJob, dispatchImportJob] = useReducer(importJobReducer, createIdleImportJob());
  const [ocrJob, dispatchOcrJob] = useReducer(ocrJobReducer, createIdleOcrJob());
  const [glyphJob, dispatchGlyphJob] = useReducer(glyphJobReducer, createIdleGlyphJob());
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [pendingUndoState, setPendingUndoState] = useState<PendingUndoState | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const activePageIdRef = useRef<string | null>(activePageId);
  const documentsRef = useRef(documents);
  const pagesRef = useRef(pages);
  const selectedPageIdsRef = useRef(selectedPageIds);
  const rangeInputRef = useRef(rangeInput);
  const importJobRef = useRef(importJob);
  const restartAnalysisRef = useRef<(
    restoredPages: PdfPageInfo[],
    restoredDocuments: Record<string, PdfDocumentInfo>,
    restoredActivePageId: string | null,
  ) => void>(() => {});
  const currentImportJobIdRef = useRef(0);
  const currentOcrJobIdRef = useRef(0);
  const currentGlyphJobIdRef = useRef(0);
  const ocrCancelRef = useRef(false);
  const glyphCancelRef = useRef(false);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const undoButtonRef = useRef<HTMLButtonElement | null>(null);
  const pausedUndoRemainingMsRef = useRef<number | null>(null);
  const confirmReturnFocusRef = useRef<HTMLElement | null>(null);

  const isLoading = isImportJobBusy(importJob) || isOcrJobBusy(ocrJob) || isGlyphJobBusy(glyphJob);

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

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    selectedPageIdsRef.current = selectedPageIds;
  }, [selectedPageIds]);

  useEffect(() => {
    rangeInputRef.current = rangeInput;
  }, [rangeInput]);

  useEffect(() => {
    importJobRef.current = importJob;
  }, [importJob]);

  useEffect(() => {
    if (confirmRequest) {
      window.setTimeout(() => cancelButtonRef.current?.focus(), 0);
    }
  }, [confirmRequest]);

  const isImportJobCurrent = useCallback((jobId: number) => (
    currentImportJobIdRef.current === jobId
  ), []);

  const isOcrJobCurrent = useCallback((jobId: number) => (
    currentOcrJobIdRef.current === jobId
  ), []);

  const isGlyphJobCurrent = useCallback((jobId: number) => (
    currentGlyphJobIdRef.current === jobId
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

  const updateOcrStatusForJob = useCallback((
    jobId: number,
    pageId: string,
    status: PdfPageInfo['ocrStatus'],
    error?: string,
  ) => {
    setPages(prev => applyPageOcrStatusForJob(prev, {
      currentJobId: currentOcrJobIdRef.current,
      jobId,
      pageId,
      status,
      error,
    }));
  }, []);

  const renderPageForOcr = useCallback(async (pageInfo: PdfPageInfo): Promise<HTMLCanvasElement> => {
    const docInfo = documentsRef.current[pageInfo.docId];
    if (!docInfo) throw new Error(`Missing PDF document for page ${pageInfo.originalPageIndex}`);

    const pdfPage = await docInfo.pdfjsDoc.getPage(pageInfo.originalPageIndex);
    const viewport = pdfPage.getViewport({ scale: OCR_RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to create OCR canvas context.');

    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }, []);

  const applyOcrResultForJob = useCallback((
    jobId: number,
    pageId: string,
    result: Awaited<ReturnType<typeof OCRService.performOCR>>,
  ) => {
    if (!isOcrJobCurrent(jobId)) return;

    const ocrResult = {
      items: result.items.map(item => ({
        str: item.str,
        transform: [1, 0, 0, 1, item.transform[4] / OCR_RENDER_SCALE, item.transform[5] / OCR_RENDER_SCALE],
        width: item.width / OCR_RENDER_SCALE,
        height: item.height / OCR_RENDER_SCALE,
      })),
    };

    setPages(prev => applyPageOcrResultForJob(prev, {
      currentJobId: currentOcrJobIdRef.current,
      jobId,
      pageId,
      ocrResult,
    }));
  }, [isOcrJobCurrent]);

  const cancelOcr = useCallback(() => {
    const cancelledJobId = currentOcrJobIdRef.current;
    if (cancelledJobId <= 0) return;

    ocrCancelRef.current = true;
    const skippedIds = pagesRef.current
      .filter(page => page.ocrStatus === 'queued' || page.ocrStatus === 'running')
      .map(page => page.id);

    skippedIds.forEach(pageId => {
      updateOcrStatusForJob(cancelledJobId, pageId, 'skipped');
      dispatchOcrJob({ type: 'page-skipped', jobId: cancelledJobId, pageId });
    });

    dispatchOcrJob({ type: 'cancelled', jobId: cancelledJobId });
    currentOcrJobIdRef.current += 1;
  }, [updateOcrStatusForJob]);

  const updateGlyphStatusForJob = useCallback((
    jobId: number,
    pageId: string,
    status: PdfPageInfo['glyphDiagnosticsStatus'],
    error?: string,
  ) => {
    setPages(prev => applyPageGlyphStatusForJob(prev, {
      currentJobId: currentGlyphJobIdRef.current,
      jobId,
      pageId,
      status: status ?? 'idle',
      error,
    }));
  }, []);

  const cancelGlyphDiagnostics = useCallback(() => {
    const cancelledJobId = currentGlyphJobIdRef.current;
    if (cancelledJobId <= 0) return;

    glyphCancelRef.current = true;
    const skippedIds = pagesRef.current
      .filter(page => page.glyphDiagnosticsStatus === 'queued' || page.glyphDiagnosticsStatus === 'running')
      .map(page => page.id);

    skippedIds.forEach(pageId => {
      updateGlyphStatusForJob(cancelledJobId, pageId, 'skipped');
      dispatchGlyphJob({ type: 'page-skipped', jobId: cancelledJobId, pageId });
    });

    dispatchGlyphJob({ type: 'cancelled', jobId: cancelledJobId });
    currentGlyphJobIdRef.current += 1;
  }, [updateGlyphStatusForJob]);

  const applyGlyphReportForJob = useCallback((
    jobId: number,
    pageId: string,
    report: Awaited<ReturnType<typeof diagnoseGlyphText>>,
  ) => {
    if (!isGlyphJobCurrent(jobId)) return;

    setPages(prev => applyPageGlyphReportForJob(prev, {
      currentJobId: currentGlyphJobIdRef.current,
      jobId,
      pageId,
      report,
    }));
  }, [isGlyphJobCurrent]);

  const startGlyphDiagnostics = useCallback(async (pageIds: string[]) => {
    const candidates = getGlyphDiagnosticsCandidatePages(pagesRef.current, pageIds);
    if (candidates.length === 0) return;

    if (isGlyphJobBusy(glyphJob)) {
      cancelGlyphDiagnostics();
    }

    const jobId = currentGlyphJobIdRef.current + 1;
    currentGlyphJobIdRef.current = jobId;
    glyphCancelRef.current = false;

    const targetIds = candidates.map(page => page.id);
    dispatchGlyphJob({ type: 'started', jobId, pageIds: targetIds });
    setPages(prev => prev.map(page => targetIds.includes(page.id) ? {
      ...page,
      glyphDiagnosticsStatus: 'queued',
      glyphDiagnosticsError: undefined,
    } : page));

    try {
      for (const pageInfo of candidates) {
        if (!isGlyphJobCurrent(jobId) || glyphCancelRef.current) return;

        updateGlyphStatusForJob(jobId, pageInfo.id, 'running');
        dispatchGlyphJob({ type: 'page-running', jobId, pageId: pageInfo.id });

        try {
          const docInfo = documentsRef.current[pageInfo.docId];
          if (!docInfo) throw new Error(`Missing PDF document for page ${pageInfo.originalPageIndex}`);

          const report = await diagnoseGlyphText(docInfo, [pageInfo.originalPageIndex]);
          if (!isGlyphJobCurrent(jobId) || glyphCancelRef.current) return;

          applyGlyphReportForJob(jobId, pageInfo.id, report);
          dispatchGlyphJob({ type: 'page-complete', jobId, pageId: pageInfo.id });
        } catch (err) {
          if (!isGlyphJobCurrent(jobId) || glyphCancelRef.current) return;

          const error = getErrorMessage(err);
          updateGlyphStatusForJob(jobId, pageInfo.id, 'failed', error);
          dispatchGlyphJob({ type: 'page-failed', jobId, pageId: pageInfo.id, error });
        }
      }

      if (!isGlyphJobCurrent(jobId) || glyphCancelRef.current) return;
      dispatchGlyphJob({ type: 'completed', jobId });
    } catch (err) {
      if (!isGlyphJobCurrent(jobId) || glyphCancelRef.current) return;

      const error = getErrorMessage(err);
      targetIds.forEach(pageId => {
        updateGlyphStatusForJob(jobId, pageId, 'failed', error);
        dispatchGlyphJob({ type: 'page-failed', jobId, pageId, error });
      });
      dispatchGlyphJob({ type: 'failed', jobId, error });
    }
  }, [applyGlyphReportForJob, cancelGlyphDiagnostics, getErrorMessage, glyphJob, isGlyphJobCurrent, updateGlyphStatusForJob]);

  const startOcr = useCallback(async (pageIds: string[], options: OcrJobOptions) => {
    const candidates = getOcrCandidatePages(pagesRef.current, pageIds, options);
    if (candidates.length === 0) return;

    if (isOcrJobBusy(ocrJob)) {
      cancelOcr();
    }

    const jobId = currentOcrJobIdRef.current + 1;
    currentOcrJobIdRef.current = jobId;
    ocrCancelRef.current = false;

    const targetIds = candidates.map(page => page.id);
    dispatchOcrJob({ type: 'started', jobId, pageIds: targetIds, options });

    setPages(prev => prev.map(page => targetIds.includes(page.id) ? {
      ...page,
      ocrStatus: 'queued',
      ocrError: undefined,
    } : page));

    const renderedPages = new Map<string, HTMLCanvasElement>();
    const getRenderedPage = async (pageInfo: PdfPageInfo) => {
      const cached = renderedPages.get(pageInfo.id);
      if (cached) return cached;
      const canvas = await renderPageForOcr(pageInfo);
      renderedPages.set(pageInfo.id, canvas);
      return canvas;
    };

    try {
      let langs = 'eng';
      let samplePageId: string | null = null;
      let sampleResult: Awaited<ReturnType<typeof OCRService.performOCR>> | null = null;

      if (options.mode !== 'single' && candidates.length > 0) {
        const samplePage = candidates[0];
        samplePageId = samplePage.id;
        dispatchOcrJob({ type: 'detecting-language', jobId });

        const sampleCanvas = await getRenderedPage(samplePage);
        if (!isOcrJobCurrent(jobId) || ocrCancelRef.current) return;

        sampleResult = await OCRService.performOCR(sampleCanvas, undefined, 'eng');
        if (!isOcrJobCurrent(jobId) || ocrCancelRef.current) return;

        const detected = detectLanguage(sampleResult.text);
        if (detected) {
          langs = `eng+${detected.code}`;
        }
        dispatchOcrJob({ type: 'language-detected', jobId, language: langs });
      }

      const settledIds = new Set<string>();

      const completePage = (pageId: string, result: Awaited<ReturnType<typeof OCRService.performOCR>>) => {
        if (!isOcrJobCurrent(jobId) || ocrCancelRef.current) return;
        applyOcrResultForJob(jobId, pageId, result);
        settledIds.add(pageId);
        dispatchOcrJob({ type: 'page-complete', jobId, pageId });
      };

      if (sampleResult && samplePageId && langs === 'eng') {
        updateOcrStatusForJob(jobId, samplePageId, 'running');
        dispatchOcrJob({ type: 'page-running', jobId, pageId: samplePageId });
        completePage(samplePageId, sampleResult);
      }

      const processPage = async (pageInfo: PdfPageInfo) => {
        if (!isOcrJobCurrent(jobId) || ocrCancelRef.current || settledIds.has(pageInfo.id)) return;

        updateOcrStatusForJob(jobId, pageInfo.id, 'running');
        dispatchOcrJob({ type: 'page-running', jobId, pageId: pageInfo.id });

        try {
          const canvas = await getRenderedPage(pageInfo);
          if (!isOcrJobCurrent(jobId) || ocrCancelRef.current) return;

          const result = options.mode === 'single'
            ? await OCRService.performOCR(canvas, progress => {
                if (isOcrJobCurrent(jobId)) {
                  dispatchOcrJob({ type: 'page-progress', jobId, progress });
                }
              }, langs)
            : await OCRService.performBatchPageOCR(canvas, langs);

          if (!isOcrJobCurrent(jobId) || ocrCancelRef.current) return;
          completePage(pageInfo.id, result);
        } catch (err) {
          if (!isOcrJobCurrent(jobId) || ocrCancelRef.current) return;

          const error = getErrorMessage(err);
          updateOcrStatusForJob(jobId, pageInfo.id, 'failed', error);
          settledIds.add(pageInfo.id);
          dispatchOcrJob({ type: 'page-failed', jobId, pageId: pageInfo.id, error });
        }
      };

      const queue = candidates.filter(page => !settledIds.has(page.id));
      const concurrency = options.mode === 'single'
        ? 1
        : Math.min(OCRService.POOL_SIZE, Math.max(1, queue.length));
      let nextIndex = 0;

      const worker = async () => {
        while (nextIndex < queue.length) {
          if (!isOcrJobCurrent(jobId) || ocrCancelRef.current) return;
          const pageInfo = queue[nextIndex++];
          await processPage(pageInfo);
        }
      };

      await Promise.all(Array.from({ length: concurrency }, worker));
      if (!isOcrJobCurrent(jobId) || ocrCancelRef.current) return;

      dispatchOcrJob({ type: 'completed', jobId });
    } catch (err) {
      if (!isOcrJobCurrent(jobId) || ocrCancelRef.current) return;

      const error = getErrorMessage(err);
      const failedIds = targetIds.filter(pageId => {
        const page = pagesRef.current.find(candidate => candidate.id === pageId);
        return page?.ocrStatus !== 'complete';
      });
      failedIds.forEach(pageId => {
        dispatchOcrJob({ type: 'page-failed', jobId, pageId, error });
      });
      dispatchOcrJob({ type: 'failed', jobId, error });
      setPages(prev => prev.map(page => failedIds.includes(page.id) ? {
        ...page,
        ocrStatus: 'failed',
        ocrError: error,
      } : page));
    }
  }, [applyOcrResultForJob, cancelOcr, getErrorMessage, isOcrJobCurrent, ocrJob, renderPageForOcr, updateOcrStatusForJob]);

  const retryFailedOcr = useCallback(async () => {
    if (ocrJob.failedPageIds.length === 0) return;
    await startOcr(ocrJob.failedPageIds, {
      mode: ocrJob.mode ?? 'batch',
      force: true,
      includeTextPages: true,
    });
  }, [ocrJob.failedPageIds, ocrJob.mode, startOcr]);

  const clearUndoTimer = useCallback(() => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  const startUndoTimer = useCallback((nextUndo: PendingUndoState) => {
    clearUndoTimer();
    pausedUndoRemainingMsRef.current = null;
    setPendingUndoState(nextUndo);
    const timeoutMs = Math.max(nextUndo.expiresAt - Date.now(), 0);
    undoTimerRef.current = window.setTimeout(() => {
      setPendingUndoState(null);
      undoTimerRef.current = null;
    }, timeoutMs);
    window.setTimeout(() => undoButtonRef.current?.focus(), 0);
  }, [clearUndoTimer]);

  const pauseUndoTimer = useCallback(() => {
    if (!pendingUndoState || undoTimerRef.current === null) return;

    pausedUndoRemainingMsRef.current = Math.max(pendingUndoState.expiresAt - Date.now(), 0);
    window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
  }, [pendingUndoState]);

  const resumePausedUndoTimer = useCallback(() => {
    const remainingMs = pausedUndoRemainingMsRef.current;
    if (remainingMs === null || !pendingUndoState) return;

    pausedUndoRemainingMsRef.current = null;
    startUndoTimer({
      ...pendingUndoState,
      expiresAt: Date.now() + remainingMs,
    });
  }, [pendingUndoState, startUndoTimer]);

  const closeConfirmDialog = useCallback(() => {
    setConfirmRequest(null);
    resumePausedUndoTimer();
    window.setTimeout(() => confirmReturnFocusRef.current?.focus(), 0);
  }, [resumePausedUndoTimer]);

  useEffect(() => {
    if (!confirmRequest) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeConfirmDialog();
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [closeConfirmDialog, confirmRequest]);

  const captureSnapshot = useCallback((): PageStateSnapshot => ({
    documents: documentsRef.current,
    pages: pagesRef.current,
    activePageId: activePageIdRef.current,
    selectedPageIds: new Set(selectedPageIdsRef.current),
    rangeInput: rangeInputRef.current,
  }), []);

  const applyMutationResult = useCallback((result: PageMutationResult) => {
    if (result.documents) setDocuments(result.documents);
    setPages(result.pages);
    setActivePageId(result.activePageId);
    setSelectedPageIds(result.selectedPageIds);
    setRangeInput(result.rangeInput);
  }, []);

  const mergeRuntimePageState = useCallback((snapshotPage: PdfPageInfo, currentPage: PdfPageInfo | undefined): PdfPageInfo => {
    if (!currentPage) return snapshotPage;

    return {
      ...snapshotPage,
      analysis: currentPage.analysis ?? snapshotPage.analysis,
      analysisStatus: currentPage.analysisStatus ?? snapshotPage.analysisStatus,
      analysisError: currentPage.analysisError,
      ocrStatus: currentPage.ocrStatus ?? snapshotPage.ocrStatus,
      ocrError: currentPage.ocrError,
      ocrResult: currentPage.ocrResult ?? snapshotPage.ocrResult,
      glyphDiagnosticsStatus: currentPage.glyphDiagnosticsStatus ?? snapshotPage.glyphDiagnosticsStatus,
      glyphDiagnosticsError: currentPage.glyphDiagnosticsError,
      glyphDiagnostics: currentPage.glyphDiagnostics ?? snapshotPage.glyphDiagnostics,
    };
  }, []);

  const normalizeRestoredPageState = useCallback((restoredPages: PdfPageInfo[]): PdfPageInfo[] => (
    restoredPages.map(page => ({
      ...page,
      analysisStatus: page.analysisStatus === 'running' ? 'pending' : page.analysisStatus,
      analysisError: page.analysisStatus === 'running' ? undefined : page.analysisError,
      ocrStatus: page.ocrStatus === 'queued' || page.ocrStatus === 'running' ? 'skipped' : page.ocrStatus,
      ocrError: page.ocrStatus === 'queued' || page.ocrStatus === 'running'
        ? 'OCR was cancelled before undo restored this page.'
        : page.ocrError,
      glyphDiagnosticsStatus: page.glyphDiagnosticsStatus === 'queued' || page.glyphDiagnosticsStatus === 'running'
        ? 'skipped'
        : page.glyphDiagnosticsStatus,
      glyphDiagnosticsError: page.glyphDiagnosticsStatus === 'queued' || page.glyphDiagnosticsStatus === 'running'
        ? 'Glyph diagnostics were cancelled before undo restored this page.'
        : page.glyphDiagnosticsError,
    }))
  ), []);

  const buildRebasedUndoSnapshot = useCallback((snapshot: PageStateSnapshot): PageStateSnapshot => {
    const currentPages = pagesRef.current;
    const currentPageById = new Map(currentPages.map(page => [page.id, page]));
    const snapshotPageIds = new Set(snapshot.pages.map(page => page.id));
    const restoredSnapshotPages = snapshot.pages.map(page => mergeRuntimePageState(page, currentPageById.get(page.id)));
    const currentOnlyPages = currentPages.filter(page => !snapshotPageIds.has(page.id));
    const restoredPages = normalizeRestoredPageState([...restoredSnapshotPages, ...currentOnlyPages]);
    const validPageIds = new Set(restoredPages.map(page => page.id));

    return {
      documents: { ...snapshot.documents, ...documentsRef.current },
      pages: restoredPages,
      activePageId: snapshot.activePageId && validPageIds.has(snapshot.activePageId)
        ? snapshot.activePageId
        : restoredPages[0]?.id ?? null,
      selectedPageIds: new Set(
        Array.from(snapshot.selectedPageIds).filter(pageId => validPageIds.has(pageId)),
      ),
      rangeInput: snapshot.rangeInput,
    };
  }, [mergeRuntimePageState, normalizeRestoredPageState]);

  const requestConfirmedPageMutation = useCallback((
    request: Omit<ConfirmRequest, 'onConfirm'> & { undoDescription: string; beforeApply?: () => void; allowDuringImport?: boolean },
    buildResult: (snapshot: PageStateSnapshot) => PageMutationResult | null,
  ) => {
    if (isImportJobBusy(importJobRef.current) && !request.allowDuringImport) {
      alert('Wait for the current import to finish before changing pages.');
      return;
    }

    confirmReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    pauseUndoTimer();

    setConfirmRequest({
      title: request.title,
      message: request.message,
      confirmLabel: request.confirmLabel,
      danger: request.danger,
      onConfirm: () => {
        const snapshot = captureSnapshot();
        const result = buildResult(snapshot);
        setConfirmRequest(null);
        pausedUndoRemainingMsRef.current = null;
        if (!result) return;

        request.beforeApply?.();
        applyMutationResult(result);
        startUndoTimer({
          description: request.undoDescription,
          expiresAt: Date.now() + UNDO_TIMEOUT_MS,
          snapshot,
        });
      },
    });
  }, [applyMutationResult, captureSnapshot, pauseUndoTimer, startUndoTimer]);

  const commitImmediatePageMutation = useCallback((
    undoDescription: string,
    buildResult: (snapshot: PageStateSnapshot) => PageMutationResult | null,
  ) => {
    if (isImportJobBusy(importJobRef.current)) {
      alert('Wait for the current import to finish before changing pages.');
      return;
    }

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
    pausedUndoRemainingMsRef.current = null;
    setConfirmRequest(null);

    const rebasedSnapshot = buildRebasedUndoSnapshot(pendingUndoState.snapshot);
    setDocuments(rebasedSnapshot.documents);
    setPages(rebasedSnapshot.pages);
    setActivePageId(rebasedSnapshot.activePageId);
    setSelectedPageIds(new Set(rebasedSnapshot.selectedPageIds));
    setRangeInput(rebasedSnapshot.rangeInput);
    setPendingUndoState(null);
    restartAnalysisRef.current(rebasedSnapshot.pages, rebasedSnapshot.documents, rebasedSnapshot.activePageId);
  }, [buildRebasedUndoSnapshot, clearUndoTimer, pendingUndoState]);

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

  useEffect(() => {
    restartAnalysisRef.current = (
      restoredPages: PdfPageInfo[],
      restoredDocuments: Record<string, PdfDocumentInfo>,
      restoredActivePageId: string | null,
    ) => {
      const pagesToAnalyze = restoredPages.filter(page => (
        page.analysisStatus === 'pending' ||
        page.analysisStatus === 'running'
      ));
      if (pagesToAnalyze.length === 0) return;

      const jobId = currentImportJobIdRef.current + 1;
      currentImportJobIdRef.current = jobId;
      dispatchImportJob({ type: 'analysis-only-started', jobId, pagesTotal: pagesToAnalyze.length });

      const pageIdsToAnalyze = new Set(pagesToAnalyze.map(page => page.id));
      setPages(prev => prev.map(page => pageIdsToAnalyze.has(page.id) ? {
        ...page,
        analysisStatus: 'pending',
        analysisError: undefined,
      } : page));

      void analyzeImportedPages(
        jobId,
        pagesToAnalyze.map(page => ({ ...page, analysisStatus: 'pending' as const, analysisError: undefined })),
        restoredDocuments,
        restoredActivePageId,
      );
    };
  }, [analyzeImportedPages]);

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    if (isImportJobBusy(importJobRef.current)) return;

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
        ocrStatus: 'idle',
        ocrError: undefined,
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
    cancelOcr();
    cancelGlyphDiagnostics();
    setDocuments({});
    setPages([]);
    setActivePageId(null);
    setSelectedPageIds(new Set());
    setRangeInput('');
  }, [cancelGlyphDiagnostics, cancelImport, cancelOcr]);

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

  const removePagesWithUndo = useCallback((ids: string[], options?: PageMutationConfirmOptions) => {
    const idSet = new Set(ids);
    const affectedCount = pages.filter(page => idSet.has(page.id)).length;
    if (affectedCount === 0) return;

    requestConfirmedPageMutation({
      title: options?.title ?? 'Remove selected pages?',
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
        rangeInput: options?.nextRangeInput ?? snapshot.rangeInput,
      };
    });
  }, [pages, requestConfirmedPageMutation]);

  const keepOnlyPagesWithUndo = useCallback((ids: string[], options?: PageMutationConfirmOptions) => {
    const idSet = new Set(ids);
    const keptCount = pages.filter(page => idSet.has(page.id)).length;
    if (keptCount === 0 || keptCount === pages.length) return;

    requestConfirmedPageMutation({
      title: options?.title ?? 'Keep only these pages?',
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
        rangeInput: options?.nextRangeInput ?? snapshot.rangeInput,
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
      beforeApply: () => {
        cancelImport();
        cancelOcr();
        cancelGlyphDiagnostics();
      },
      allowDuringImport: true,
    }, () => ({
      documents: {},
      pages: [],
      activePageId: null,
      selectedPageIds: new Set(),
      rangeInput: '',
    }));
  }, [cancelGlyphDiagnostics, cancelImport, cancelOcr, pages.length, requestConfirmedPageMutation]);

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

  const handleConfirmDialogKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();

    if (event.key === 'Escape') {
      event.preventDefault();
      closeConfirmDialog();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusableElements = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(element => element.offsetParent !== null);

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }, [closeConfirmDialog]);

  return (
    <PdfContext.Provider value={{
      documents, pages, activePageId, selectedPageIds, annotations, isLoading, importJob, ocrJob, glyphJob,
      rangeInput, setRangeInput,
      addFiles, cancelImport, startGlyphDiagnostics, cancelGlyphDiagnostics, startOcr, cancelOcr, retryFailedOcr,
      setPages, setActivePageId, replacePage, removePage, removePages, extractPages, clearAll,
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
            aria-describedby="confirm-dialog-description"
            onKeyDown={handleConfirmDialogKeyDown}
          >
            <h2 id="confirm-dialog-title">{confirmRequest.title}</h2>
            <p id="confirm-dialog-description">{confirmRequest.message}</p>
            <div className="confirm-actions">
              <button ref={cancelButtonRef} className="confirm-secondary" onClick={closeConfirmDialog}>
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
      {pendingUndoState && !confirmRequest && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>{pendingUndoState.description}</span>
          <button ref={undoButtonRef} onClick={undoLastPageMutation}>Undo</button>
        </div>
      )}
    </PdfContext.Provider>
  );
};
