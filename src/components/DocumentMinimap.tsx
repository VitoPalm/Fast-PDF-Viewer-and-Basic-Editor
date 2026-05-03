import React, { useRef, useEffect, useCallback, useState } from 'react';
import { usePdf } from '../hooks/usePdf';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface DocumentMinimapProps {
  /** Height of the sidebar list area, for the viewport indicator */
  listHeight: number;
  /** Current scroll offset of the sidebar list */
  scrollOffset: number;
  /** Total scrollable height of the sidebar list */
  totalScrollHeight: number;
  /** Called when user clicks on the minimap to scroll to a position */
  onScrollTo: (pageIndex: number) => void;
}

export const DocumentMinimap: React.FC<DocumentMinimapProps> = ({
  listHeight,
  scrollOffset,
  totalScrollHeight,
  onScrollTo,
}) => {
  const { pages, activePageId, selectedPageIds } = usePdf();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showUpArrow, setShowUpArrow] = useState(false);
  const [showDownArrow, setShowDownArrow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const PAGE_LINE_HEIGHT = 3;
  const GAP = 1;
  const CANVAS_WIDTH = 24;
  const totalHeight = pages.length * (PAGE_LINE_HEIGHT + GAP);

  // Calculate viewport indicator position and size
  const viewportRatio = listHeight / Math.max(totalScrollHeight, 1);
  const viewportTop = (scrollOffset / Math.max(totalScrollHeight, 1)) * totalHeight;
  const viewportHeight = Math.max(viewportRatio * totalHeight, 12);

  // Sticky Scroll Logic: Keep the indicator within the minimap's visible area
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const visibleHeight = el.clientHeight;
    const currentScrollTop = el.scrollTop;

    if (viewportTop < currentScrollTop) {
      el.scrollTop = viewportTop;
    } else if (viewportTop + viewportHeight > currentScrollTop + visibleHeight) {
      el.scrollTop = viewportTop + viewportHeight - visibleHeight;
    }
  }, [viewportTop, viewportHeight]);

  // Update arrows visibility
  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowUpArrow(el.scrollTop > 5);
    setShowDownArrow(el.scrollTop + el.clientHeight < el.scrollHeight - 5);
  }, []);

  useEffect(() => {
    updateArrows();
  }, [pages.length, viewportTop, updateArrows]);

  // Draw the minimap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = CANVAS_WIDTH * window.devicePixelRatio;
    canvas.height = totalHeight * window.devicePixelRatio;
    canvas.style.width = `${CANVAS_WIDTH}px`;
    canvas.style.height = `${totalHeight}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.clearRect(0, 0, CANVAS_WIDTH, totalHeight);

    const activeIndex = pages.findIndex(p => p.id === activePageId);

    pages.forEach((page, i) => {
      const y = i * (PAGE_LINE_HEIGHT + GAP);
      const isActive = i === activeIndex;
      const isSelected = selectedPageIds.has(page.id);

      if (isActive) {
        ctx.fillStyle = '#6366f1'; // accent
      } else if (isSelected) {
        ctx.fillStyle = 'rgba(99, 102, 241, 0.6)';
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      }

      // Rounded-ish line
      ctx.beginPath();
      ctx.roundRect(2, y, CANVAS_WIDTH - 4, PAGE_LINE_HEIGHT, 1);
      ctx.fill();
    });
  }, [pages, activePageId, selectedPageIds, totalHeight]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const pageIndex = Math.floor(y / (PAGE_LINE_HEIGHT + GAP));
    if (pageIndex >= 0 && pageIndex < pages.length) {
      onScrollTo(pageIndex);
    }
  }, [pages.length, onScrollTo]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    handleClick(e);
  }, [handleClick]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    handleClick(e);
  }, [isDragging, handleClick]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      const up = () => setIsDragging(false);
      window.addEventListener('mouseup', up);
      return () => window.removeEventListener('mouseup', up);
    }
  }, [isDragging]);

  if (pages.length < 20) return null; // Don't show minimap for small docs

  return (
    <div className="minimap-wrapper">
      {showUpArrow && (
        <div className="minimap-scroll-indicator top">
          <ChevronUp size={14} />
        </div>
      )}
      <div
        ref={(el) => {
          (scrollRef as any).current = el;
          (containerRef as any).current = el;
        }}
        className="document-minimap"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onScroll={updateArrows}
      >
        <canvas ref={canvasRef} className="minimap-canvas" />
        <div
          className="minimap-viewport"
          style={{
            top: `${viewportTop}px`,
            height: `${viewportHeight}px`,
          }}
        />
      </div>
      {showDownArrow && (
        <div className="minimap-scroll-indicator bottom">
          <ChevronDown size={14} />
        </div>
      )}
    </div>
  );
};
