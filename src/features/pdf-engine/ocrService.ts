import { createWorker, createScheduler } from 'tesseract.js';

export interface OCRResult {
  text: string;
  items: Array<{
    str: string;
    width: number;
    height: number;
    transform: number[];
  }>;
}

interface RawOCRLineItem {
  str: string;
  bbox: Tesseract.Bbox;
  originalWords: Tesseract.Word[];
}

interface DropCapCandidate {
  symbol: Tesseract.Symbol;
  sourceItem: RawOCRLineItem;
  newSourceX0: number;
}

export class OCRService {
  // Single worker for single-page OCR (with progress reporting)
  private static singleWorker: Tesseract.Worker | null = null;
  private static singleInitPromise: Promise<Tesseract.Worker> | null = null;
  private static currentSingleLangs: string = 'eng';
  private static onProgress: ((progress: number) => void) | null = null;

  // Scheduler pool for parallel batch OCR
  private static scheduler: Tesseract.Scheduler | null = null;
  private static schedulerInitPromise: Promise<Tesseract.Scheduler> | null = null;
  private static currentSchedulerLangs: string = 'eng';

  static readonly POOL_SIZE = Math.max(2, Math.min(
    navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 : 2,
    4
  ));

  private static readonly WORKER_CONFIG = {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.1.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.0/tesseract-core-simd.wasm.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
  };

  private static async getSingleWorker(langs: string = 'eng') {
    if (this.singleWorker && this.currentSingleLangs === langs) return this.singleWorker;
    if (this.singleInitPromise && this.currentSingleLangs === langs) return this.singleInitPromise;

    if (this.singleWorker) {
      await this.singleWorker.terminate();
      this.singleWorker = null;
    }

    this.currentSingleLangs = langs;
    this.singleInitPromise = (async () => {
      const w = await createWorker(langs, 1, {
        ...this.WORKER_CONFIG,
        logger: m => {
          if (m.status === 'recognizing text' && this.onProgress) {
            this.onProgress(m.progress * 100);
          }
        },
      });
      this.singleWorker = w;
      return w;
    })();

    return this.singleInitPromise;
  }

  private static async getScheduler(langs: string = 'eng') {
    if (this.scheduler && this.currentSchedulerLangs === langs) return this.scheduler;
    if (this.schedulerInitPromise && this.currentSchedulerLangs === langs) return this.schedulerInitPromise;

    if (this.scheduler) {
      await this.scheduler.terminate();
      this.scheduler = null;
    }

    this.currentSchedulerLangs = langs;
    this.schedulerInitPromise = (async () => {
      const sched = createScheduler();
      const promises = Array.from({ length: this.POOL_SIZE }, async () => {
        const w = await createWorker(langs, 1, this.WORKER_CONFIG);
        sched.addWorker(w);
      });
      await Promise.all(promises);
      this.scheduler = sched;
      return sched;
    })();

    return this.schedulerInitPromise;
  }

  static async preInitialize() {
    await this.getSingleWorker('eng');
  }

  /** Single page OCR with per-page progress reporting */
  static async performOCR(
    image: ImageBitmap | HTMLCanvasElement,
    onProgress?: (progress: number) => void,
    langs: string = 'eng'
  ): Promise<OCRResult> {
    const worker = await this.getSingleWorker(langs);
    this.onProgress = onProgress || null;

    try {
      const { data } = await worker.recognize(image);
      this.onProgress = null;
      return this.processResult(data);
    } catch (err) {
      this.onProgress = null;
      throw err;
    }
  }

  /** Batch page OCR — uses worker pool for parallel processing. No per-page progress. */
  static async performBatchPageOCR(
    image: ImageBitmap | HTMLCanvasElement,
    langs: string = 'eng'
  ): Promise<OCRResult> {
    const scheduler = await this.getScheduler(langs);
    const { data } = await scheduler.addJob('recognize', image);
    return this.processResult(data);
  }

  /**
   * Process Tesseract result data into OCRResult.
   * Groups text by LINES (not words) so that copied text includes spaces.
   */
  private static processResult(data: Tesseract.Page): OCRResult {
    const rawItems: RawOCRLineItem[] = [];

    data.blocks?.forEach((block) => {
      block.paragraphs.forEach((paragraph) => {
        paragraph.lines.forEach((line) => {
          if (!line.words || line.words.length === 0) return;

          const lineText = line.words.map((word) => word.text).join(' ');

          const heights = line.words.map((word) => word.bbox.y1 - word.bbox.y0);
          heights.sort((a: number, b: number) => a - b);

          const mid = Math.floor(heights.length / 2);
          const medianHeight = heights.length % 2 === 0
            ? (heights[mid - 1] + heights[mid]) / 2
            : heights[mid];

          const normalWords = line.words.filter((word) => {
            const h = word.bbox.y1 - word.bbox.y0;
            return h <= medianHeight * 1.5;
          });

          const referenceWords = normalWords.length > 0 ? normalWords : line.words;

          const y0 = Math.min(...referenceWords.map((word) => word.bbox.y0));
          const y1 = Math.max(...referenceWords.map((word) => word.bbox.y1));
          const x0 = Math.min(...line.words.map((word) => word.bbox.x0));
          const x1 = Math.max(...line.words.map((word) => word.bbox.x1));

          rawItems.push({
            str: lineText,
            bbox: { x0, y0, x1, y1 },
            originalWords: line.words
          });
        });
      });
    });

    // --- Drop Cap Repair Algorithm ---
    const itemHeights = rawItems.map(item => item.bbox.y1 - item.bbox.y0).sort((a, b) => a - b);
    const globalMedianHeight = itemHeights.length > 0 ? itemHeights[Math.floor(itemHeights.length / 2)] : 15;

    const dropCaps: DropCapCandidate[] = [];
    rawItems.forEach(item => {
      item.originalWords.forEach((word, wordIndex) => {
        if (!word.symbols || word.symbols.length === 0) return;
        const sym = word.symbols[0]; // Drop caps are the first letter

        const h = sym.bbox.y1 - sym.bbox.y0;
        // Criteria: Very tall (>= 1.8x median), alphabetical, and near the left edge of the line
        if (h >= globalMedianHeight * 1.8 && /[A-Za-z]/.test(sym.text)) {
          if (sym.bbox.x0 <= item.bbox.x0 + 50) {

            // Calculate where the remaining text in the line actually starts
            const newX0 = (() => {
              if (word.symbols.length > 1) {
                // The drop cap was part of a merged word (e.g. "Lcompiti"). The new x0 is the 'c'.
                return word.symbols[1].bbox.x0;
              }
              if (wordIndex + 1 < item.originalWords.length) {
                // The drop cap was its own word. The new x0 is the start of the next word.
                return item.originalWords[wordIndex + 1].bbox.x0;
              }
              // The drop cap was the only thing on the line.
              return sym.bbox.x1;
            })();

            dropCaps.push({ symbol: sym, sourceItem: item, newSourceX0: newX0 });
          }
        }
      });
    });

    dropCaps.forEach(({ symbol, sourceItem, newSourceX0 }) => {
      if (sourceItem.str.startsWith(symbol.text)) {
        // 1. Extract the drop cap from its current misplaced line
        sourceItem.str = sourceItem.str.substring(symbol.text.length).trimStart();

        // Fix the visual start point of the line we just cut the drop cap from
        sourceItem.bbox.x0 = newSourceX0;

        // 2. Find the true target line (the one horizontally adjacent to the top of the drop cap)
        let bestTarget: RawOCRLineItem | null = null;
        let minVertDist = Infinity;

        for (const item of rawItems) {
          if (item.bbox.x1 > symbol.bbox.x0) {
            const vertDist = Math.abs(item.bbox.y0 - symbol.bbox.y0);
            if (vertDist < minVertDist && vertDist < globalMedianHeight * 1.5) {
              minVertDist = vertDist;
              bestTarget = item;
            }
          }
        }

        // 3. Prepend the drop cap to the correct target line
        if (bestTarget) {
          const startsWithLower = /^[a-zà-öø-ÿ]/.test(bestTarget.str);
          const space = startsWithLower ? '' : ' ';
          bestTarget.str = symbol.text + space + bestTarget.str;
          bestTarget.bbox.x0 = Math.min(bestTarget.bbox.x0, symbol.bbox.x0);
        } else {
          // Fallback: put it back if no valid target
          sourceItem.str = symbol.text + sourceItem.str;
          // Revert the x0 shift if we failed to move it
          sourceItem.bbox.x0 = Math.min(sourceItem.bbox.x0, symbol.bbox.x0);
        }
      }
    });

    // Map to final format
    const items = rawItems
      .filter(item => item.str.trim().length > 0)
      .map(item => ({
        str: item.str,
        width: item.bbox.x1 - item.bbox.x0,
        height: item.bbox.y1 - item.bbox.y0,
        transform: [1, 0, 0, 1, item.bbox.x0, item.bbox.y0]
      }));

    return { text: data.text, items };
  }

  static async terminate() {
    if (this.singleWorker) {
      await this.singleWorker.terminate();
      this.singleWorker = null;
      this.singleInitPromise = null;
    }
    if (this.scheduler) {
      await this.scheduler.terminate();
      this.scheduler = null;
      this.schedulerInitPromise = null;
    }
  }
}
