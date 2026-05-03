import { useRef, useCallback, useEffect } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Priority = 'urgent' | 'high' | 'low';

interface RenderRequest {
  key: string;
  pdfjsDoc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  priority: Priority;
  resolve: (bitmap: ImageBitmap) => void;
  reject: (err: unknown) => void;
}

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------
class LRUCache<V extends { close?: () => void }> {
  private map = new Map<string, V>();
  private maxSize: number;
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        const evicted = this.map.get(oldest);
        this.map.delete(oldest);
        if (evicted && typeof evicted.close === 'function') {
          evicted.close();
        }
      }
    }
  }

  has(key: string) { return this.map.has(key); }
  clear() {
    this.map.forEach(v => {
      if (v && typeof v.close === 'function') v.close();
    });
    this.map.clear();
  }
}

// ---------------------------------------------------------------------------
// Render Engine
// ---------------------------------------------------------------------------
class RenderEngine {
  private thumbCache = new LRUCache<ImageBitmap>(250);
  private fullCache  = new LRUCache<ImageBitmap>(8);
  private queue: RenderRequest[] = [];
  private processing = false;
  private rafId: number | null = null;
  private disposed = false;

  private offscreen: HTMLCanvasElement = document.createElement('canvas');

  private static PRIORITY_ORDER: Record<Priority, number> = { urgent: 0, high: 1, low: 2 };

  private cacheKey(docId: string, pageNumber: number, scale: number) {
    return `${docId}:${pageNumber}:${scale.toFixed(2)}`;
  }

  private getCache(scale: number) {
    return scale <= 0.3 ? this.thumbCache : this.fullCache;
  }

  requestRender(
    docId: string,
    pdfjsDoc: PDFDocumentProxy,
    pageNumber: number,
    scale: number,
    priority: Priority = 'low'
  ): Promise<ImageBitmap> {
    const key = this.cacheKey(docId, pageNumber, scale);
    const cache = this.getCache(scale);
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);

    const existing = this.queue.find(r => r.key === key);
    if (existing) {
      if (RenderEngine.PRIORITY_ORDER[priority] < RenderEngine.PRIORITY_ORDER[existing.priority]) {
        existing.priority = priority;
        this.sortQueue();
      }
      return new Promise((resolve, reject) => {
        const origResolve = existing.resolve;
        const origReject = existing.reject;
        existing.resolve = (bmp) => { origResolve(bmp); resolve(bmp); };
        existing.reject = (err) => { origReject(err); reject(err); };
      });
    }

    return new Promise<ImageBitmap>((resolve, reject) => {
      this.queue.push({ key, pdfjsDoc, pageNumber, scale, priority, resolve, reject });
      this.sortQueue();
      this.scheduleProcessing();
    });
  }

  cancelForDoc(docId: string) {
    this.queue = this.queue.filter(r => {
      if (r.key.startsWith(docId + ':')) {
        r.reject(new Error('cancelled'));
        return false;
      }
      return true;
    });
  }

  preloadRange(docId: string, pdfjsDoc: PDFDocumentProxy, startPage: number, endPage: number, scale = 0.15) {
    for (let i = startPage; i <= endPage; i++) {
      const key = this.cacheKey(docId, i, scale);
      if (!this.getCache(scale).has(key)) {
        this.requestRender(docId, pdfjsDoc, i, scale, 'low').catch(() => {});
      }
    }
  }

  private sortQueue() {
    this.queue.sort((a, b) => RenderEngine.PRIORITY_ORDER[a.priority] - RenderEngine.PRIORITY_ORDER[b.priority]);
  }

  private scheduleProcessing() {
    if (this.processing || this.disposed) return;
    const next = this.queue[0];
    if (!next) return;
    if (next.priority === 'low' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => this.processNext(), { timeout: 200 });
    } else {
      this.rafId = requestAnimationFrame(() => this.processNext());
    }
  }

  private async processNext() {
    if (this.disposed || this.queue.length === 0) {
      this.processing = false;
      return;
    }
    this.processing = true;
    const request = this.queue.shift()!;

    try {
      const cache = this.getCache(request.scale);
      const cached = cache.get(request.key);
      if (cached) {
        request.resolve(cached);
      } else {
        const bitmap = await this.renderToBitmap(request.pdfjsDoc, request.pageNumber, request.scale);
        cache.set(request.key, bitmap);
        request.resolve(bitmap);
      }
    } catch (err) {
      request.reject(err);
    }

    this.processing = false;
    if (this.queue.length > 0) this.scheduleProcessing();
  }

  private async renderToBitmap(pdfjsDoc: PDFDocumentProxy, pageNumber: number, scale: number): Promise<ImageBitmap> {
    const page = await pdfjsDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    this.offscreen.width = Math.ceil(viewport.width);
    this.offscreen.height = Math.ceil(viewport.height);

    const ctx = this.offscreen.getContext('2d', { willReadFrequently: false })!;
    ctx.clearRect(0, 0, this.offscreen.width, this.offscreen.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      canvas: this.offscreen,
    }).promise;

    return createImageBitmap(this.offscreen);
  }

  dispose() {
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.queue.forEach(r => r.reject(new Error('disposed')));
    this.queue = [];
    this.thumbCache.clear();
    this.fullCache.clear();
  }
}

export function useRenderEngine() {
  const engineRef = useRef<RenderEngine | null>(null);

  const getEngine = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new RenderEngine();
    }
    return engineRef.current;
  }, []);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const requestThumbnail = useCallback(
    (docId: string, pdfjsDoc: PDFDocumentProxy, pageNumber: number, priority: Priority = 'high') => {
      return getEngine().requestRender(docId, pdfjsDoc, pageNumber, 0.2, priority);
    },
    [getEngine]
  );

  const requestPage = useCallback(
    (docId: string, pdfjsDoc: PDFDocumentProxy, pageNumber: number, scale = 1.5, priority: Priority = 'urgent') => {
      return getEngine().requestRender(docId, pdfjsDoc, pageNumber, scale, priority);
    },
    [getEngine]
  );

  const preloadRange = useCallback(
    (docId: string, pdfjsDoc: PDFDocumentProxy, startPage: number, endPage: number) => {
      getEngine().preloadRange(docId, pdfjsDoc, startPage, endPage, 0.2);
    },
    [getEngine]
  );

  const cancelForDoc = useCallback((docId: string) => {
    engineRef.current?.cancelForDoc(docId);
  }, []);

  return { requestThumbnail, requestPage, preloadRange, cancelForDoc };
}
