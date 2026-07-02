import { describe, expect, it } from 'vitest';
import { type PageAnalysis, type PdfPageInfo } from '../features/pdf-engine/utils';
import {
  applyPageOcrResultForJob,
  applyPageOcrStatusForJob,
  createIdleOcrJob,
  getOcrCandidatePages,
  getOcrJobProgress,
  ocrJobReducer,
} from './ocrJob';

const scannedAnalysis: PageAnalysis = {
  hasText: false,
  hasOCR: false,
  isScanned: true,
  textHealth: 'imageOnly',
  textHealthReasons: ['no-text'],
  textItemCount: 0,
  textSample: '',
};

const healthyAnalysis: PageAnalysis = {
  hasText: true,
  hasOCR: false,
  isScanned: false,
  textHealth: 'healthy',
  textHealthReasons: [],
  textItemCount: 12,
  textSample: 'Readable page text',
};

const suspectAnalysis: PageAnalysis = {
  hasText: true,
  hasOCR: false,
  isScanned: false,
  textHealth: 'suspectEncoding',
  textHealthReasons: ['replacement-characters'],
  textItemCount: 24,
  textSample: 'Broken text',
};

const pages: PdfPageInfo[] = [
  {
    id: 'scanned',
    docId: 'doc',
    originalPageIndex: 1,
    analysis: scannedAnalysis,
  },
  {
    id: 'text',
    docId: 'doc',
    originalPageIndex: 2,
    analysis: healthyAnalysis,
  },
  {
    id: 'running',
    docId: 'doc',
    originalPageIndex: 3,
    analysis: scannedAnalysis,
    ocrStatus: 'running',
  },
  {
    id: 'suspect',
    docId: 'doc',
    originalPageIndex: 4,
    analysis: suspectAnalysis,
  },
];

describe('ocr job state', () => {
  it('tracks queued, running, complete, failed, and skipped counts', () => {
    let job = ocrJobReducer(createIdleOcrJob(), {
      type: 'started',
      jobId: 1,
      pageIds: ['a', 'b', 'c'],
      options: { mode: 'batch' },
    });

    expect(job).toMatchObject({ id: 1, phase: 'preparing', total: 3, mode: 'batch' });

    job = ocrJobReducer(job, { type: 'detecting-language', jobId: 1 });
    job = ocrJobReducer(job, { type: 'language-detected', jobId: 1, language: 'eng+ita' });
    expect(job).toMatchObject({ phase: 'detecting-language', language: 'eng+ita' });

    job = ocrJobReducer(job, { type: 'page-running', jobId: 1, pageId: 'a' });
    job = ocrJobReducer(job, { type: 'page-progress', jobId: 1, progress: 50 });
    expect(getOcrJobProgress(job)).toBe(17);

    job = ocrJobReducer(job, { type: 'page-complete', jobId: 1, pageId: 'a' });
    job = ocrJobReducer(job, { type: 'page-failed', jobId: 1, pageId: 'b', error: 'bad scan' });
    job = ocrJobReducer(job, { type: 'page-skipped', jobId: 1, pageId: 'c' });

    expect(job).toMatchObject({
      completed: 1,
      failed: 1,
      skipped: 1,
      failedPageIds: ['b'],
      error: 'bad scan',
    });

    job = ocrJobReducer(job, { type: 'completed', jobId: 1 });
    expect(job.phase).toBe('failed');
  });

  it('ignores stale job updates and late completion after cancellation', () => {
    let job = ocrJobReducer(createIdleOcrJob(), {
      type: 'started',
      jobId: 2,
      pageIds: ['a'],
      options: { mode: 'single' },
    });

    job = ocrJobReducer(job, { type: 'page-complete', jobId: 1, pageId: 'old' });
    expect(job.completed).toBe(0);

    job = ocrJobReducer(job, { type: 'cancelled', jobId: 2 });
    job = ocrJobReducer(job, { type: 'completed', jobId: 2 });
    expect(job.phase).toBe('cancelled');
  });
});

describe('ocr page helpers', () => {
  it('selects scanned pages by default and excludes pages already in progress', () => {
    expect(getOcrCandidatePages(pages, ['scanned', 'text', 'running']).map(page => page.id)).toEqual(['scanned']);
  });

  it('selects suspect text pages as OCR fallback candidates', () => {
    expect(getOcrCandidatePages(pages, ['suspect']).map(page => page.id)).toEqual(['suspect']);
  });

  it('includes text pages when explicitly requested', () => {
    expect(
      getOcrCandidatePages(pages, ['scanned', 'text'], { includeTextPages: true }).map(page => page.id),
    ).toEqual(['scanned', 'text']);
  });

  it('applies page OCR status only for the current job id', () => {
    const stale = applyPageOcrStatusForJob(pages, {
      currentJobId: 2,
      jobId: 1,
      pageId: 'scanned',
      status: 'complete',
    });
    expect(stale).toBe(pages);

    const next = applyPageOcrStatusForJob(pages, {
      currentJobId: 2,
      jobId: 2,
      pageId: 'scanned',
      status: 'failed',
      error: 'ocr failed',
    });

    expect(next[0]).toMatchObject({ ocrStatus: 'failed', ocrError: 'ocr failed' });
  });

  it('applies OCR results and clears scanned analysis for the current job only', () => {
    const ocrResult = {
      items: [{ str: 'hello', transform: [1, 0, 0, 1, 10, 20], width: 30, height: 12 }],
    };

    const stale = applyPageOcrResultForJob(pages, {
      currentJobId: 2,
      jobId: 1,
      pageId: 'scanned',
      ocrResult,
    });
    expect(stale).toBe(pages);

    const next = applyPageOcrResultForJob(pages, {
      currentJobId: 2,
      jobId: 2,
      pageId: 'scanned',
      ocrResult,
    });

    expect(next[0]).toMatchObject({
      ocrResult,
      ocrStatus: 'complete',
      ocrError: undefined,
      analysis: { hasText: true, hasOCR: true, isScanned: false, textHealth: 'hiddenOcr' },
      analysisStatus: 'complete',
      analysisError: undefined,
    });
  });
});
