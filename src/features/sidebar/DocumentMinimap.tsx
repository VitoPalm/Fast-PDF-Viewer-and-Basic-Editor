import React, { useRef, useEffect, useCallback, useState } from 'react';
import { usePdf } from '../../shared/hooks/usePdf';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { getMinimapPageIndexFromPoint, getMinimapViewport } from './minimapMath';
import './Minimap.css';

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showUpArrow, setShowUpArrow] = useState(false);
  const [showDownArrow, setShowDownArrow] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const PAGE_LINE_HEIGHT = 3;
  const GAP = 1;
  const CANVAS_WIDTH = 24;
  const {
    totalHeight,
    top: viewportTop,
    height: viewportHeight,
  } = getMinimapViewport({
    pageCount: pages.length,
    pageLineHeight: PAGE_LINE_HEIGHT,
    gap: GAP,
    listHeight,
    listScrollOffset: scrollOffset,
    listTotalHeight: totalScrollHeight,
  });

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

  const scrollToClientY = useCallback((clientY: number) => {
    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const pageIndex = getMinimapPageIndexFromPoint({
      clientY,
      containerTop: rect.top,
      minimapScrollTop: el.scrollTop,
      pageCount: pages.length,
      pageLineHeight: PAGE_LINE_HEIGHT,
      gap: GAP,
    });

    if (pageIndex !== null) {
      onScrollTo(pageIndex);
    }
  }, [pages.length, onScrollTo]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    scrollToClientY(e.clientY);
  }, [scrollToClientY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    scrollToClientY(e.clientY);
  }, [isDragging, scrollToClientY]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      const move = (e: MouseEvent) => scrollToClientY(e.clientY);
      const up = () => setIsDragging(false);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      return () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
    }
  }, [isDragging, scrollToClientY]);

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
          scrollRef.current = el;
          containerRef.current = el;
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
