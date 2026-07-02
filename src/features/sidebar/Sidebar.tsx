import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, type DragStart, type DropResult, type DraggableProvided } from '@hello-pangea/dnd';
import { Trash2, GripVertical, Check, RotateCcw, XSquare, CheckSquare, Sparkles, AlertTriangle, FileSearch, Wrench } from 'lucide-react';
import { usePdf } from '../../shared/hooks/usePdf';
import { useRenderEngine } from '../pdf-engine/useRenderEngine';
import { PageRangeBar } from '../batch-ops/PageRangeBar';
import { DocumentMinimap } from './DocumentMinimap';
import { isAnalysisOcrCandidate, type PdfPageInfo } from '../pdf-engine/utils';
import { isSuspectTextHealth } from '../pdf-engine/textLayerHealth';
import { isImportJobBusy } from '../../context/importJob';
import { isOcrJobBusy } from '../../context/ocrJob';
import { isGlyphTextRepairJobBusy } from '../../context/glyphTextRepairJob';
import { isGlyphJobBusy } from '../../context/glyphRepairJob';
import './Sidebar.css';

const ITEM_HEIGHT = 88;
const OVERSCAN = 5;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const Sidebar: React.FC = () => {
  const {
    pages, activePageId, setActivePageId,
    removePageWithUndo, removePagesWithUndo, documents,
    selectedPageIds, togglePageSelection, selectPageRange,
    selectAll, clearSelection, invertSelection, startOcr,
    reorderSelectedPages, importJob, ocrJob, glyphJob, glyphTextRepairJob,
    repairGlyphTextPages, confirmAction,
  } = usePdf();
  
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(600);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [lastClickedPageId, setLastClickedPageId] = useState<string | null>(null);
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleResizeKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setSidebarWidth(prev => clamp(prev + (e.key === 'ArrowRight' ? 20 : -20), 240, 600));
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
      setLastClickedPageId(page.id);
    } else if (e.shiftKey && lastClickedPageId !== null) {
      const anchorIndex = pages.findIndex(candidate => candidate.id === lastClickedPageId);
      if (anchorIndex >= 0) {
        selectPageRange(anchorIndex, index);
      } else {
        setActivePageId(page.id);
        setLastClickedPageId(page.id);
      }
    } else {
      setActivePageId(page.id);
      setLastClickedPageId(page.id);
    }
  }, [lastClickedPageId, pages, togglePageSelection, selectPageRange, setActivePageId]);

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
  const isImportRunning = isImportJobBusy(importJob);
  const isOcrRunning = isOcrJobBusy(ocrJob);
  const isGlyphRunning = isGlyphJobBusy(glyphJob);
  const isTextRepairRunning = isGlyphTextRepairJobBusy(glyphTextRepairJob);
  const selectionBusyReason = isImportRunning
    ? 'Import running'
    : isOcrRunning
      ? 'OCR running'
      : isGlyphRunning
        ? 'Text check running'
        : isTextRepairRunning
          ? 'Text repair running'
          : null;
  const canRepairGlyphText = typeof window !== 'undefined' && typeof window.antigravityPdf?.repairGlyphText === 'function';
  const selectedOcrCandidates = useMemo(
    () => pages.filter(p => selectedPageIds.has(p.id) && isAnalysisOcrCandidate(p.analysis)),
    [pages, selectedPageIds],
  );
  const selectedTextRepairCandidates = useMemo(
    () => pages.filter(page => (
      selectedPageIds.has(page.id) &&
      page.glyphRepairStatus !== 'queued' &&
      page.glyphRepairStatus !== 'running' &&
      page.glyphRepairStatus !== 'complete' &&
      (
        Boolean(page.glyphDiagnostics?.deterministicCandidateFonts) ||
        page.glyphDiagnostics?.pages.some(glyphPage => (
          glyphPage.fonts.some(font => font.repairPlan === 'existing-to-unicode-needs-review')
        )) === true ||
        Boolean(page.ocrResult && page.analysis && isSuspectTextHealth(page.analysis.textHealth))
      )
    )),
    [pages, selectedPageIds],
  );
  const removeDisabledDescription = selectionBusyReason
    ? `${selectionBusyReason}; removing selected pages is disabled.`
    : null;
  const removeDisabledDescriptionId = 'sidebar-remove-disabled-reason';
  const ocrDisabledDescription = selectionBusyReason
    ? `${selectionBusyReason}; selected-page OCR is disabled.`
    : selectedOcrCandidates.length === 0
      ? 'No selected pages are ready for OCR.'
      : null;
  const ocrDisabledDescriptionId = 'sidebar-ocr-disabled-reason';
  const repairDisabledDescription = selectionBusyReason
    ? `${selectionBusyReason}; selected-page repair is disabled.`
    : !canRepairGlyphText
      ? 'Text repair is unavailable in this environment.'
      : selectedTextRepairCandidates.length === 0
        ? 'No selected pages are ready for text repair.'
        : null;
  const repairDisabledDescriptionId = 'sidebar-repair-disabled-reason';

  const handleOcrSelected = useCallback(async () => {
    if (selectionBusyReason) {
      alert(`${selectionBusyReason}; selected-page OCR is disabled.`);
      return;
    }
    if (selectedOcrCandidates.length === 0) {
      alert("No OCR candidates found in selection.");
      return;
    }

    const pageWord = selectedOcrCandidates.length === 1 ? 'page' : 'pages';
    const confirmed = await confirmAction({
      title: 'OCR selected pages?',
      message: `Run OCR on ${selectedOcrCandidates.length} selected ${pageWord}? You can keep browsing while OCR runs.`,
      confirmLabel: 'Run OCR',
    });
    if (!confirmed) return;

    void startOcr(selectedOcrCandidates.map(p => p.id), { mode: 'selected' });
  }, [confirmAction, selectedOcrCandidates, selectionBusyReason, startOcr]);

  const handleRepairSelected = useCallback(async () => {
    if (!canRepairGlyphText) {
      alert('Text repair is unavailable in this environment.');
      return;
    }
    if (selectionBusyReason) {
      alert(`${selectionBusyReason}; selected-page repair is disabled.`);
      return;
    }
    if (selectedTextRepairCandidates.length === 0) {
      alert('No selected pages are ready for text repair.');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Repair selected text?',
      message: `Repair selectable text on ${selectedTextRepairCandidates.length} selected page${selectedTextRepairCandidates.length === 1 ? '' : 's'}? Ambiguous pages will be skipped and successful repairs can be undone for a few seconds.`,
      confirmLabel: 'Repair text',
    });
    if (!confirmed) return;

    void repairGlyphTextPages(selectedTextRepairCandidates.map(page => page.id));
  }, [canRepairGlyphText, confirmAction, repairGlyphTextPages, selectedTextRepairCandidates, selectionBusyReason]);

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
                    totalPages={pages.length}
                    onClick={() => {}}
                    onOpen={() => {}}
                    onToggleSelect={() => {}}
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
                  role="list"
                  aria-label="Pages"
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
                            totalPages={pages.length}
                            onClick={(e) => handleItemClick(index, e)}
                            onOpen={() => {
                              setActivePageId(page.id);
                              setLastClickedPageId(page.id);
                            }}
                            onToggleSelect={() => {
                              togglePageSelection(page.id);
                              setLastClickedPageId(page.id);
                            }}
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
            {removeDisabledDescription && (
              <span id={removeDisabledDescriptionId} className="sr-only">{removeDisabledDescription}</span>
            )}
            {ocrDisabledDescription && (
              <span id={ocrDisabledDescriptionId} className="sr-only">{ocrDisabledDescription}</span>
            )}
            {repairDisabledDescription && (
              <span id={repairDisabledDescriptionId} className="sr-only">{repairDisabledDescription}</span>
            )}
            <div className="batch-toolbar-actions">
              <button className="batch-btn" onClick={handleRemoveSelected} disabled={Boolean(removeDisabledDescription)} title={removeDisabledDescription ?? 'Remove selected'} aria-describedby={removeDisabledDescription ? removeDisabledDescriptionId : undefined} aria-label="Remove selected pages">
                <Trash2 size={14} />
              </button>
              <button className="batch-btn" onClick={selectAll} title="Select all" aria-label="Select all pages">
                <CheckSquare size={14} />
              </button>
              <button className="batch-btn" onClick={invertSelection} title="Invert selection" aria-label="Invert page selection">
                <RotateCcw size={14} />
              </button>
              <button className="batch-btn" onClick={clearSelection} title="Clear selection" aria-label="Clear page selection">
                <XSquare size={14} />
              </button>
              <button
                className="batch-btn"
                style={{ color: 'var(--accent-color)' }}
                onClick={() => void handleOcrSelected()}
                disabled={Boolean(selectionBusyReason) || selectedOcrCandidates.length === 0}
                title={ocrDisabledDescription ?? `OCR ${selectedOcrCandidates.length} selected page${selectedOcrCandidates.length === 1 ? '' : 's'}`}
                aria-describedby={ocrDisabledDescription ? ocrDisabledDescriptionId : undefined}
                aria-label={`OCR ${selectedOcrCandidates.length} selected page${selectedOcrCandidates.length === 1 ? '' : 's'}`}
              >
                <Sparkles size={14} />
                <span>OCR</span>
              </button>
              <button
                className="batch-btn"
                style={{ color: 'var(--info-color)' }}
                onClick={() => void handleRepairSelected()}
                disabled={Boolean(selectionBusyReason) || !canRepairGlyphText || selectedTextRepairCandidates.length === 0}
                title={repairDisabledDescription ?? `Repair text on ${selectedTextRepairCandidates.length} selected page${selectedTextRepairCandidates.length === 1 ? '' : 's'}`}
                aria-describedby={repairDisabledDescription ? repairDisabledDescriptionId : undefined}
                aria-label={`Repair text on ${selectedTextRepairCandidates.length} selected page${selectedTextRepairCandidates.length === 1 ? '' : 's'}`}
              >
                <Wrench size={14} />
                <span>Repair</span>
              </button>
            </div>
          </div>
        )}
      </div>
      <div
        className={`resize-handle ${isResizing ? 'active' : ''}`}
        onMouseDown={startResize}
        onKeyDown={handleResizeKeyDown}
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize page sidebar"
        aria-valuemin={240}
        aria-valuemax={600}
        aria-valuenow={sidebarWidth}
      />
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
  totalPages: number;
  onClick: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onToggleSelect: () => void;
  onDoubleClick: () => void;
  onRemove: () => void;
  style?: React.CSSProperties;
}

type ThumbnailStatusKind = 'running' | 'failed' | 'warning' | 'info' | 'success';
type ThumbnailStatusIcon = 'analysis' | 'text' | 'ocr' | 'check' | 'repair';

interface ThumbnailPrimaryStatus {
  label: string;
  title: string;
  kind: ThumbnailStatusKind;
  icon: ThumbnailStatusIcon;
  showBadge: boolean;
}

const getThumbnailPrimaryStatus = (page: PdfPageInfo): ThumbnailPrimaryStatus | null => {
  if (page.glyphRepairStatus === 'failed') {
    return { label: 'Repair failed', title: page.glyphRepairError ?? 'Text repair failed', kind: 'failed', icon: 'repair', showBadge: true };
  }
  if (page.ocrStatus === 'failed') {
    return { label: 'OCR failed', title: page.ocrError ?? 'OCR failed', kind: 'failed', icon: 'ocr', showBadge: true };
  }
  if (page.glyphDiagnosticsStatus === 'failed') {
    return { label: 'Check failed', title: page.glyphDiagnosticsError ?? 'Text check failed', kind: 'failed', icon: 'check', showBadge: true };
  }
  if (page.analysisStatus === 'failed') {
    return { label: 'Analysis failed', title: page.analysisError ?? 'Page analysis failed', kind: 'failed', icon: 'analysis', showBadge: true };
  }
  if (page.glyphRepairStatus === 'queued' || page.glyphRepairStatus === 'running') {
    return { label: page.glyphRepairStatus === 'queued' ? 'Repair queued' : 'Repairing text', title: page.glyphRepairStatus === 'queued' ? 'Text repair queued' : 'Text repair in progress', kind: 'running', icon: 'repair', showBadge: true };
  }
  if (page.ocrStatus === 'queued' || page.ocrStatus === 'running') {
    return { label: page.ocrStatus === 'queued' ? 'OCR queued' : 'OCR running', title: page.ocrStatus === 'queued' ? 'OCR queued' : 'OCR in progress', kind: 'running', icon: 'ocr', showBadge: true };
  }
  if (page.glyphDiagnosticsStatus === 'queued' || page.glyphDiagnosticsStatus === 'running') {
    return { label: page.glyphDiagnosticsStatus === 'queued' ? 'Check queued' : 'Checking text', title: 'Text check in progress', kind: 'running', icon: 'check', showBadge: true };
  }
  if (page.ocrStatus === 'skipped') {
    return { label: 'OCR skipped', title: page.ocrError ?? 'OCR skipped', kind: 'warning', icon: 'ocr', showBadge: true };
  }
  if (page.glyphDiagnosticsStatus === 'skipped') {
    return { label: 'Check skipped', title: page.glyphDiagnosticsError ?? 'Text check skipped', kind: 'warning', icon: 'check', showBadge: true };
  }
  if (page.analysisStatus === 'pending') {
    return { label: 'Analysis pending', title: 'Page analysis pending', kind: 'info', icon: 'analysis', showBadge: false };
  }
  if (page.analysisStatus === 'running') {
    return { label: 'Analyzing page', title: 'Analyzing page', kind: 'running', icon: 'analysis', showBadge: true };
  }
  if (page.glyphRepairStatus === 'skipped') {
    return { label: 'Repair skipped', title: page.glyphRepairError ?? 'Text repair skipped', kind: 'warning', icon: 'repair', showBadge: true };
  }
  if (page.analysis && isSuspectTextHealth(page.analysis.textHealth)) {
    return { label: 'Text needs review', title: 'Text layer needs review', kind: 'warning', icon: 'text', showBadge: true };
  }
  if (!page.ocrResult && (!page.ocrStatus || page.ocrStatus === 'idle') && isAnalysisOcrCandidate(page.analysis)) {
    return { label: 'OCR candidate', title: getOcrCandidateBadgeTitle(page), kind: 'info', icon: 'ocr', showBadge: true };
  }
  if (page.glyphRepairStatus === 'complete' || page.glyphRepairReport) {
    return { label: 'Text repaired', title: 'Text repair complete', kind: 'success', icon: 'repair', showBadge: false };
  }
  if (page.ocrStatus === 'complete' || page.ocrResult) {
    return { label: 'OCR complete', title: 'OCR text added', kind: 'success', icon: 'ocr', showBadge: false };
  }
  if (page.glyphDiagnosticsStatus === 'complete' || page.glyphDiagnostics) {
    return { label: 'Text checked', title: 'Text check complete', kind: 'success', icon: 'check', showBadge: false };
  }
  return null;
};

const getThumbnailStatusText = (page: PdfPageInfo) => {
  const status = getThumbnailPrimaryStatus(page);
  return status ? [status.label] : [];
};

const getOcrCandidateBadgeTitle = (page: PdfPageInfo) => (
  page.analysis?.isScanned ? 'Scanned page (needs OCR)' : 'OCR candidate'
);

const ThumbnailStatusIconView: React.FC<{ icon: ThumbnailStatusIcon }> = ({ icon }) => {
  switch (icon) {
    case 'analysis':
    case 'ocr':
      return <Sparkles size={10} />;
    case 'check':
      return <FileSearch size={10} />;
    case 'repair':
      return <Wrench size={10} />;
    case 'text':
      return <AlertTriangle size={10} />;
  }
};

const ThumbnailItemContent: React.FC<ThumbnailItemContentProps> = ({
  provided, page, index, isActive, isSelected, isDragging, docName, totalPages, onClick, onOpen, onToggleSelect, onDoubleClick, onRemove, style
}) => {
  // Destructuring outside the JSX to help some linters, though it's technically still "render time"
  const { innerRef, draggableProps, dragHandleProps } = provided;
  const statusText = getThumbnailStatusText(page);
  const primaryStatus = getThumbnailPrimaryStatus(page);
  const statusDetailId = `thumbnail-status-detail-${page.id}`;
  const hasDetailedStatus = Boolean(primaryStatus && primaryStatus.title !== primaryStatus.label);
  const thumbnailLabel = [
    `Open page ${index + 1} from ${docName}`,
    isActive ? 'active page' : null,
    isSelected ? 'selected' : null,
    ...statusText,
  ].filter(Boolean).join(', ');

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
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={totalPages}
      aria-describedby={hasDetailedStatus ? statusDetailId : undefined}
    >
      <div className="thumbnail-item-inner">
        <div {...dragHandleProps} className="drag-handle" aria-label={`Drag page ${index + 1}`}>
          <GripVertical size={14} />
        </div>
        <div style={{ position: 'relative' }}>
          <LazyThumbnail page={page} />
          {primaryStatus?.showBadge && (
            <div className={`thumbnail-status-badge ${primaryStatus.kind}`} title={primaryStatus.title} aria-label={primaryStatus.label}>
              <ThumbnailStatusIconView icon={primaryStatus.icon} />
            </div>
          )}
        </div>
        <div className="thumbnail-info">
          {hasDetailedStatus && (
            <span id={statusDetailId} className="sr-only">{primaryStatus?.title}</span>
          )}
            <button
              type="button"
              className="thumbnail-open-button"
            onClick={(e) => {
              e.stopPropagation();
              if (e.ctrlKey || e.metaKey || e.shiftKey) {
                onClick(e);
              } else {
                onOpen();
              }
            }}
              aria-label={thumbnailLabel}
              aria-describedby={hasDetailedStatus ? statusDetailId : undefined}
              aria-current={isActive ? 'page' : undefined}
            >
            <span className="thumbnail-page-num">Page {index + 1}</span>
            <span className="thumbnail-doc-name" title={docName}>{docName}</span>
            {primaryStatus && (
              <span className={`thumbnail-status-line ${primaryStatus.kind}`} title={primaryStatus.title}>
                {primaryStatus.label}
              </span>
            )}
          </button>
        </div>
        <button
          className={`thumbnail-select-toggle ${isSelected ? 'selected' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          type="button"
          aria-label={`${isSelected ? 'Deselect' : 'Select'} page ${index + 1}`}
          aria-pressed={isSelected}
          title={isSelected ? 'Deselect page' : 'Select page'}
        >
          {isSelected && <Check size={12} />}
        </button>
        <button className="thumbnail-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove page" aria-label={`Remove page ${index + 1}`}>
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
