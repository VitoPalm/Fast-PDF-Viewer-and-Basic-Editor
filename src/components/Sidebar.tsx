import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Trash2, GripVertical, Check, RotateCcw, XSquare, CheckSquare } from 'lucide-react';
import { usePdf } from '../context/PdfContext';
import { useRenderEngine } from '../hooks/useRenderEngine';
import { PageRangeBar } from './PageRangeBar';
import { DocumentMinimap } from './DocumentMinimap';

const ITEM_HEIGHT = 88;
const OVERSCAN = 5;

export const Sidebar: React.FC = () => {
  const {
    pages, setPages, activePageId, setActivePageId,
    removePage, removePages, documents,
    selectedPageIds, togglePageSelection, selectPageRange,
    selectAll, clearSelection, invertSelection
  } = usePdf();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(600);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  // Measure container
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

  // Compute visible range
  const startIndex = Math.max(0, Math.floor(scrollOffset / ITEM_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(pages.length - 1, Math.ceil((scrollOffset + containerHeight) / ITEM_HEIGHT) + OVERSCAN);
  const totalScrollHeight = pages.length * ITEM_HEIGHT;

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const items = Array.from(pages);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setPages(items);
  };

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

  const handleRemoveSelected = useCallback(() => {
    removePages(Array.from(selectedPageIds));
  }, [removePages, selectedPageIds]);

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      setScrollOffset(scrollContainerRef.current.scrollTop);
    }
  }, []);

  const handleMinimapScrollTo = useCallback((pageIndex: number) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = pageIndex * ITEM_HEIGHT;
    }
    if (pages[pageIndex]) {
      setActivePageId(pages[pageIndex].id);
    }
  }, [pages, setActivePageId]);

  const hasSelection = selectedPageIds.size > 0;

  // Build the visible items list
  const visibleItems = useMemo(() => {
    const items: { page: typeof pages[0]; index: number }[] = [];
    for (let i = startIndex; i <= endIndex && i < pages.length; i++) {
      items.push({ page: pages[i], index: i });
    }
    return items;
  }, [pages, startIndex, endIndex]);

  return (
    <div className="glass-panel sidebar" style={{ width: '300px', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
      {/* Header */}
      <div className="sidebar-header">
        <h3>Pages <span className="page-count-badge">{pages.length}</span></h3>
      </div>

      {/* Page Range Bar */}
      <PageRangeBar />

      {/* Virtualized page list with minimap */}
      <div className="sidebar-list-area">
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="pages-list" mode="virtual"
            renderClone={(provided, snapshot, rubric) => {
              const page = pages[rubric.source.index];
              return (
                <ThumbnailItemContent
                  provided={provided}
                  page={page}
                  index={rubric.source.index}
                  isActive={activePageId === page?.id}
                  isSelected={selectedPageIds.has(page?.id)}
                  isDragging={snapshot.isDragging}
                  docName={documents[page?.docId]?.name ?? ''}
                  onClick={() => {}}
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
                {/* Spacer for total height */}
                <div style={{ height: totalScrollHeight, position: 'relative' }}>
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
                          onRemove={() => removePage(page.id)}
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
                {droppableProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {/* Minimap */}
        <DocumentMinimap
          listHeight={containerHeight}
          scrollOffset={scrollOffset}
          totalScrollHeight={totalScrollHeight}
          onScrollTo={handleMinimapScrollTo}
        />
      </div>

      {/* Batch action toolbar */}
      {hasSelection && (
        <div className="batch-toolbar">
          <span className="batch-toolbar-count">
            {selectedPageIds.size} selected
          </span>
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
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Thumbnail item (shared between virtual list and drag clone)
// ---------------------------------------------------------------------------
const ThumbnailItemContent: React.FC<{
  provided: any;
  page: any;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  isDragging: boolean;
  docName: string;
  onClick: (e: React.MouseEvent) => void;
  onRemove: () => void;
  style?: React.CSSProperties;
}> = ({ provided, page, index, isActive, isSelected, isDragging, docName, onClick, onRemove, style }) => {
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      className={`thumbnail-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        ...style,
        ...provided.draggableProps.style,
      }}
      onClick={onClick}
    >
      <div className="thumbnail-item-inner">
        <div {...provided.dragHandleProps} className="drag-handle">
          <GripVertical size={14} />
        </div>

        <LazyThumbnail page={page} />

        <div className="thumbnail-info">
          <div className="thumbnail-page-num">Page {index + 1}</div>
          <div className="thumbnail-doc-name" title={docName}>{docName}</div>
        </div>

        {isSelected && (
          <div className="thumbnail-check">
            <Check size={12} />
          </div>
        )}

        <button
          className="thumbnail-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove page"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Lazy-rendered thumbnail using the render engine
// ---------------------------------------------------------------------------
const LazyThumbnail: React.FC<{ page: any }> = ({ page }) => {
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
      <canvas ref={canvasRef} className={`thumbnail-canvas ${loaded ? 'loaded' : ''}`} />
      {!loaded && <div className="thumbnail-shimmer" />}
    </div>
  );
};
