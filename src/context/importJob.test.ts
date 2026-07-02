import { describe, expect, it } from 'vitest';
import { type PageAnalysis, type PdfPageInfo } from '../features/pdf-engine/utils';
import {
  applyPageAnalysisUpdateForJob,
  createIdleImportJob,
  createPagePlaceholders,
  importJobReducer,
  orderImportedPagesForAnalysis,
} from './importJob';

const healthyAnalysis: PageAnalysis = {
  hasText: true,
  hasOCR: false,
  isScanned: false,
  textHealth: 'healthy',
  textHealthReasons: [],
  textItemCount: 12,
  textSample: 'Readable page text',
};

describe('import job state', () => {
  it('tracks file, placeholder, and analysis progress transitions', () => {
    let job = createIdleImportJob();

    job = importJobReducer(job, { type: 'started', jobId: 1, filesTotal: 2 });
    expect(job).toMatchObject({ id: 1, phase: 'reading', filesTotal: 2 });

    job = importJobReducer(job, { type: 'loading-file', jobId: 1, fileName: 'first.pdf' });
    expect(job).toMatchObject({ phase: 'loading', currentFileName: 'first.pdf' });

    job = importJobReducer(job, { type: 'pages-discovered', jobId: 1, fileName: 'first.pdf', pageCount: 3 });
    expect(job).toMatchObject({ phase: 'instantiating', pagesTotal: 3 });

    job = importJobReducer(job, { type: 'pages-instantiated', jobId: 1, count: 3 });
    job = importJobReducer(job, { type: 'file-done', jobId: 1 });
    expect(job).toMatchObject({ filesDone: 1, pagesInstantiated: 3 });

    job = importJobReducer(job, { type: 'analysis-started', jobId: 1 });
    job = importJobReducer(job, { type: 'page-analyzed', jobId: 1 });
    expect(job).toMatchObject({ phase: 'analyzing', pagesAnalyzed: 1 });

    job = importJobReducer(job, { type: 'completed', jobId: 1 });
    expect(job).toMatchObject({ phase: 'complete', pagesAnalyzed: 3, error: null });
  });

  it('ignores stale job transitions after a newer job starts', () => {
    let job = importJobReducer(createIdleImportJob(), { type: 'started', jobId: 2, filesTotal: 1 });

    job = importJobReducer(job, { type: 'pages-discovered', jobId: 1, fileName: 'old.pdf', pageCount: 99 });

    expect(job).toMatchObject({ id: 2, pagesTotal: 0, phase: 'reading' });
  });

  it('keeps a cancelled job cancelled when late completion arrives', () => {
    let job = importJobReducer(createIdleImportJob(), { type: 'started', jobId: 4, filesTotal: 1 });

    job = importJobReducer(job, { type: 'cancelled', jobId: 4 });
    job = importJobReducer(job, { type: 'completed', jobId: 4 });

    expect(job.phase).toBe('cancelled');
  });

  it('can restart analysis for restored pending pages without file loading progress', () => {
    const job = importJobReducer(createIdleImportJob(), {
      type: 'analysis-only-started',
      jobId: 5,
      pagesTotal: 3,
    });

    expect(job).toMatchObject({
      id: 5,
      phase: 'analyzing',
      pagesTotal: 3,
      pagesInstantiated: 3,
      filesTotal: 0,
    });
  });
});

describe('import page helpers', () => {
  it('creates stable placeholders with doc ids and 1-indexed source page numbers', () => {
    const ids = ['p1', 'p2', 'p3'];
    const placeholders = createPagePlaceholders('doc-a', 3, () => ids.shift() ?? 'fallback');

    expect(placeholders).toEqual([
      { id: 'p1', docId: 'doc-a', originalPageIndex: 1, analysisStatus: 'pending' },
      { id: 'p2', docId: 'doc-a', originalPageIndex: 2, analysisStatus: 'pending' },
      { id: 'p3', docId: 'doc-a', originalPageIndex: 3, analysisStatus: 'pending' },
    ]);
  });

  it('orders analysis by active page, first eight pages per document, then remaining pages', () => {
    const pages: PdfPageInfo[] = [
      ...createPagePlaceholders('doc-a', 10, (() => {
        let id = 0;
        return () => `a${++id}`;
      })()),
      ...createPagePlaceholders('doc-b', 3, (() => {
        let id = 0;
        return () => `b${++id}`;
      })()),
    ];

    const orderedIds = orderImportedPagesForAnalysis(pages, 'a10').map(page => page.id);

    expect(orderedIds).toEqual([
      'a10',
      'a1',
      'a2',
      'a3',
      'a4',
      'a5',
      'a6',
      'a7',
      'a8',
      'b1',
      'b2',
      'b3',
      'a9',
    ]);
  });

  it('moves page analysis status through running, complete, and failed', () => {
    const [page] = createPagePlaceholders('doc-a', 1, () => 'p1');

    const running = applyPageAnalysisUpdateForJob([page], {
      currentJobId: 1,
      jobId: 1,
      pageId: 'p1',
      status: 'running',
    });

    expect(running[0].analysisStatus).toBe('running');

    const complete = applyPageAnalysisUpdateForJob(running, {
      currentJobId: 1,
      jobId: 1,
      pageId: 'p1',
      status: 'complete',
      analysis: healthyAnalysis,
    });

    expect(complete[0]).toMatchObject({
      analysisStatus: 'complete',
      analysis: { hasText: true, hasOCR: false, isScanned: false, textHealth: 'healthy' },
    });

    const failed = applyPageAnalysisUpdateForJob(complete, {
      currentJobId: 1,
      jobId: 1,
      pageId: 'p1',
      status: 'failed',
      error: 'boom',
    });

    expect(failed[0]).toMatchObject({ analysisStatus: 'failed', analysisError: 'boom' });
  });

  it('ignores late analysis results from stale jobs', () => {
    const [page] = createPagePlaceholders('doc-a', 1, () => 'p1');

    const next = applyPageAnalysisUpdateForJob([page], {
      currentJobId: 2,
      jobId: 1,
      pageId: 'p1',
      status: 'complete',
      analysis: healthyAnalysis,
    });

    expect(next).toBeInstanceOf(Array);
    expect(next[0]).toBe(page);
    expect(next[0].analysisStatus).toBe('pending');
  });
});
