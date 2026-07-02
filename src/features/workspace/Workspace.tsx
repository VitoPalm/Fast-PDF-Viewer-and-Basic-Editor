import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePdf } from '../../shared/hooks/usePdf';
import { useRenderEngine } from '../pdf-engine/useRenderEngine';
import { Trash2, ChevronLeft, ChevronRight, Plus, Download, Sparkles, X, FileSearch, Wrench } from 'lucide-react';
import { type TextAnnotation } from '../../shared/types/pdf';
import {
  cleanOcrFromPage,
  cleanOcrUnavailableMessage,
  exportModifiedPdf,
  glyphDiagnosticsUnavailableMessage,
  glyphRepairUnavailableMessage,
  getNativePageAnalysis,
  isAnalysisOcrCandidate,
  isNativeHiddenOcrAnalysis,
  type PageAnalysis,
} from '../pdf-engine/utils';
import { OCRHint } from './OCRHint';
import { getImportJobProgress, isImportJobBlocking, isImportJobBusy, isImportJobVisible, type ImportJob } from '../../context/importJob';
import { getOcrJobProgress, isOcrJobBusy, isOcrJobVisible, type OcrJob } from '../../context/ocrJob';
import { getGlyphJobProgress, isGlyphJobBusy, isGlyphJobVisible, type GlyphJob } from '../../context/glyphRepairJob';
import {
  getGlyphTextRepairJobProgress,
  isGlyphTextRepairJobBusy,
  isGlyphTextRepairJobVisible,
  type GlyphTextRepairJob,
} from '../../context/glyphTextRepairJob';
import { isSuspectTextHealth } from '../pdf-engine/textLayerHealth';
import { type GlyphDiagnosticsReport, type GlyphRepairReport } from '../../shared/types/glyph';
import * as pdfjsLib from 'pdfjs-dist';
import './Workspace.css';

const formatImportStatus = (job: ImportJob): string => {
  switch (job.phase) {
    case 'reading':
      return 'Reading PDFs...';
    case 'loading':
      return job.currentFileName ? `Loading ${job.currentFileName}` : 'Loading PDF...';
    case 'instantiating':
      return `${job.pagesInstantiated}/${job.pagesTotal} pages ready`;
    case 'analyzing':
      return `Analyzing ${job.pagesAnalyzed}/${job.pagesTotal} pages`;
    case 'failed':
      return job.error ? `Import failed: ${job.error}` : 'Import failed';
    default:
      return 'Importing...';
  }
};

const formatOcrStatus = (job: OcrJob): string => {
  switch (job.phase) {
    case 'preparing':
      return 'Preparing OCR...';
    case 'detecting-language':
      return 'Detecting language...';
    case 'running':
      return job.currentPageId ? 'Recognizing text...' : 'Processing OCR...';
    case 'failed':
      return job.error ?? 'OCR failed';
    case 'cancelled':
      return 'OCR cancelled';
    default:
      return 'OCR processing...';
  }
};

const formatGlyphStatus = (job: GlyphJob): string => {
  switch (job.phase) {
    case 'preparing':
      return 'Preparing text check...';
    case 'running':
      return job.currentPageId ? 'Checking selectable text...' : 'Checking text...';
    case 'failed':
      return job.error ?? 'Text check failed';
    case 'cancelled':
      return 'Text check cancelled';
    default:
      return 'Text check...';
  }
};

const formatGlyphTextRepairStatus = (job: GlyphTextRepairJob): string => {
  switch (job.phase) {
    case 'preparing':
      return 'Preparing text repair...';
    case 'running':
      return job.currentPageId ? 'Repairing selectable text...' : 'Repairing text...';
    case 'cancelling':
      return job.currentPageId ? 'Stopping after this page...' : 'Stopping text repair...';
    case 'complete':
      if (job.repaired === 0 && job.skipped > 0) {
        return 'No pages were repaired';
      }
      return 'Text repair complete';
    case 'failed':
      return job.error ?? 'Text repair finished with issues';
    case 'cancelled':
      return 'Text repair cancelled';
    default:
      return 'Text repair...';
  }
};

const formatGlyphDiagnosticsSummary = (report: GlyphDiagnosticsReport): string => {
  const page = report.pages[0];
  if (!page || page.glyphEvents === 0) {
    return 'No selectable text was found on this page.';
  }

  if (report.deterministicCandidateFonts > 0) {
    return 'Selectable text can likely be repaired without changing page appearance.';
  }

  if (report.unmappedGlyphs > 0) {
    return 'Some selectable text cannot be repaired automatically yet. OCR may help on this page.';
  }

  return 'Selectable text looks usable.';
};

const formatGlyphRepairSummary = (report: GlyphRepairReport): string => {
  if (report.fontsRepaired > 0) {
    return 'Repair complete. Page appearance matched before and after.';
  }

  const skipped = report.fonts.find(font => font.status === 'skipped');
  return skipped?.message ?? 'No automatic text repair was available for this page.';
};

const formatCount = (count: number, singular: string, plural = `${singular}s`): string => (
  `${count} ${count === 1 ? singular : plural}`
);

const pageHasExistingGlyphMapNeedingReview = (report: GlyphDiagnosticsReport | undefined): boolean => (
  report?.pages.some(page => page.fonts.some(font => font.repairPlan === 'existing-to-unicode-needs-review')) === true
);

const formatTextHealthReason = (reason: string): string => reason.replace(/-/g, ' ');

const textHealthCopy = (analysis: PageAnalysis): { message: string; detail: string } => {
  if (analysis.textHealth === 'unsupported') {
    return {
      message: 'Text extraction failed for this page. Native selection is disabled.',
      detail: 'Export keeps the original page. OCR can add a searchable layer without replacing the page artwork.',
    };
  }

  const reason = analysis.textHealthReasons[0]
    ? ` Reason: ${formatTextHealthReason(analysis.textHealthReasons[0])}.`
    : '';
  return {
    message: 'Text extraction looks corrupted. Native selection is disabled to avoid copying bad text.',
    detail: `Export keeps the original page.${reason}`,
  };
};

const ocrHintCopy = (analysis: PageAnalysis | null): { title: string; description: string } => {
  if (analysis?.textHealth === 'suspectEncoding') {
    return {
      title: 'Text Selection Disabled',
      description: 'This page has corrupted selectable text. OCR can add a searchable fallback layer while preserving the original page.',
    };
  }

  if (analysis?.textHealth === 'unsupported') {
    return {
      title: 'Text Extraction Failed',
      description: 'The native text layer could not be read. OCR can add searchable text while preserving the original page.',
    };
  }

  return {
    title: 'Scan Detected',
    description: 'This page appears to be a scan. Use OCR to make text searchable and selectable.',
  };
};

export const Workspace: React.FC = () => {
  const {
    pages, activePageId, setActivePageId, documents,
    selectedPageIds, annotations, updateAnnotation, removeAnnotation,
    addFiles, cancelImport, replacePage, clearAllWithUndo, importJob,
    ocrJob, startOcr, cancelOcr, retryFailedOcr,
    glyphJob, startGlyphDiagnostics, cancelGlyphDiagnostics, repairGlyphTextPage, repairGlyphTextPages,
    glyphTextRepairJob, cancelGlyphTextRepair, confirmAction,
  } = usePdf();
  const { requestPage } = useRenderEngine();
  const [isExporting, setIsExporting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.5);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textLayerRenderIdRef = useRef(0);
  const [dismissedOcrHintPageIds, setDismissedOcrHintPageIds] = useState<Set<string>>(new Set());
  const [debugTextLayer, setDebugTextLayer] = useState(false);
  const [pageAnalysis, setPageAnalysis] = useState<PageAnalysis | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const [pageInputValue, setPageInputValue] = useState('');
  const [isEditingPageNum, setIsEditingPageNum] = useState(false);
  const pageInputRef = useRef<HTMLInputElement>(null);

  const isOcrRunning = isOcrJobBusy(ocrJob);
  const isGlyphRunning = isGlyphJobBusy(glyphJob);
  const isGlyphTextRepairRunning = isGlyphTextRepairJobBusy(glyphTextRepairJob);
  const isImportRunning = isImportJobBusy(importJob);
  const isImportBlocking = isImportJobBlocking(importJob);
  const isTextActionImportBusy = isImportRunning;

  const activePage = pages.find(p => p.id === activePageId);
  const activeIndex = pages.findIndex(p => p.id === activePageId);
  const docInfo = activePage ? documents[activePage.docId] : null;
  const pageAnnotations = annotations.filter(a => a.pageId === activePageId);
  const canCleanOcr = typeof window !== 'undefined' && typeof window.antigravityPdf?.cleanOcrPage === 'function';
  const canDiagnoseGlyphText = typeof window !== 'undefined' && typeof window.antigravityPdf?.diagnoseGlyphText === 'function';
  const canRepairGlyphText = typeof window !== 'undefined' && typeof window.antigravityPdf?.repairGlyphText === 'function';

  useEffect(() => {
    if (!activePage || !docInfo || !canvasRef.current) return;
    let cancelled = false;
    const renderId = textLayerRenderIdRef.current + 1;
    textLayerRenderIdRef.current = renderId;
    const isCurrentRender = () => !cancelled && textLayerRenderIdRef.current === renderId;
    let nativeTextLayer: { cancel: () => void } | null = null;
    setIsTransitioning(true);
    setCanvasReady(false);

    const render = async () => {
      try {
        const page = await docInfo.pdfjsDoc.getPage(activePage.originalPageIndex);
        if (!isCurrentRender()) return;
        const viewport = page.getViewport({ scale });

        let analysis = activePage.analysis ?? null;

        // If we have OCR results, adjust analysis to reflect it
        if (activePage.ocrResult) {
          analysis = {
            hasText: analysis?.hasText ?? true,
            hasOCR: true,
            isScanned: false,
            textHealth: analysis?.textHealth ?? 'hiddenOcr',
            textHealthReasons: analysis?.textHealthReasons ?? ['ocr-result'],
            textItemCount: analysis?.textItemCount ?? activePage.ocrResult.items.length,
            textSample: analysis?.textSample ?? activePage.ocrResult.items
              .map(item => item.str)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 500),
          };
        }
        if (!isCurrentRender()) return;
        setPageAnalysis(analysis);
        const shouldRenderNativeTextLayer = !activePage.ocrResult &&
          activePage.analysisStatus === 'complete' &&
          analysis !== null &&
          !isSuspectTextHealth(analysis.textHealth);

        const bitmap = await requestPage(activePage.docId, docInfo.pdfjsDoc, activePage.originalPageIndex, scale, 'urgent');
        if (!isCurrentRender() || !canvasRef.current) return;

        const canvas = canvasRef.current;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(bitmap, 0, 0);
        setCanvasSize({ width: canvas.width, height: canvas.height });
        setCanvasReady(true);
        requestAnimationFrame(() => {
          if (isCurrentRender()) setIsTransitioning(false);
        });

        // Render native PDF.js Text Layer (only for pages WITHOUT OCR results)
        // OCR results are rendered by React JSX in a separate container
        const textLayerContainer = textLayerRef.current;
        if (textLayerContainer) {
          textLayerContainer.replaceChildren();
          textLayerContainer.style.width = `${canvas.width}px`;
          textLayerContainer.style.height = `${canvas.height}px`;
          if (shouldRenderNativeTextLayer) {
            const textContent = await page.getTextContent();
            if (!isCurrentRender() || !textLayerRef.current) return;

            const detachedTextLayerContainer = document.createElement('div');
            detachedTextLayerContainer.className = 'textLayer';
            detachedTextLayerContainer.style.width = `${canvas.width}px`;
            detachedTextLayerContainer.style.height = `${canvas.height}px`;
            const textLayer = new pdfjsLib.TextLayer({
              textContentSource: textContent,
              container: detachedTextLayerContainer,
              viewport: viewport,
            });
            nativeTextLayer = textLayer;
            await textLayer.render();
            if (!isCurrentRender() || textLayerRef.current !== textLayerContainer) return;
            textLayerContainer.replaceChildren(...Array.from(detachedTextLayerContainer.childNodes));
          }
        }
      } catch (err) {
        console.error("Render error", err);
        if (isCurrentRender()) setIsTransitioning(false);
      }
    };
    render();
    return () => {
      cancelled = true;
      nativeTextLayer?.cancel();
    };
  }, [activePage, docInfo, scale, requestPage]);

  const lastScrollTime = useRef(0);
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const goToPage = useCallback((index: number) => {
    if (index >= 0 && index < pages.length) setActivePageId(pages[index].id);
  }, [pages, setActivePageId]);

  const goPrev = useCallback(() => goToPage(activeIndexRef.current - 1), [goToPage]);
  const goNext = useCallback(() => goToPage(activeIndexRef.current + 1), [goToPage]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (isEditingPageNum) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLElement && e.target.closest('button, a, select, [role="button"], [role="slider"], [role="separator"], [contenteditable="true"]')) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goPrev(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goNext(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goPrev, goNext, isEditingPageNum]);

  const handlePageNumberClick = () => {
    setIsEditingPageNum(true);
    setPageInputValue(String(activeIndexRef.current + 1));
    setTimeout(() => pageInputRef.current?.select(), 0);
  };

  const commitPageNumber = () => {
    const num = parseInt(pageInputValue, 10);
    if (!isNaN(num) && num >= 1 && num <= pages.length) goToPage(num - 1);
    setIsEditingPageNum(false);
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitPageNumber();
    if (e.key === 'Escape') setIsEditingPageNum(false);
  };

  // Panning via mouse drag on the scroll container
  const handleMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    // Only start panning if clicking on the canvas or its container
    // Allow panning if clicking on the container, the canvas, or the textLayer background itself
    // But NOT if clicking on an actual text span (to allow selection)
    const isTextSpan = e.target instanceof HTMLElement && e.target.tagName === 'SPAN' && e.target.parentElement?.classList.contains('textLayer');

    const isAllowedTarget =
      e.target === containerRef.current ||
      e.target === canvasRef.current ||
      (e.target === textLayerRef.current && !isTextSpan);

    if (!isAllowedTarget) return;

    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    e.preventDefault();
  };

  useEffect(() => {
    if (!isPanning) return;

    const onMouseMove = (e: MouseEvent) => {
      const el = scrollRef.current;
      if (!el) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      el.scrollLeft = panStartRef.current.scrollLeft - dx;
      el.scrollTop = panStartRef.current.scrollTop - dy;
    };

    const onMouseUp = () => {
      setIsPanning(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isPanning]);

  // Wheel handler with passive: false so we can preventDefault for page switches AND ctrl+zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Ctrl+scroll or trackpad pinch-to-zoom
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.003;
        setScale(prev => Math.min(3.0, Math.max(0.5, Math.round((prev + delta) * 10) / 10)));
        return;
      }

      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 10) {
        const isAtLeftEdge = el.scrollLeft <= 5;
        const isAtRightEdge = el.scrollLeft + el.clientWidth >= el.scrollWidth - 5;

        // The canvas width already includes the scale (rendered at that scale)
        const currentScaledWidth = canvasSize.width / (window.devicePixelRatio || 1);
        const viewportWidth = el.clientWidth;
        const isNarrowPage = currentScaledWidth < (viewportWidth * 0.7);

        if (isNarrowPage || (e.deltaX < 0 && isAtLeftEdge) || (e.deltaX > 0 && isAtRightEdge)) {
          const now = Date.now();
          if (now - lastScrollTime.current > 400) {
            if (e.deltaX > 0) goNext();
            else goPrev();
            lastScrollTime.current = now;
            e.preventDefault();
          }
        }
        // Otherwise: let the browser natively scroll the content horizontally
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canvasSize.width, goNext, goPrev]);

  const handleScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setScale(Math.min(3.0, Math.max(0.5, val)));
  };

  const handleOCR = async () => {
    if (!activePage || isTextActionImportBusy || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning) return;
    setDismissedOcrHintPageIds(prev => new Set(prev).add(activePage.id));
    await startOcr([activePage.id], { mode: 'single', force: true });
  };

  const handleBatchOCR = async () => {
    if (isTextActionImportBusy || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning) return;
    const candidateIds = pages.filter(p => isAnalysisOcrCandidate(p.analysis)).map(p => p.id);
    const healthyTextIds = pages.filter(p => (
      p.analysis &&
      !isAnalysisOcrCandidate(p.analysis) &&
      p.analysis.hasText
    )).map(p => p.id);

    let targetIds = [...candidateIds];
    let includeTextPages = false;

    if (healthyTextIds.length > 0) {
      if (await confirmAction({
        title: 'Include selectable-text pages?',
        message: `Found ${formatCount(healthyTextIds.length, 'page')} with healthy selectable text. Include them in OCR anyway? Their vector graphics will be preserved.`,
        confirmLabel: 'Include pages',
      })) {
        targetIds = [...targetIds, ...healthyTextIds];
        includeTextPages = true;
      }
    }

    if (targetIds.length === 0) {
      alert("No pages need OCR.");
      return;
    }

    if (!await confirmAction({
      title: 'Run OCR in background?',
      message: `Process ${formatCount(targetIds.length, 'page')} in the background? You can keep browsing while OCR runs.`,
      confirmLabel: 'Run OCR',
    })) return;
    void startOcr(targetIds, { mode: 'batch', includeTextPages });
  };

  const isGlyphRepairCandidatePage = useCallback((page: typeof pages[number]) => {
    const nativeAnalysis = getNativePageAnalysis(page);
    return (
      page.glyphRepairStatus !== 'queued' &&
      page.glyphRepairStatus !== 'running' &&
      page.glyphRepairStatus !== 'complete' &&
      (
        Boolean(page.glyphDiagnostics?.deterministicCandidateFonts) ||
        pageHasExistingGlyphMapNeedingReview(page.glyphDiagnostics) ||
        Boolean(page.ocrResult && nativeAnalysis && isSuspectTextHealth(nativeAnalysis.textHealth))
      )
    );
  }, []);

  const selectedRepairScope = selectedPageIds.size > 0 ? selectedPageIds : null;
  const glyphRepairTargetIds = pages
    .filter(page => (!selectedRepairScope || selectedRepairScope.has(page.id)) && isGlyphRepairCandidatePage(page))
    .map(page => page.id);
  const glyphRepairButtonLabel = isGlyphTextRepairRunning
    ? 'Repairing...'
    : `Repair text issues (${glyphRepairTargetIds.length})`;
  const showBatchGlyphRepairButton = (
    !selectedRepairScope &&
    (isGlyphTextRepairRunning || glyphRepairTargetIds.length > 0)
  );
  const canStartGlyphTextRepair = (
    canRepairGlyphText &&
    !isTextActionImportBusy &&
    !isOcrRunning &&
    !isGlyphRunning &&
    !isGlyphTextRepairRunning &&
    glyphRepairTargetIds.length > 0
  );
  const glyphRepairButtonTitle = (() => {
    if (!canRepairGlyphText) return glyphRepairUnavailableMessage;
    if (isTextActionImportBusy) return 'Wait for PDFs to finish loading and analysis before repairing text.';
    if (isOcrRunning) return 'Wait for OCR to finish before repairing text.';
    if (isGlyphRunning) return 'Wait for text checks to finish before repairing text.';
    if (isGlyphTextRepairRunning) return 'Text repair is already running.';
    if (glyphRepairTargetIds.length === 0) {
      return selectedRepairScope
        ? 'No selected pages are ready for text repair.'
        : 'No suspect pages are ready for text repair.';
    }
    return `${formatCount(glyphRepairTargetIds.length, 'page')} ready for text repair.`;
  })();
  const toolbarBusyReason = isTextActionImportBusy
    ? 'PDFs are still loading or being analyzed; OCR and text actions are disabled.'
    : isOcrRunning
      ? 'OCR running; export and repair are disabled.'
      : isGlyphRunning
        ? 'Text check running; export and repair are disabled.'
        : isGlyphTextRepairRunning
          ? 'Text repair running; import, OCR, and export are disabled.'
          : null;
  const toolbarBusyReasonId = 'workspace-toolbar-busy-reason';
  const glyphRepairButtonDescriptionId = 'workspace-repair-button-reason';
  const glyphRepairButtonDescribedBy = [
    toolbarBusyReason ? toolbarBusyReasonId : null,
    glyphRepairButtonTitle ? glyphRepairButtonDescriptionId : null,
  ].filter(Boolean).join(' ') || undefined;

  const handleBatchGlyphRepair = async () => {
    if (!canRepairGlyphText) {
      alert(glyphRepairUnavailableMessage);
      return;
    }
    if (isTextActionImportBusy || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning) {
      alert('Wait for PDFs to finish loading and analysis, OCR, text checks, and text repair jobs to finish before starting another repair.');
      return;
    }

    const targetIds = glyphRepairTargetIds;

    if (targetIds.length === 0) {
      alert('No pages are ready for text repair.');
      return;
    }

    if (!await confirmAction({
      title: 'Repair selectable text?',
      message: `Repair selectable text on ${formatCount(targetIds.length, 'page')}? The app will use OCR text when available, skip ambiguous pages, and keep page artwork unchanged. Successful repairs can be undone for a few seconds.`,
      confirmLabel: 'Repair text',
    })) return;
    void repairGlyphTextPages(targetIds);
  };

  const handleCleanOCR = async () => {
    if (!activePage || !docInfo) return;
    if (isTextActionImportBusy || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning) {
      alert('Wait for PDFs to finish loading and analysis, OCR, text checks, and text repair jobs to finish before cleaning OCR.');
      return;
    }
    if (!canCleanOcr) {
      alert(cleanOcrUnavailableMessage);
      return;
    }
    if (!await confirmAction({
      title: 'Clean OCR from this page?',
      message: 'This permanently removes the existing text layer by re-rendering the page as an image.',
      confirmLabel: 'Clean OCR',
      danger: true,
    })) return;

    setIsExporting(true);
    try {
      const newBlob = await cleanOcrFromPage(docInfo, activePage.originalPageIndex);
      await replacePage(activePage.id, newBlob);
    } catch (err) {
      console.error("Clean OCR failed", err);
      alert(err instanceof Error ? err.message : "Failed to clean OCR.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleGlyphDiagnostics = async () => {
    if (!activePage || isGlyphRunning) return;
    if (isTextActionImportBusy) {
      alert('Wait for PDFs to finish loading and analysis before checking text.');
      return;
    }
    if (!canDiagnoseGlyphText) {
      alert(glyphDiagnosticsUnavailableMessage);
      return;
    }

    await startGlyphDiagnostics([activePage.id]);
  };

  const handleGlyphRepair = async () => {
    if (!activePage || activePage.glyphRepairStatus === 'queued' || activePage.glyphRepairStatus === 'running') return;
    if (!canRepairGlyphText) {
      alert(glyphRepairUnavailableMessage);
      return;
    }
    if (isTextActionImportBusy || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning) {
      alert('Wait for PDFs to finish loading and analysis, OCR, text checks, and text repair jobs to finish before repairing this page.');
      return;
    }
    if (!await confirmAction({
      title: 'Repair selectable text?',
      message: 'Repair selectable text on this page? The app will use OCR text when available, skip ambiguous results, and keep page artwork unchanged.',
      confirmLabel: 'Repair text',
    })) return;

    await repairGlyphTextPage(activePage.id);
  };

  const handleExport = async () => {
    if (isImportBlocking || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning) {
      alert('Wait for PDFs to finish loading, OCR, text checks, and text repair jobs to finish before exporting.');
      return;
    }

    setIsExporting(true);
    try {
      const blob = await exportModifiedPdf(documents, pages, annotations, 1.5);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modified_document.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Failed to export PDF");
    } finally {
      setIsExporting(false);
    }
  };

  if (!activePage) {
    return <div className="workspace-content" style={{ alignItems: 'center', color: 'var(--text-secondary)' }}>Select a page from the sidebar.</div>;
  }

  const showImportProgress = isImportJobVisible(importJob);
  const importProgress = getImportJobProgress(importJob);
  const showOcrProgress = isOcrJobVisible(ocrJob);
  const ocrProgress = getOcrJobProgress(ocrJob);
  const showGlyphProgress = isGlyphJobVisible(glyphJob);
  const glyphProgress = getGlyphJobProgress(glyphJob);
  const showGlyphTextRepairProgress = isGlyphTextRepairJobVisible(glyphTextRepairJob);
  const glyphTextRepairProgress = getGlyphTextRepairJobProgress(glyphTextRepairJob);
  const effectivePageAnalysis = pageAnalysis ?? activePage.analysis ?? null;
  const showSuspectTextLayer = effectivePageAnalysis ? isSuspectTextHealth(effectivePageAnalysis.textHealth) : false;
  const shouldUseNativeTextLayer = !activePage.ocrResult &&
    activePage.analysisStatus === 'complete' &&
    !showSuspectTextLayer;
  const pageCanOcr = isAnalysisOcrCandidate(effectivePageAnalysis);
  const showOcrHint = activePage && !dismissedOcrHintPageIds.has(activePage.id);
  const hasGeneratedOcr = Boolean(activePage.ocrResult);
  const hasNativeHiddenOcr = !hasGeneratedOcr && isNativeHiddenOcrAnalysis(effectivePageAnalysis);
  const suspectCopy = effectivePageAnalysis && showSuspectTextLayer ? textHealthCopy(effectivePageAnalysis) : null;
  const hintCopy = ocrHintCopy(effectivePageAnalysis);
  const activeGlyphRepairBusy = activePage.glyphRepairStatus === 'queued' || activePage.glyphRepairStatus === 'running';
  const canRepairActiveGlyphText = isGlyphRepairCandidatePage(activePage);
  const glyphSummary = activePage.glyphDiagnostics
    ? formatGlyphDiagnosticsSummary(activePage.glyphDiagnostics)
    : null;
  const glyphRepairSummary = activePage.glyphRepairReport
    ? formatGlyphRepairSummary(activePage.glyphRepairReport)
    : null;
  const glyphBannerDetail = activePage.glyphRepairError ?? glyphRepairSummary ?? glyphSummary;
  const showPageStatusBanner = Boolean(
    (suspectCopy && !effectivePageAnalysis?.hasOCR) ||
    hasGeneratedOcr ||
    hasNativeHiddenOcr
  );
  const exportDisabledReason = isImportBlocking
    ? 'PDFs are still loading; export is disabled.'
    : isOcrRunning
      ? 'OCR running; export is disabled.'
      : isGlyphRunning
        ? 'Text check running; export is disabled.'
        : isGlyphTextRepairRunning
          ? 'Text repair running; export is disabled.'
          : null;
  const pageActionBusyReason = isTextActionImportBusy
    ? 'PDFs are still loading or being analyzed; page text actions are disabled.'
    : isOcrRunning
      ? 'OCR running; page text actions are disabled.'
      : isGlyphRunning
        ? 'Text check running; page text actions are disabled.'
        : isGlyphTextRepairRunning || activeGlyphRepairBusy
          ? 'Text repair running; page text actions are disabled.'
          : null;
  const pageActionBusyReasonId = 'workspace-page-action-busy-reason';

  return (
    <div className="workspace-viewport">
      <div className="glass workspace-toolbar">
        <div className="workspace-toolbar-group">
          <label
            className="btn btn-secondary"
            data-disabled={(isImportRunning || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning) ? 'true' : undefined}
            aria-disabled={isImportRunning || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning}
          >
            <input
              type="file"
              multiple
              accept="application/pdf"
              className="visually-hidden-input"
              aria-label="Add PDFs to merge"
              disabled={isImportRunning || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning}
              onChange={(e) => {
                if (e.target.files) addFiles(Array.from(e.target.files));
              }}
            />
            <Plus size={16} /> {
              isImportRunning
                ? 'Importing...'
                : isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning
                  ? 'Job Running'
                  : 'Add PDFs to Merge'
            }
          </label>
          {showImportProgress && (
            <div className="import-progress-pill" data-testid="workspace-import-progress" role="status" aria-live="polite">
              <span>{formatImportStatus(importJob)}</span>
              <div
                className="import-progress-bar"
                role="progressbar"
                aria-label="PDF import progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={importProgress}
                aria-valuetext={`${importProgress}% imported`}
              >
                <div style={{ width: `${importProgress}%` }} />
              </div>
              {isImportRunning && (
                <button
                  type="button"
                  className="import-progress-cancel"
                  onClick={cancelImport}
                  title="Cancel import"
                  aria-label="Cancel import"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="workspace-toolbar-group workspace-toolbar-actions">
          {toolbarBusyReason && (
            <span id={toolbarBusyReasonId} className="sr-only">{toolbarBusyReason}</span>
          )}
          <button className="btn btn-secondary" onClick={clearAllWithUndo}>Start Over</button>
          <button className="btn btn-secondary" onClick={handleBatchOCR} disabled={isTextActionImportBusy || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning} aria-describedby={toolbarBusyReason ? toolbarBusyReasonId : undefined} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={16} /> Batch OCR
          </button>
          {showBatchGlyphRepairButton && (
            <>
              <span id={glyphRepairButtonDescriptionId} className="sr-only">{glyphRepairButtonTitle}</span>
              <button
                className="btn btn-secondary"
                onClick={handleBatchGlyphRepair}
                disabled={!canStartGlyphTextRepair}
                title={glyphRepairButtonTitle}
                aria-describedby={glyphRepairButtonDescribedBy}
                aria-label={`${glyphRepairButtonLabel}${glyphRepairTargetIds.length > 0 ? `, ${glyphRepairTargetIds.length} pages` : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Wrench size={16} /> {glyphRepairButtonLabel}
              </button>
            </>
          )}
          {pageCanOcr && !hasGeneratedOcr && (
            <button className="btn btn-primary" onClick={() => handleOCR()} disabled={isTextActionImportBusy || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning} aria-describedby={toolbarBusyReason ? toolbarBusyReasonId : undefined} style={{ background: 'var(--accent-color)', borderColor: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} /> {isOcrRunning ? `Processing...` : 'OCR Page'}
            </button>
          )}
          <button
            className={`btn ${debugTextLayer ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setDebugTextLayer(!debugTextLayer)}
            aria-pressed={debugTextLayer}
            aria-label={debugTextLayer ? 'Hide text boxes' : 'Show text boxes'}
            title={debugTextLayer ? 'Hide text boxes' : 'Show text boxes'}
          >
            {debugTextLayer ? 'Hide Boxes' : 'Show Boxes'}
          </button>
          <button className="btn btn-primary" onClick={handleExport} disabled={isExporting || isImportBlocking || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning} aria-describedby={exportDisabledReason ? toolbarBusyReasonId : undefined}>
            <Download size={16} /> {isExporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className={`workspace-content ${isPanning ? 'panning' : ''} ${showPageStatusBanner ? 'has-page-status' : ''}`}
        onClick={() => setActiveTextId(null)}
      >
        {pageActionBusyReason && (
          <span id={pageActionBusyReasonId} className="sr-only">{pageActionBusyReason}</span>
        )}
        {pageCanOcr && !activePage?.ocrResult && showOcrHint && !isOcrRunning && (
          <OCRHint
            title={hintCopy.title}
            description={hintCopy.description}
            onOCR={() => handleOCR()}
            onDismiss={() => setDismissedOcrHintPageIds(prev => new Set(prev).add(activePage.id))}
          />
        )}
        {suspectCopy && !effectivePageAnalysis?.hasOCR && (
          <div className="glass text-health-banner text-health-banner-warning" role={activePage.glyphRepairStatus === 'failed' ? 'alert' : 'status'} aria-live={activePage.glyphRepairStatus === 'failed' ? 'assertive' : 'polite'}>
            <div className="text-health-banner-copy">
              <span>{suspectCopy.message}</span>
              <span className="text-health-banner-detail">{glyphBannerDetail ?? suspectCopy.detail}</span>
            </div>
            <div className="text-health-banner-actions">
                {canDiagnoseGlyphText ? (
                  <button
                    className="btn btn-secondary text-health-banner-action"
                    onClick={handleGlyphDiagnostics}
                    disabled={isTextActionImportBusy || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning || activeGlyphRepairBusy || activePage.glyphDiagnosticsStatus === 'running'}
                    aria-describedby={pageActionBusyReason ? pageActionBusyReasonId : undefined}
                  >
                  <FileSearch size={14} />
                  {activePage.glyphDiagnosticsStatus === 'complete' ? 'Check Again' : 'Check Text'}
                </button>
              ) : (
                <span className="text-health-banner-detail">{glyphDiagnosticsUnavailableMessage}</span>
              )}
              {canRepairActiveGlyphText && (
                canRepairGlyphText ? (
                  <button
                    className="btn btn-primary text-health-banner-action"
                    onClick={handleGlyphRepair}
                    disabled={isTextActionImportBusy || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning || activeGlyphRepairBusy}
                    aria-describedby={pageActionBusyReason ? pageActionBusyReasonId : undefined}
                  >
                    <Wrench size={14} />
                    {activePage.glyphRepairStatus === 'queued' ? 'Queued...' : activePage.glyphRepairStatus === 'running' ? 'Repairing...' : 'Repair Text'}
                  </button>
                ) : (
                  <span className="text-health-banner-detail">{glyphRepairUnavailableMessage}</span>
                )
              )}
            </div>
          </div>
        )}
        {hasGeneratedOcr && (
          <div className="glass text-health-banner" role="status" aria-live="polite">
            <span>OCR text added to this page.</span>
            {canRepairActiveGlyphText && canRepairGlyphText && (
              <button
                className="btn btn-secondary text-health-banner-action"
                onClick={handleGlyphRepair}
                disabled={isTextActionImportBusy || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning || activeGlyphRepairBusy}
                aria-describedby={pageActionBusyReason ? pageActionBusyReasonId : undefined}
              >
                <Wrench size={14} />
                Repair Text
              </button>
            )}
          </div>
        )}
        {hasNativeHiddenOcr && (
          <div className="glass text-health-banner" role="status" aria-live="polite">
            <span>Existing OCR text found.</span>
              {canCleanOcr ? (
                <button
                  className="btn btn-secondary text-health-banner-action"
                  onClick={handleCleanOCR}
                  disabled={isExporting || isTextActionImportBusy || isOcrRunning || isGlyphRunning || isGlyphTextRepairRunning}
                  aria-describedby={pageActionBusyReason ? pageActionBusyReasonId : undefined}
                >
                Clean OCR
              </button>
            ) : (
              <span className="text-health-banner-detail">{cleanOcrUnavailableMessage}</span>
            )}
          </div>
        )}
        <div
          ref={containerRef}
          className={`pdf-page-container ${isTransitioning ? 'transitioning' : ''} ${canvasReady ? 'ready' : ''} ${isPanning ? 'panning' : ''} ${debugTextLayer ? 'debug-text-layer' : ''}`}
          style={{ flexShrink: 0, margin: 'auto' }}
          onMouseDown={handleMouseDown}
        >

          <canvas ref={canvasRef} style={{ display: 'block' }} />
          {/* Native PDF.js text layer — managed imperatively, never touched by React */}
          <div
            ref={textLayerRef}
            className={`textLayer ${isPanning ? 'panning' : ''}`}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: shouldUseNativeTextLayer ? 'auto' : 'none' }}
          />
          {/* React-managed OCR text layer — completely separate from textLayerRef */}
          {activePage?.ocrResult && (
            <svg
              className={`textLayer ${isPanning ? 'panning' : ''}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: canvasSize.width ? `${canvasSize.width}px` : '100%',
                height: canvasSize.height ? `${canvasSize.height}px` : '100%',
                pointerEvents: 'none' // Let the <text> elements catch pointer events
              }}
            >
              {activePage.ocrResult.items.map((item, i) => (
                <g key={i}>
                  {debugTextLayer && (
                    <rect
                      x={item.transform[4] * scale}
                      y={item.transform[5] * scale}
                      width={item.width * scale}
                      height={item.height * scale}
                      fill="rgba(99, 102, 241, 0.05)"
                      stroke="rgba(99, 102, 241, 0.3)"
                      strokeWidth="0.5"
                      pointerEvents="none"
                    />
                  )}
                  <text
                    x={item.transform[4] * scale}
                    y={(item.transform[5] + item.height * 0.8) * scale} // Approximate baseline
                    textLength={item.width * scale}
                    lengthAdjust="spacingAndGlyphs"
                    style={{
                      fontSize: `${item.height * scale}px`,
                      fontFamily: 'sans-serif',
                      fill: debugTextLayer ? 'rgba(99, 102, 241, 0.4)' : 'transparent',
                      pointerEvents: 'auto',
                      userSelect: 'text',
                      cursor: 'text'
                    }}
                  >
                    {item.str}
                  </text>
                </g>
              ))}
            </svg>
          )}
          {pageAnnotations.map(annot => (
            <DraggableText
              key={annot.id}
              annot={annot}
              scale={scale}
              isActive={activeTextId === annot.id}
              onSelect={() => setActiveTextId(annot.id)}
              onChange={(updates) => updateAnnotation(annot.id, updates)}
              onRemove={() => removeAnnotation(annot.id)}
            />
          ))}
        </div>
      </div>

      {(showOcrProgress || showGlyphProgress || showGlyphTextRepairProgress) && (
        <div className="workspace-activity-strip" aria-label="Background activity">
          {showOcrProgress && (
            <div className="ocr-pill">
              <Sparkles size={12} className="ocr-pill-icon" />
              <div className="ocr-pill-info" role="status" aria-live="polite">
                <span className="ocr-pill-status">{formatOcrStatus(ocrJob)}</span>
                <span className="ocr-pill-queue">
                  {ocrJob.completed}/{ocrJob.total} pages
                  {ocrJob.failed > 0 ? `, ${ocrJob.failed} failed` : ''}
                  {ocrJob.skipped > 0 ? `, ${ocrJob.skipped} skipped` : ''}
                </span>
              </div>
              <div
                className="ocr-pill-bar-container"
                role="progressbar"
                aria-label="OCR progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={ocrProgress}
                aria-valuetext={`${ocrProgress}% OCR complete, ${ocrJob.completed} of ${ocrJob.total} pages${ocrJob.failed > 0 ? `, ${ocrJob.failed} failed` : ''}${ocrJob.skipped > 0 ? `, ${ocrJob.skipped} skipped` : ''}`}
              >
                <div className="ocr-pill-bar" style={{ width: `${ocrProgress}%` }} />
              </div>
              {isOcrRunning && (
                <button className="ocr-pill-cancel" onClick={cancelOcr} title="Cancel OCR" aria-label="Cancel OCR">
                  <X size={10} />
                </button>
              )}
              {ocrJob.phase === 'failed' && ocrJob.failedPageIds.length > 0 && (
                <button className="ocr-pill-retry" onClick={() => void retryFailedOcr()} title="Retry failed OCR pages">
                  Retry
                </button>
              )}
            </div>
          )}

          {showGlyphProgress && (
            <div className="glyph-pill">
              <FileSearch size={12} className="glyph-pill-icon" />
              <div className="glyph-pill-info" role="status" aria-live="polite">
                <span className="glyph-pill-status">{formatGlyphStatus(glyphJob)}</span>
                <span className="glyph-pill-queue">
                  {glyphJob.completed}/{glyphJob.total} pages
                  {glyphJob.failed > 0 ? `, ${glyphJob.failed} failed` : ''}
                  {glyphJob.skipped > 0 ? `, ${glyphJob.skipped} skipped` : ''}
                </span>
              </div>
              <div
                className="glyph-pill-bar-container"
                role="progressbar"
                aria-label="Text check progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={glyphProgress}
                aria-valuetext={`${glyphProgress}% text check complete, ${glyphJob.completed} of ${glyphJob.total} pages${glyphJob.failed > 0 ? `, ${glyphJob.failed} failed` : ''}${glyphJob.skipped > 0 ? `, ${glyphJob.skipped} skipped` : ''}`}
              >
                <div className="glyph-pill-bar" style={{ width: `${glyphProgress}%` }} />
              </div>
              {isGlyphRunning && (
                <button className="glyph-pill-cancel" onClick={cancelGlyphDiagnostics} title="Cancel text check" aria-label="Cancel text check">
                  <X size={10} />
                </button>
              )}
            </div>
          )}

          {showGlyphTextRepairProgress && (
            <div className="repair-pill">
              <Wrench size={12} className="repair-pill-icon" />
              <div className="repair-pill-info" role="status" aria-live="polite">
                <span className="repair-pill-status">{formatGlyphTextRepairStatus(glyphTextRepairJob)}</span>
                <span className="repair-pill-queue">
                  {glyphTextRepairJob.completed}/{glyphTextRepairJob.total} pages
                  {glyphTextRepairJob.repaired > 0 ? `, ${glyphTextRepairJob.repaired} repaired` : ''}
                  {glyphTextRepairJob.failed > 0 ? `, ${glyphTextRepairJob.failed} failed` : ''}
                  {glyphTextRepairJob.skipped > 0 ? `, ${glyphTextRepairJob.skipped} skipped` : ''}
                </span>
              </div>
              <div
                className="repair-pill-bar-container"
                role="progressbar"
                aria-label="Text repair progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={glyphTextRepairProgress}
                aria-valuetext={`${glyphTextRepairProgress}% text repair complete, ${glyphTextRepairJob.completed} of ${glyphTextRepairJob.total} pages${glyphTextRepairJob.failed > 0 ? `, ${glyphTextRepairJob.failed} failed` : ''}${glyphTextRepairJob.skipped > 0 ? `, ${glyphTextRepairJob.skipped} skipped` : ''}`}
              >
                <div className="repair-pill-bar" style={{ width: `${glyphTextRepairProgress}%` }} />
              </div>
              {isGlyphTextRepairRunning && (
                <button className="repair-pill-cancel" onClick={cancelGlyphTextRepair} title="Stop repair" aria-label="Stop text repair">
                  <X size={10} />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="page-indicator">
        <button className="page-indicator-nav" onClick={goPrev} disabled={activeIndex <= 0} aria-label="Previous page"><ChevronLeft size={16} /></button>
        {isEditingPageNum ? (
          <input
            ref={pageInputRef}
            className="page-indicator-input"
            type="text"
            value={pageInputValue}
            onChange={e => setPageInputValue(e.target.value)}
            onBlur={commitPageNumber}
            onKeyDown={handlePageInputKeyDown}
            aria-label="Page number"
            autoFocus
          />
        ) : (
          <button className="page-indicator-label" onClick={handlePageNumberClick} aria-label={`Go to page, currently page ${activeIndex + 1} of ${pages.length}`}>
            {activeIndex + 1} <span className="page-indicator-total">/ {pages.length}</span>
          </button>
        )}
        <button className="page-indicator-nav" onClick={goNext} disabled={activeIndex >= pages.length - 1} aria-label="Next page"><ChevronRight size={16} /></button>

        <div className="zoom-control">
          <input
            type="range"
            className="zoom-slider"
            min="0.5"
            max="3.0"
            step="0.1"
            value={scale}
            onChange={handleScaleChange}
            aria-label="Zoom level"
            aria-valuemin={50}
            aria-valuemax={300}
            aria-valuenow={Math.round(scale * 100)}
            aria-valuetext={`${Math.round(scale * 100)}%`}
          />
          <span className="zoom-label">{Math.round(scale * 100)}%</span>
        </div>
      </div>
    </div>
  );
};

const DraggableText: React.FC<{
  annot: TextAnnotation;
  scale: number;
  isActive: boolean;
  onSelect: () => void;
  onChange: (updates: Partial<TextAnnotation>) => void;
  onRemove: () => void;
}> = ({ annot, scale, isActive, onSelect, onChange, onRemove }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    setIsDragging(true);
    setStartPos({ x: e.clientX - annot.x * scale, y: e.clientY - annot.y * scale });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    onChange({ x: (e.clientX - startPos.x) / scale, y: (e.clientY - startPos.y) / scale });
  }, [isDragging, startPos, onChange, scale]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      style={{
        position: 'absolute',
        left: annot.x * scale,
        top: annot.y * scale,
        cursor: isDragging ? 'grabbing' : 'grab',
        border: isActive ? '1px dashed var(--accent-color)' : '1px solid transparent',
        padding: '4px',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transformOrigin: 'top left'
      }}
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
    >
      {isActive ? (
        <input
          autoFocus
          value={annot.text}
          onChange={(e) => onChange({ text: e.target.value })}
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: annot.color,
            fontSize: `${annot.fontSize * scale}px`,
            fontFamily: 'var(--font-family)',
            fontWeight: 600,
            width: `${Math.max(50, annot.text.length * 10 * scale)}px`
          }}
        />
      ) : (
        <span style={{ color: annot.color, fontSize: `${annot.fontSize * scale}px`, fontWeight: 600, whiteSpace: 'nowrap' }}>{annot.text}</span>
      )}
      {isActive && (
        <button className="icon-btn" onClick={onRemove} aria-label="Remove text annotation" style={{ width: '24px', height: '24px', color: 'var(--danger-color)' }}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};
