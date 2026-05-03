import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePdf } from '../hooks/usePdf';
import { useRenderEngine } from '../hooks/useRenderEngine';
import { v4 as uuidv4 } from 'uuid';
import { Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { type TextAnnotation } from '../types/pdf';

export const Workspace: React.FC = () => {
  const {
    pages, activePageId, setActivePageId, documents,
    annotations, addAnnotation, updateAnnotation, removeAnnotation
  } = usePdf();
  const { requestPage } = useRenderEngine();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale] = useState(1.5);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);

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

  const goToPage = useCallback((index: number) => {
    if (index >= 0 && index < pages.length) setActivePageId(pages[index].id);
  }, [pages, setActivePageId]);

  const goPrev = useCallback(() => goToPage(activeIndex - 1), [goToPage, activeIndex]);
  const goNext = useCallback(() => goToPage(activeIndex + 1), [goToPage, activeIndex]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (isEditingPageNum) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goPrev(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goNext(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goPrev, goNext, isEditingPageNum]);

  const handlePageNumberClick = () => {
    setIsEditingPageNum(true);
    setPageInputValue(String(activeIndex + 1));
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

  const handleContainerClick = (e: React.MouseEvent) => {
    if (e.target !== containerRef.current && e.target !== canvasRef.current) return;
    if (!activePageId) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const newAnnot: TextAnnotation = {
      id: uuidv4(),
      pageId: activePageId,
      text: 'New Text',
      x, y,
      fontSize: 16,
      color: '#ef4444'
    };
    addAnnotation(newAnnot);
    setActiveTextId(newAnnot.id);
  };

  if (!activePage) {
    return <div className="workspace-content" style={{ alignItems: 'center', color: 'var(--text-secondary)' }}>Select a page from the sidebar.</div>;
  }

  return (
    <div className="workspace-content" style={{ position: 'relative' }} onClick={() => setActiveTextId(null)}>
      <div
        ref={containerRef}
        className={`pdf-page-container ${isTransitioning ? 'transitioning' : ''} ${canvasReady ? 'ready' : ''}`}
        style={{ display: 'inline-block', position: 'relative' }}
        onClick={handleContainerClick}
      >
        <canvas ref={canvasRef} style={{ display: 'block' }} />
        {pageAnnotations.map(annot => (
          <DraggableText
            key={annot.id}
            annot={annot}
            isActive={activeTextId === annot.id}
            onSelect={() => setActiveTextId(annot.id)}
            onChange={(updates) => updateAnnotation(annot.id, updates)}
            onRemove={() => removeAnnotation(annot.id)}
          />
        ))}
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
      </div>
    </div>
  );
};

const DraggableText: React.FC<{
  annot: TextAnnotation;
  isActive: boolean;
  onSelect: () => void;
  onChange: (updates: Partial<TextAnnotation>) => void;
  onRemove: () => void;
}> = ({ annot, isActive, onSelect, onChange, onRemove }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    setIsDragging(true);
    setStartPos({ x: e.clientX - annot.x, y: e.clientY - annot.y });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    onChange({ x: e.clientX - startPos.x, y: e.clientY - startPos.y });
  }, [isDragging, startPos, onChange]);

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
        left: annot.x,
        top: annot.y,
        cursor: isDragging ? 'grabbing' : 'grab',
        border: isActive ? '1px dashed var(--accent-color)' : '1px solid transparent',
        padding: '4px',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
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
            fontSize: `${annot.fontSize}px`,
            fontFamily: 'var(--font-family)',
            fontWeight: 600,
            width: `${Math.max(50, annot.text.length * 10)}px`
          }}
        />
      ) : (
        <span style={{ color: annot.color, fontSize: `${annot.fontSize}px`, fontWeight: 600, whiteSpace: 'nowrap' }}>{annot.text}</span>
      )}
      {isActive && (
        <button className="icon-btn" onClick={onRemove} style={{ width: '24px', height: '24px', color: 'var(--danger-color)' }}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};
