import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePdf } from '../../shared/hooks/usePdf';
import { useRenderEngine } from '../pdf-engine/useRenderEngine';
import { Trash2, ChevronLeft, ChevronRight, Plus, Download, Sparkles, X } from 'lucide-react';
import { type TextAnnotation } from '../../shared/types/pdf';
import { exportModifiedPdf, cleanOcrFromPage, type PageAnalysis } from '../pdf-engine/utils';
import { OCRService } from '../pdf-engine/ocrService';
import { detectLanguage } from '../pdf-engine/languageDetector';
import { OCRHint } from './OCRHint';
import { getImportJobProgress, isImportJobVisible, type ImportJob } from '../../context/importJob';
import * as pdfjsLib from 'pdfjs-dist';
import './Workspace.css';

const OCR_RENDER_SCALE = 2.0;

interface BatchOCRState {
  total: number;
  processed: number;
  status: string;
}

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

export const Workspace: React.FC = () => {
  const {
    pages, activePageId, setActivePageId, documents,
    annotations, updateAnnotation, removeAnnotation,
    addFiles, setPages, replacePage, clearAllWithUndo, importJob,
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
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [ocrStatus, setOcrStatus] = useState<string>('');
  const [batchOCR, setBatchOCR] = useState<BatchOCRState | null>(null);
  const batchCancelRef = useRef(false);
  const documentsRef = useRef(documents);
  const pagesRef = useRef(pages);
  const [showOcrHint, setShowOcrHint] = useState(true);
  const [debugTextLayer, setDebugTextLayer] = useState(false);
  const [pageAnalysis, setPageAnalysis] = useState<PageAnalysis | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const [pageInputValue, setPageInputValue] = useState('');
  const [isEditingPageNum, setIsEditingPageNum] = useState(false);
  const pageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { documentsRef.current = documents; }, [documents]);
  useEffect(() => { pagesRef.current = pages; }, [pages]);

  const isBatchRunning = batchOCR !== null;

  const activePage = pages.find(p => p.id === activePageId);
  const activeIndex = pages.findIndex(p => p.id === activePageId);
  const docInfo = activePage ? documents[activePage.docId] : null;
  const pageAnnotations = annotations.filter(a => a.pageId === activePageId);

  useEffect(() => {
    if (!activePage || !docInfo || !canvasRef.current) return;
    let cancelled = false;
    setIsTransitioning(true);
    setCanvasReady(false);

    const render = async () => {
      try {
        const page = await docInfo.pdfjsDoc.getPage(activePage.originalPageIndex);
        const viewport = page.getViewport({ scale });

        let analysis = activePage.analysis ?? null;

        // If we have OCR results, adjust analysis to reflect it
        if (activePage.ocrResult) {
          analysis = {
            hasText: analysis?.hasText ?? true,
            hasOCR: true,
            isScanned: false,
          };
        }
        setPageAnalysis(analysis);

        const bitmap = await requestPage(activePage.docId, docInfo.pdfjsDoc, activePage.originalPageIndex, scale, 'urgent');
        if (cancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(bitmap, 0, 0);
        setCanvasSize({ width: canvas.width, height: canvas.height });
        setCanvasReady(true);
        requestAnimationFrame(() => {
          if (!cancelled) setIsTransitioning(false);
        });

        // Render native PDF.js Text Layer (only for pages WITHOUT OCR results)
        // OCR results are rendered by React JSX in a separate container
        if (textLayerRef.current) {
          textLayerRef.current.innerHTML = '';
          textLayerRef.current.style.width = `${canvas.width}px`;
          textLayerRef.current.style.height = `${canvas.height}px`;
          if (!activePage.ocrResult) {
            const textContent = await page.getTextContent();
            const textLayer = new pdfjsLib.TextLayer({
              textContentSource: textContent,
              container: textLayerRef.current,
              viewport: viewport,
            });
            await textLayer.render();
          }
        }
      } catch (err) {
        console.error("Render error", err);
        if (!cancelled) setIsTransitioning(false);
      }
    };
    render();
    setShowOcrHint(true);
    return () => { cancelled = true; };
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

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
    if (!activePage || !docInfo || !canvasRef.current || isBatchRunning) return;

    setOcrProgress(0);
    setOcrStatus('Initializing Engine...');

    try {
      const result = await OCRService.performOCR(canvasRef.current, (prog) => {
        setOcrProgress(prog);
        if (prog < 30) setOcrStatus('Analyzing image structure...');
        else if (prog < 70) setOcrStatus('Recognizing characters...');
        else setOcrStatus('Finalizing text layer...');
      });

      setOcrStatus('Complete!');
      setOcrProgress(100);

      const ocrResult = {
        items: result.items.map(item => ({
          str: item.str,
          transform: [1, 0, 0, 1, item.transform[4] / scale, item.transform[5] / scale],
          width: item.width / scale,
          height: item.height / scale
        }))
      };

      setPages(prev => prev.map(p => p.id === activePage.id ? { ...p, ocrResult } : p));

      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = '';
      }

      setPageAnalysis(prev => prev ? { ...prev, isScanned: false, hasOCR: true } : null);
      setShowOcrHint(false);
    } catch (err) {
      console.error("OCR failed", err);
      setOcrStatus('Error occurred during processing.');
    } finally {
      setTimeout(() => {
        setOcrProgress(null);
        setOcrStatus('');
      }, 1500);
    }
  };

  const runBatchOCR = async (targetIds: string[], shouldFlatten: boolean) => {
    const total = targetIds.length;
    let processed = 0;
    batchCancelRef.current = false;
    setBatchOCR({ total, processed: 0, status: 'Starting...' });

    try {
      // Phase 1: Flatten pages that need it (sequential — modifies state)
      if (shouldFlatten) {
        for (const pageId of targetIds) {
          if (batchCancelRef.current) break;
          const pg = pagesRef.current.find(p => p.id === pageId);
          if (!pg || !pg.analysis?.hasText) continue;
          const di = documentsRef.current[pg.docId];
          if (!di) continue;
          setBatchOCR({ total, processed, status: `Flattening page...` });
          const blob = await cleanOcrFromPage(di, pg.originalPageIndex);
          await replacePage(pageId, blob);
          await new Promise(r => setTimeout(r, 200)); // let state settle
        }
      }

      if (batchCancelRef.current) return;

      // Phase 1.5: Language Detection Sampling
      let batchLangs = 'eng';
      setBatchOCR({ total, processed: 0, status: 'Detecting language...' });

      if (targetIds.length > 0) {
        const samplePageId = targetIds[0];
        const samplePg = pagesRef.current.find(p => p.id === samplePageId);
        const sampleDi = samplePg ? documentsRef.current[samplePg.docId] : null;

        if (samplePg && sampleDi) {
          const pdfPage = await sampleDi.pdfjsDoc.getPage(samplePg.originalPageIndex);
          const viewport = pdfPage.getViewport({ scale: OCR_RENDER_SCALE });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d')!;
          await pdfPage.render({ canvasContext: ctx, viewport }).promise;

          const sampleResult = await OCRService.performOCR(canvas, undefined, 'eng');
          const detected = detectLanguage(sampleResult.text);
          if (detected) {
            batchLangs = `eng+${detected.code}`;
            console.log(`Auto-detected secondary language: ${detected.name}`);
          }
        }
      }

      if (batchCancelRef.current) return;

      // Phase 2: OCR all pages in parallel via worker pool
      setBatchOCR({ total, processed: 0, status: 'Processing...' });

      const processPage = async (pageId: string) => {
        if (batchCancelRef.current) return;
        const pg = pagesRef.current.find(p => p.id === pageId);
        if (!pg) return;
        const di = documentsRef.current[pg.docId];
        if (!di) return;

        const pdfPage = await di.pdfjsDoc.getPage(pg.originalPageIndex);
        const viewport = pdfPage.getViewport({ scale: OCR_RENDER_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d')!;
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;

        const result = await OCRService.performBatchPageOCR(canvas, batchLangs);

        const ocrResult = {
          items: result.items.map(item => ({
            str: item.str,
            transform: [1, 0, 0, 1, item.transform[4] / OCR_RENDER_SCALE, item.transform[5] / OCR_RENDER_SCALE],
            width: item.width / OCR_RENDER_SCALE,
            height: item.height / OCR_RENDER_SCALE,
          }))
        };

        setPages(prev => prev.map(p => p.id === pageId ? { ...p, ocrResult } : p));
        processed++;
        setBatchOCR(prev => prev ? { ...prev, processed, status: 'Processing...' } : null);
      };

      // Concurrency-limited runner
      const concurrency = OCRService.POOL_SIZE;
      let idx = 0;
      const worker = async () => {
        while (idx < targetIds.length) {
          if (batchCancelRef.current) return;
          const i = idx++;
          await processPage(targetIds[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, targetIds.length) }, worker));

    } catch (err) {
      console.error("Batch OCR failed", err);
    } finally {
      setBatchOCR(prev => prev ? { ...prev, status: 'Complete!' } : null);
      setTimeout(() => setBatchOCR(null), 1500);
    }
  };

  const handleBatchOCR = () => {
    if (isBatchRunning) return;
    const scannedIds = pages.filter(p => p.analysis?.isScanned === true).map(p => p.id);
    const hasTextIds = pages.filter(p => p.analysis?.isScanned === false).map(p => p.id);

    let targetIds = [...scannedIds];
    const shouldFlatten = false;

    if (hasTextIds.length > 0) {
      if (confirm(`Found ${hasTextIds.length} pages that already have text. Do you want to run OCR on them anyway? (Their vector graphics will be preserved)`)) {
        targetIds = [...targetIds, ...hasTextIds];
        // We no longer flatten them! We keep the original vectorized PDF!
      }
    }

    if (targetIds.length === 0) {
      alert("No pages need OCR.");
      return;
    }

    if (!confirm(`Process ${targetIds.length} pages in background? You can keep browsing.`)) return;
    runBatchOCR(targetIds, shouldFlatten);
  };

  const handleCancelBatch = () => {
    if (!batchOCR) return;
    if (confirm(`Stop OCR? ${batchOCR.processed} of ${batchOCR.total} pages completed will keep their results.`)) {
      batchCancelRef.current = true;
    }
  };
  const handleCleanOCR = async () => {
    if (!activePage || !docInfo) return;
    if (!confirm("This will permanently remove the existing text layer by re-rendering the page as an image. Continue?")) return;

    setIsExporting(true);
    try {
      const newBlob = await cleanOcrFromPage(docInfo, activePage.originalPageIndex);
      await replacePage(activePage.id, newBlob);
    } catch (err) {
      console.error("Clean OCR failed", err);
      alert("Failed to clean OCR.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = async () => {
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

  return (
    <div className="workspace-viewport" style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="glass" style={{ padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--surface-border)', borderRadius: 0, borderTop: 'none', borderLeft: 'none', borderRight: 'none', zIndex: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
          <label className="btn btn-secondary">
            <input
              type="file"
              multiple
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) addFiles(Array.from(e.target.files));
              }}
            />
            <Plus size={16} /> Add PDFs to Merge
          </label>
          {showImportProgress && (
            <div className="import-progress-pill" data-testid="workspace-import-progress">
              <span>{formatImportStatus(importJob)}</span>
              <div className="import-progress-bar" aria-hidden="true">
                <div style={{ width: `${importProgress}%` }} />
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
          <button className="btn btn-secondary" onClick={clearAllWithUndo}>Start Over</button>
          <button className="btn btn-secondary" onClick={handleBatchOCR} disabled={isBatchRunning} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={16} /> Batch OCR
          </button>
          {pageAnalysis?.isScanned && (
            <button className="btn btn-primary" onClick={() => handleOCR()} disabled={ocrProgress !== null || isBatchRunning} style={{ background: 'var(--accent-color)', borderColor: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} /> {ocrProgress !== null ? `Processing...` : 'OCR Page'}
            </button>
          )}
          <button
            className={`btn ${debugTextLayer ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setDebugTextLayer(!debugTextLayer)}
            title="Show Text Layer Outline"
          >
            {debugTextLayer ? 'Hide Mesh' : 'Show Mesh'}
          </button>
          <button className="btn btn-primary" onClick={handleExport} disabled={isExporting}>
            <Download size={16} /> {isExporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className={`workspace-content ${isPanning ? 'panning' : ''}`}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative', display: 'flex', padding: '24px' }}
        onClick={() => setActiveTextId(null)}
      >
        {pageAnalysis?.hasOCR && (
          <div className="glass" style={{ position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', padding: '8px 16px', zIndex: 100, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid var(--accent-color)', color: 'var(--accent-color)' }}>
            <span>This page contains a text layer.</span>
            <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '4px 8px' }} onClick={handleCleanOCR}>Clean OCR</button>
          </div>
        )}
        <div
          ref={containerRef}
          className={`pdf-page-container ${isTransitioning ? 'transitioning' : ''} ${canvasReady ? 'ready' : ''} ${isPanning ? 'panning' : ''} ${debugTextLayer ? 'debug-text-layer' : ''}`}
          style={{ flexShrink: 0, margin: 'auto' }}
          onMouseDown={handleMouseDown}
        >

          {pageAnalysis?.isScanned && !activePage?.ocrResult && showOcrHint && ocrProgress === null && !isBatchRunning && (
            <OCRHint onOCR={() => handleOCR()} onDismiss={() => setShowOcrHint(false)} />
          )}
          <canvas ref={canvasRef} style={{ display: 'block' }} />
          {/* Native PDF.js text layer — managed imperatively, never touched by React */}
          <div
            ref={textLayerRef}
            className={`textLayer ${isPanning ? 'panning' : ''}`}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: activePage?.ocrResult ? 'none' : 'auto' }}
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

      <div className="page-indicator">
        <button className="page-indicator-nav" onClick={goPrev} disabled={activeIndex <= 0}><ChevronLeft size={16} /></button>
        {isEditingPageNum ? (
          <input
            ref={pageInputRef}
            className="page-indicator-input"
            type="text"
            value={pageInputValue}
            onChange={e => setPageInputValue(e.target.value)}
            onBlur={commitPageNumber}
            onKeyDown={handlePageInputKeyDown}
            autoFocus
          />
        ) : (
          <button className="page-indicator-label" onClick={handlePageNumberClick}>
            {activeIndex + 1} <span className="page-indicator-total">/ {pages.length}</span>
          </button>
        )}
        <button className="page-indicator-nav" onClick={goNext} disabled={activeIndex >= pages.length - 1}><ChevronRight size={16} /></button>

        <div className="zoom-control">
          <input
            type="range"
            className="zoom-slider"
            min="0.5"
            max="3.0"
            step="0.1"
            value={scale}
            onChange={handleScaleChange}
          />
          <span className="zoom-label">{Math.round(scale * 100)}%</span>
        </div>

        {/* Single-page OCR progress */}
        {ocrProgress !== null && !isBatchRunning && (
          <div className="ocr-pill">
            <Sparkles size={12} className="ocr-pill-icon" />
            <div className="ocr-pill-info">
              <span className="ocr-pill-status">{ocrStatus}</span>
            </div>
            <div className="ocr-pill-bar-container">
              <div className="ocr-pill-bar" style={{ width: `${ocrProgress}%` }} />
            </div>
          </div>
        )}

        {/* Batch OCR progress with cancel */}
        {batchOCR && (
          <div className="ocr-pill">
            <Sparkles size={12} className="ocr-pill-icon" />
            <div className="ocr-pill-info">
              <span className="ocr-pill-status">{batchOCR.status}</span>
              <span className="ocr-pill-queue">{batchOCR.processed}/{batchOCR.total} pages</span>
            </div>
            <div className="ocr-pill-bar-container">
              <div className="ocr-pill-bar" style={{ width: `${(batchOCR.processed / batchOCR.total) * 100}%` }} />
            </div>
            <button className="ocr-pill-cancel" onClick={handleCancelBatch} title="Cancel batch OCR">
              <X size={10} />
            </button>
          </div>
        )}
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
        <button className="icon-btn" onClick={onRemove} style={{ width: '24px', height: '24px', color: 'var(--danger-color)' }}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};
