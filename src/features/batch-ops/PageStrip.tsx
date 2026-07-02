import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { usePdf } from '../../shared/hooks/usePdf';
import { useRenderEngine } from '../pdf-engine/useRenderEngine';

interface PageStripProps {
  pageNumbers: number[];
}

const MAX_STRIP_ITEMS = 18;

const previewPageNumbers = (pageNumbers: number[]): number[] => {
  if (pageNumbers.length <= MAX_STRIP_ITEMS) return pageNumbers;

  const edgeCount = MAX_STRIP_ITEMS / 2;
  return [
    ...pageNumbers.slice(0, edgeCount),
    ...pageNumbers.slice(-edgeCount),
  ];
};

export const PageStrip: React.FC<PageStripProps> = ({ pageNumbers }) => {
  const { pages, documents, setActivePageId } = usePdf();
  const { requestThumbnail } = useRenderEngine();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stripPageNumbers = useMemo(() => previewPageNumbers(pageNumbers), [pageNumbers]);

  // Track which page numbers have their bitmap ready
  const [bitmaps, setBitmaps] = useState<Record<number, ImageBitmap>>({});
  
  // Deriving visiblePages from props
  const visiblePages = useMemo(() => new Set(stripPageNumbers), [stripPageNumbers]);

  // Handle bitmap cleanup asynchronously to avoid cascading render lint error
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setBitmaps(prev => {
        const numSet = new Set(stripPageNumbers);
        const next: Record<number, ImageBitmap> = {};
        let changed = false;
        for (const [key, bmp] of Object.entries(prev)) {
          if (numSet.has(Number(key))) {
            next[Number(key)] = bmp;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [stripPageNumbers]);

  // Render thumbnails for visible pages
  useEffect(() => {
    let cancelled = false;
    const renderAll = async () => {
      for (const pageNum of stripPageNumbers) {
        if (cancelled) break;
        if (bitmaps[pageNum]) continue;

        const pageInfo = pages[pageNum - 1];
        if (!pageInfo) continue;
        const doc = documents[pageInfo.docId];
        if (!doc) continue;

        try {
          const bitmap = await requestThumbnail(pageInfo.docId, doc.pdfjsDoc, pageInfo.originalPageIndex, 'high');
          if (!cancelled) {
            setBitmaps(prev => ({ ...prev, [pageNum]: bitmap }));
          }
        } catch {
          // Skip
        }
      }
    };
    renderAll();
    return () => { cancelled = true; };
  }, [stripPageNumbers, pages, documents, requestThumbnail, bitmaps]);

  const handleThumbnailClick = useCallback((pageNum: number) => {
    const pageInfo = pages[pageNum - 1];
    if (pageInfo) setActivePageId(pageInfo.id);
  }, [pages, setActivePageId]);

  if (pageNumbers.length === 0) return null;

  return (
    <div className="page-strip-container">
      <div className="page-strip" ref={scrollRef}>
        {stripPageNumbers.map((pageNum, index) => (
          <StripThumbnail
            key={`${pageNum}-${index}`}
            pageNum={pageNum}
            bitmap={bitmaps[pageNum]}
            isVisible={visiblePages.has(pageNum)}
            index={index}
            onClick={() => handleThumbnailClick(pageNum)}
          />
        ))}
      </div>
      {pageNumbers.length > stripPageNumbers.length && (
        <div className="page-strip-summary">
          Showing {stripPageNumbers.length} of {pageNumbers.length} pages
        </div>
      )}
    </div>
  );
};

const StripThumbnail: React.FC<{
  pageNum: number;
  bitmap: ImageBitmap | undefined;
  isVisible: boolean;
  index: number;
  onClick: () => void;
}> = ({ pageNum, bitmap, isVisible, index, onClick }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!bitmap || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(bitmap, 0, 0);
  }, [bitmap]);

  const animDelay = Math.min(index * 20, 300);

  return (
    <button
      type="button"
      className={`page-strip-item ${isVisible ? 'enter' : 'exit'}`}
      style={{ animationDelay: `${animDelay}ms` }}
      onClick={onClick}
      title={`Go to page ${pageNum}`}
      aria-label={`Go to page ${pageNum}`}
    >
      <div className="page-strip-item-inner">
        {bitmap ? (
          <canvas ref={canvasRef} className="page-strip-canvas" />
        ) : (
          <div className="page-strip-loading">
            <div className="page-strip-loading-shimmer" />
          </div>
        )}
      </div>
      <span className="page-strip-label">{pageNum}</span>
    </button>
  );
};

export default PageStrip;
