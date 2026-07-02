import { describe, expect, it } from 'vitest';
import { type PageAnalysis, type PdfPageInfo } from '../features/pdf-engine/utils';
import {
  applyPageGlyphReportForJob,
  applyPageGlyphStatusForJob,
  createIdleGlyphJob,
  getGlyphDiagnosticsCandidatePages,
  getGlyphJobProgress,
  glyphJobReducer,
} from './glyphRepairJob';
import { type GlyphDiagnosticsReport } from '../shared/types/glyph';

const suspectAnalysis: PageAnalysis = {
  hasText: true,
  hasOCR: false,
  isScanned: false,
  textHealth: 'suspectEncoding',
  textHealthReasons: ['replacement-characters'],
  textItemCount: 12,
  textSample: 'Broken text',
};

const healthyAnalysis: PageAnalysis = {
  hasText: true,
  hasOCR: false,
  isScanned: false,
  textHealth: 'healthy',
  textHealthReasons: [],
  textItemCount: 12,
  textSample: 'Healthy text',
};

const pages: PdfPageInfo[] = [
  { id: 'suspect', docId: 'doc', originalPageIndex: 1, analysis: suspectAnalysis },
  { id: 'healthy', docId: 'doc', originalPageIndex: 2, analysis: healthyAnalysis },
  { id: 'running', docId: 'doc', originalPageIndex: 3, analysis: suspectAnalysis, glyphDiagnosticsStatus: 'running' },
];

const report: GlyphDiagnosticsReport = {
  pageCount: 1,
  encrypted: false,
  signatureCount: 0,
  pagesAnalyzed: 1,
  fontCount: 1,
  glyphEvents: 2,
  unmappedGlyphs: 1,
  deterministicCandidateFonts: 1,
  pages: [],
};

describe('glyph diagnostics job state', () => {
  it('tracks progress and failed pages', () => {
    let job = glyphJobReducer(createIdleGlyphJob(), {
      type: 'started',
      jobId: 1,
      pageIds: ['a', 'b'],
    });

    expect(job).toMatchObject({ id: 1, phase: 'preparing', total: 2 });

    job = glyphJobReducer(job, { type: 'page-running', jobId: 1, pageId: 'a' });
    expect(getGlyphJobProgress(job)).toBe(0);

    job = glyphJobReducer(job, { type: 'page-complete', jobId: 1, pageId: 'a' });
    expect(getGlyphJobProgress(job)).toBe(50);

    job = glyphJobReducer(job, { type: 'page-failed', jobId: 1, pageId: 'b', error: 'bad font' });
    job = glyphJobReducer(job, { type: 'completed', jobId: 1 });

    expect(job).toMatchObject({ phase: 'failed', failed: 1, failedPageIds: ['b'], error: 'bad font' });
  });

  it('ignores stale updates and late completion after cancellation', () => {
    let job = glyphJobReducer(createIdleGlyphJob(), {
      type: 'started',
      jobId: 2,
      pageIds: ['a'],
    });

    job = glyphJobReducer(job, { type: 'page-complete', jobId: 1, pageId: 'old' });
    expect(job.completed).toBe(0);

    job = glyphJobReducer(job, { type: 'cancelled', jobId: 2 });
    job = glyphJobReducer(job, { type: 'completed', jobId: 2 });
    expect(job.phase).toBe('cancelled');
  });
});

describe('glyph diagnostics page helpers', () => {
  it('selects suspect pages and excludes diagnostics already in progress', () => {
    expect(getGlyphDiagnosticsCandidatePages(pages, ['suspect', 'healthy', 'running']).map(page => page.id)).toEqual(['suspect']);
  });

  it('applies page status only for the current job', () => {
    const stale = applyPageGlyphStatusForJob(pages, {
      currentJobId: 2,
      jobId: 1,
      pageId: 'suspect',
      status: 'failed',
    });
    expect(stale).toBe(pages);

    const next = applyPageGlyphStatusForJob(pages, {
      currentJobId: 2,
      jobId: 2,
      pageId: 'suspect',
      status: 'failed',
      error: 'diagnostics failed',
    });
    expect(next[0]).toMatchObject({ glyphDiagnosticsStatus: 'failed', glyphDiagnosticsError: 'diagnostics failed' });
  });

  it('applies reports only for the current job', () => {
    const stale = applyPageGlyphReportForJob(pages, {
      currentJobId: 2,
      jobId: 1,
      pageId: 'suspect',
      report,
    });
    expect(stale).toBe(pages);

    const next = applyPageGlyphReportForJob(pages, {
      currentJobId: 2,
      jobId: 2,
      pageId: 'suspect',
      report,
    });
    expect(next[0]).toMatchObject({
      glyphDiagnostics: report,
      glyphDiagnosticsStatus: 'complete',
      glyphDiagnosticsError: undefined,
    });
  });
});
