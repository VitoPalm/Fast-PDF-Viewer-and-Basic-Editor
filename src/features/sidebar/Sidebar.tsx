import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, type DragStart, type DropResult, type DraggableProvided } from '@hello-pangea/dnd';
import { Trash2, GripVertical, Check, RotateCcw, XSquare, CheckSquare, Sparkles } from 'lucide-react';
import { usePdf } from '../../shared/hooks/usePdf';
import { useRenderEngine } from '../pdf-engine/useRenderEngine';
import { PageRangeBar } from '../batch-ops/PageRangeBar';
import { DocumentMinimap } from './DocumentMinimap';
import { type PdfPageInfo } from '../pdf-engine/utils';
import './Sidebar.css';

const ITEM_HEIGHT = 88;
const OVERSCAN = 5;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const Sidebar: React.FC = () => {
  const {
    pages, activePageId, setActivePageId,
    removePageWithUndo, removePagesWithUndo, documents,
    selectedPageIds, togglePageSelection, selectPageRange,
    selectAll, clearSelection, invertSelection, setOcrQueue,
    reorderSelectedPages,
  } = usePdf();
  
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(600);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(240, e.clientX), 600);
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setContainerHeight(entry.contentRect.height);
    });
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollOffset / ITEM_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(pages.length - 1, Math.ceil((scrollOffset + containerHeight) / ITEM_HEIGHT) + OVERSCAN);
  const totalScrollHeight = pages.length * ITEM_HEIGHT;
  const virtualScrollHeight = totalScrollHeight + (draggingPageId ? ITEM_HEIGHT : 0);
  const activePageIndex = useMemo(
    () => pages.findIndex(page => page.id === activePageId),
    [pages, activePageId],
  );

  const setSidebarScrollTop = useCallback((nextScrollTop: number) => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const maxScrollTop = Math.max(totalScrollHeight - el.clientHeight, 0);
    const clampedScrollTop = clamp(nextScrollTop, 0, maxScrollTop);

    el.scrollTop = clampedScrollTop;
    setScrollOffset(clampedScrollTop);
  }, [totalScrollHeight]);

  const scrollPageIntoView = useCallback((pageIndex: number) => {
    const el = scrollContainerRef.current;
    if (!el || pageIndex < 0) return;

    const itemTop = pageIndex * ITEM_HEIGHT;
    const itemBottom = itemTop + ITEM_HEIGHT;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;

    if (itemTop >= viewTop && itemBottom <= viewBottom) return;

    const centeredScrollTop = itemTop - Math.max((el.clientHeight - ITEM_HEIGHT) / 2, 0);
    setSidebarScrollTop(centeredScrollTop);
  }, [setSidebarScrollTop]);

  useEffect(() => {
    if (activePageIndex === -1) return;

    scrollPageIntoView(activePageIndex);
  }, [activePageIndex, scrollPageIntoView]);

  const handleDragStart = useCallback((start: DragStart) => {
    setDraggingPageId(start.draggableId);
  }, []);

  const handleDragEnd = useCallback((result: DropResult) => {
    setDraggingPageId(null);

    if (
      result.reason === 'CANCEL' ||
      !result.destination ||
      result.destination.droppableId !== result.source.droppableId ||
      result.destination.index === result.source.index
    ) {
      return;
    }

    reorderSelectedPages(result.draggableId, result.destination.index);
  }, [reorderSelectedPages]);

  const handleItemClick = useCallback((index: number, e: React.MouseEvent) => {
    const page = pages[index];
    if (!page) return;

    if (e.ctrlKey || e.metaKey) {
      togglePageSelection(page.id);
      setLastClickedIndex(index);
    } else if (e.shiftKey && lastClickedIndex !== null) {
      selectPageRange(lastClickedIndex, index);
    } else {
      setActivePageId(page.id);
      setLastClickedIndex(index);
    }
  }, [pages, togglePageSelection, selectPageRange, setActivePageId, lastClickedIndex]);

  const { rangeInput, setRangeInput } = usePdf();

  const handleItemDoubleClick = useCallback((index: number) => {
    const pageNum = index + 1;
    const current = rangeInput.trim();
    
    let newVal: string;
    if (!current || current.endsWith(',')) {
      newVal = (current ? current + (current.endsWith(' ') ? '' : ' ') : '') + pageNum;
    } else {
      // Find the last "block" (e.g. "20-59" or "156")
      const parts = current.split(',');
      const lastPart = parts[parts.length - 1].trim();
      
      if (lastPart.includes('-')) {
        // Last part is already a range, just append
        newVal = current + ", " + pageNum;
      } else {
        const lastNum = parseInt(lastPart, 10);
        if (!isNaN(lastNum)) {
          // It's a single number, check order
          const start = Math.min(lastNum, pageNum);
          const end = Math.max(lastNum, pageNum);
          
          // Reconstruct string without the last number
          parts.pop();
          const base = parts.length > 0 ? parts.join(',') + ', ' : '';
          newVal = base + start + "-" + end;
        } else {
          newVal = current + ", " + pageNum;
        }
      }
    }
    setRangeInput(newVal);
  }, [rangeInput, setRangeInput]);

  const handleRemoveSelected = useCallback(() => {
    removePagesWithUndo(Array.from(selectedPageIds));
  }, [removePagesWithUndo, selectedPageIds]);

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      setScrollOffset(scrollContainerRef.current.scrollTop);
    }
  }, []);

  const handleMinimapScrollTo = useCallback((pageIndex: number) => {
    setSidebarScrollTop(pageIndex * ITEM_HEIGHT);
    if (pages[pageIndex]) {
      setActivePageId(pages[pageIndex].id);
    }
  }, [pages, setActivePageId, setSidebarScrollTop]);

  const hasSelection = selectedPageIds.size > 0;

  const visibleItems = useMemo(() => {
    const items: { page: PdfPageInfo; index: number }[] = [];
    for (let i = startIndex; i <= endIndex && i < pages.length; i++) {
      items.push({ page: pages[i], index: i });
    }
    return items;
  }, [pages, startIndex, endIndex]);

  return (
    <div className="sidebar-container" style={{ width: sidebarWidth }}>
      <div className="glass-panel sidebar" style={{ flex: 1, display: 'flex', flexDirection: 'column', zIndex: 10 }}>
        <div className="sidebar-header">
          <h3>Pages <span className="page-count-badge">{pages.length}</span></h3>
        </div>

        <PageRangeBar />

        <div className="sidebar-list-area">
          <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <Droppable droppableId="pages-list" mode="virtual"
              renderClone={(provided, snapshot, rubric) => {
                const page = pages[rubric.source.index];
                const isSelected = selectedPageIds.has(page?.id);
                return (
                  <ThumbnailItemContent
                    provided={provided}
                    page={page}
                    index={rubric.source.index}
                    isActive={activePageId === page?.id}
                    isSelected={isSelected}
                    isDragging={snapshot.isDragging}
                    docName={documents[page?.docId]?.name ?? ''}
                    onClick={() => {}}
                    onDoubleClick={() => {}}
                    onRemove={() => {}}
                  />
                );
              }}
            >
              {(droppableProvided) => (
                <div
                  ref={(el) => {
                    droppableProvided.innerRef(el);
                    (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                  }}
                  className="sidebar-scroll-container"
                  onScroll={handleScroll}
                  style={{ flex: 1, overflowY: 'auto', position: 'relative' }}
                >
                  <div style={{ height: virtualScrollHeight, position: 'relative' }}>
                    {visibleItems.map(({ page, index }) => (
                      <Draggable key={page.id} draggableId={page.id} index={index}>
                        {(provided, snapshot) => (
                          <ThumbnailItemContent
                            provided={provided}
                            page={page}
                            index={index}
                            isActive={activePageId === page.id}
                            isSelected={selectedPageIds.has(page.id)}
                            isDragging={snapshot.isDragging}
                            docName={documents[page.docId]?.name ?? ''}
                            onClick={(e) => handleItemClick(index, e)}
                            onDoubleClick={() => handleItemDoubleClick(index)}
                            onRemove={() => removePageWithUndo(page.id)}
                            style={{
                              position: 'absolute',
                              top: index * ITEM_HEIGHT,
                              left: 0,
                              right: 0,
                              height: ITEM_HEIGHT,
                            }}
                          />
                        )}
                      </Draggable>
                    ))}
                  </div>
                </div>
              )}
            </Droppable>
          </DragDropContext>

          <DocumentMinimap
            listHeight={containerHeight}
            scrollOffset={scrollOffset}
            totalScrollHeight={totalScrollHeight}
            onScrollTo={handleMinimapScrollTo}
          />
        </div>

        {hasSelection && (
          <div className="batch-toolbar">
            <span className="batch-toolbar-count">{selectedPageIds.size} selected</span>
            <div className="batch-toolbar-actions">
              <button className="batch-btn" onClick={handleRemoveSelected} title="Remove selected">
                <Trash2 size={14} />
              </button>
              <button className="batch-btn" onClick={selectAll} title="Select all">
                <CheckSquare size={14} />
              </button>
              <button className="batch-btn" onClick={invertSelection} title="Invert selection">
                <RotateCcw size={14} />
              </button>
              <button className="batch-btn" onClick={clearSelection} title="Clear selection">
                <XSquare size={14} />
              </button>
              <button className="batch-btn" style={{ color: 'var(--accent-color)' }} onClick={async () => {
                const selectedScanned = pages.filter(p => selectedPageIds.has(p.id) && p.analysis?.isScanned);
                if (selectedScanned.length === 0) {
                  alert("No scanned pages found in selection.");
                  return;
                }
                if (!confirm(`Run OCR on ${selectedScanned.length} pages? This might take a while.`)) return;

                // Start batch OCR in context
                const ids = selectedScanned.map(p => p.id);
                setOcrQueue(ids);
              }} title="OCR Selected Pages">
                <Sparkles size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
      <div className={`resize-handle ${isResizing ? 'active' : ''}`} onMouseDown={startResize} />
    </div>
  );
};

interface ThumbnailItemContentProps {
  provided: DraggableProvided;
  page: PdfPageInfo;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  isDragging: boolean;
  docName: string;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onRemove: () => void;
  style?: React.CSSProperties;
}

const ThumbnailItemContent: React.FC<ThumbnailItemContentProps> = ({ 
  provided, page, index, isActive, isSelected, isDragging, docName, onClick, onDoubleClick, onRemove, style 
}) => {
  // Destructuring outside the JSX to help some linters, though it's technically still "render time"
  const { innerRef, draggableProps, dragHandleProps } = provided;

  return (
    <div
      ref={innerRef}
      {...draggableProps}
      className={`thumbnail-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        ...style,
        ...draggableProps.style,
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className="thumbnail-item-inner">
        <div {...dragHandleProps} className="drag-handle">
          <GripVertical size={14} />
        </div>
        <div style={{ position: 'relative' }}>
          <LazyThumbnail page={page} />
          {(page.analysisStatus === 'pending' || page.analysisStatus === 'running') && (
            <div className="thumbnail-analysis-badge" title="Analyzing page">
              <Sparkles size={10} />
            </div>
          )}
          {page.analysisStatus === 'failed' && (
            <div className="thumbnail-analysis-badge failed" title={page.analysisError ?? 'Page analysis failed'}>
              !
            </div>
          )}
          {page.analysis?.isScanned && (
            <div className="thumbnail-ocr-badge" title="Scanned page (needs OCR)">
              <Sparkles size={10} />
            </div>
          )}
        </div>
        <div className="thumbnail-info">
          <div className="thumbnail-page-num">Page {index + 1}</div>
          <div className="thumbnail-doc-name" title={docName}>{docName}</div>
        </div>
        {isSelected && <div className="thumbnail-check"><Check size={12} /></div>}
        <button className="thumbnail-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove page">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

const LazyThumbnail: React.FC<{ page: PdfPageInfo }> = ({ page }) => {
  const { documents } = usePdf();
  const { requestThumbnail } = useRenderEngine();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const doc = documents[page.docId];
    if (!doc) return;
    requestThumbnail(page.docId, doc.pdfjsDoc, page.originalPageIndex, 'high')
      .then(bitmap => {
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(bitmap, 0, 0);
        setLoaded(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [page.docId, page.originalPageIndex, documents, requestThumbnail]);

  return (
    <div className="thumbnail-canvas-wrapper">
      <div className={`thumbnail-shimmer ${loaded ? 'fade-out' : ''}`} />
      <canvas ref={canvasRef} className={`thumbnail-canvas ${loaded ? 'loaded' : ''}`} />
    </div>
  );
};
