import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { usePdf } from '../../shared/hooks/usePdf';
import { useRenderEngine } from '../pdf-engine/useRenderEngine';

interface PageStripProps {
  pageNumbers: number[];
}

export const PageStrip: React.FC<PageStripProps> = ({ pageNumbers }) => {
  const { pages, documents, setActivePageId } = usePdf();
  const { requestThumbnail } = useRenderEngine();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track which page numbers have their bitmap ready
  const [bitmaps, setBitmaps] = useState<Record<number, ImageBitmap>>({});
  
  // Deriving visiblePages from props
  const visiblePages = useMemo(() => new Set(pageNumbers), [pageNumbers]);

  // Handle bitmap cleanup asynchronously to avoid cascading render lint error
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setBitmaps(prev => {
        const numSet = new Set(pageNumbers);
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
  }, [pageNumbers]);

  // Render thumbnails for visible pages
  useEffect(() => {
    let cancelled = false;
    const renderAll = async () => {
      for (const pageNum of pageNumbers) {
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
  }, [pageNumbers, pages, documents, requestThumbnail, bitmaps]);

  const handleThumbnailClick = useCallback((pageNum: number) => {
    const pageInfo = pages[pageNum - 1];
    if (pageInfo) setActivePageId(pageInfo.id);
  }, [pages, setActivePageId]);

  if (pageNumbers.length === 0) return null;

  return (
    <div className="page-strip-container">
      <div className="page-strip" ref={scrollRef}>
        {pageNumbers.map((pageNum, index) => (
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
    <div
      className={`page-strip-item ${isVisible ? 'enter' : 'exit'}`}
      style={{ animationDelay: `${animDelay}ms` }}
      onClick={onClick}
      title={`Page ${pageNum}`}
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
    </div>
  );
};

export default PageStrip;
