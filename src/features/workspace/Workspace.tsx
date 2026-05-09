import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePdf } from '../../shared/hooks/usePdf';
import { useRenderEngine } from '../pdf-engine/useRenderEngine';
import { Trash2, ChevronLeft, ChevronRight, Plus, Download } from 'lucide-react';
import { type TextAnnotation } from '../../shared/types/pdf';
import { exportModifiedPdf } from '../pdf-engine/utils';
import './Workspace.css';

export const Workspace: React.FC = () => {
  const {
    pages, activePageId, setActivePageId, documents,
    annotations, updateAnnotation, removeAnnotation,
    addFiles, clearAll
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
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const [pageInputValue, setPageInputValue] = useState('');
  const [isEditingPageNum, setIsEditingPageNum] = useState(false);
  const pageInputRef = useRef<HTMLInputElement>(null);

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
        const bitmap = await requestPage(activePage.docId, docInfo.pdfjsDoc, activePage.originalPageIndex, scale, 'urgent');
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(bitmap, 0, 0);
        setCanvasReady(true);
        requestAnimationFrame(() => {
          if (!cancelled) setIsTransitioning(false);
        });
      } catch {
        if (!cancelled) setIsTransitioning(false);
      }
    };
    render();
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
    if (e.target !== containerRef.current && e.target !== canvasRef.current) return;

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

  // Wheel handler with passive: false so we can preventDefault for page switches
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 10) {
        const isAtLeftEdge = el.scrollLeft <= 5;
        const isAtRightEdge = el.scrollLeft + el.clientWidth >= el.scrollWidth - 5;
        
        // The canvas width already includes the scale (rendered at that scale)
        const currentScaledWidth = (canvasRef.current?.width || 0) / (window.devicePixelRatio || 1);
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
  }, [goNext, goPrev]);

  const handleScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setScale(Math.min(3.0, Math.max(0.5, val)));
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
        </div>
        <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
          <button className="btn btn-secondary" onClick={clearAll}>Start Over</button>
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
        <div
          ref={containerRef}
          className={`pdf-page-container ${isTransitioning ? 'transitioning' : ''} ${canvasReady ? 'ready' : ''} ${isPanning ? 'panning' : ''}`}
          style={{ flexShrink: 0, margin: 'auto' }}
          onMouseDown={handleMouseDown}
        >
          <canvas ref={canvasRef} style={{ display: 'block' }} />
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
