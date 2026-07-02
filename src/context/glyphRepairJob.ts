import { isSuspectTextHealth } from '../features/pdf-engine/textLayerHealth';
import { type PdfPageInfo } from '../features/pdf-engine/utils';
import {
  type GlyphDiagnosticsReport,
  type GlyphDiagnosticsStatus,
} from '../shared/types/glyph';

export type GlyphJobPhase =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface GlyphJob {
  id: number;
  phase: GlyphJobPhase;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  currentPageId: string | null;
  pageIds: string[];
  failedPageIds: string[];
  error: string | null;
}

export type GlyphJobAction =
  | { type: 'started'; jobId: number; pageIds: string[] }
  | { type: 'page-running'; jobId: number; pageId: string }
  | { type: 'page-complete'; jobId: number; pageId: string }
  | { type: 'page-failed'; jobId: number; pageId: string; error: string }
  | { type: 'page-skipped'; jobId: number; pageId: string }
  | { type: 'completed'; jobId: number }
  | { type: 'failed'; jobId: number; error: string }
  | { type: 'cancelled'; jobId: number };

const BUSY_PHASES = new Set<GlyphJobPhase>(['preparing', 'running']);

export const createIdleGlyphJob = (id = 0): GlyphJob => ({
  id,
  phase: 'idle',
  total: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  currentPageId: null,
  pageIds: [],
  failedPageIds: [],
  error: null,
});

export const isGlyphJobBusy = (job: GlyphJob): boolean => BUSY_PHASES.has(job.phase);

export const isGlyphJobVisible = (job: GlyphJob): boolean => (
  job.phase !== 'idle' && job.phase !== 'complete'
);

export const getGlyphJobProgress = (job: GlyphJob): number => {
  if (job.total === 0) return 0;
  if (job.phase === 'complete') return 100;

  const completedUnits = job.completed + job.failed + job.skipped;
  return Math.min(99, Math.round((completedUnits / job.total) * 100));
};

export const glyphJobReducer = (job: GlyphJob, action: GlyphJobAction): GlyphJob => {
  if (action.type === 'started') {
    return {
      ...createIdleGlyphJob(action.jobId),
      phase: 'preparing',
      total: action.pageIds.length,
      pageIds: action.pageIds,
    };
  }

  if (action.jobId !== job.id) return job;
  if (job.phase === 'cancelled' && action.type !== 'cancelled') return job;

  switch (action.type) {
    case 'page-running':
      return {
        ...job,
        phase: 'running',
        currentPageId: action.pageId,
      };
    case 'page-complete':
      return {
        ...job,
        completed: Math.min(job.total, job.completed + 1),
        currentPageId: job.currentPageId === action.pageId ? null : job.currentPageId,
      };
    case 'page-failed':
      return {
        ...job,
        failed: Math.min(job.total, job.failed + 1),
        failedPageIds: job.failedPageIds.includes(action.pageId)
          ? job.failedPageIds
          : [...job.failedPageIds, action.pageId],
        currentPageId: job.currentPageId === action.pageId ? null : job.currentPageId,
        error: action.error,
      };
    case 'page-skipped':
      return {
        ...job,
        skipped: Math.min(job.total, job.skipped + 1),
        currentPageId: job.currentPageId === action.pageId ? null : job.currentPageId,
      };
    case 'completed':
      return {
        ...job,
        phase: job.failed > 0 ? 'failed' : 'complete',
        currentPageId: null,
        error: job.failed > 0 ? job.error ?? 'Some glyph diagnostics failed.' : null,
      };
    case 'failed':
      return {
        ...job,
        phase: 'failed',
        currentPageId: null,
        error: action.error,
      };
    case 'cancelled':
      return {
        ...job,
        phase: 'cancelled',
        currentPageId: null,
      };
  }
};

export const getGlyphDiagnosticsCandidatePages = (
  pages: PdfPageInfo[],
  pageIds: string[],
): PdfPageInfo[] => {
  const requested = new Set(pageIds);
  return pages.filter(page => {
    if (!requested.has(page.id)) return false;
    if (page.glyphDiagnosticsStatus === 'queued' || page.glyphDiagnosticsStatus === 'running') return false;
    return page.analysis ? isSuspectTextHealth(page.analysis.textHealth) : true;
  });
};

interface PageGlyphStatusUpdate {
  currentJobId: number;
  jobId: number;
  pageId: string;
  status: GlyphDiagnosticsStatus;
  error?: string;
}

interface PageGlyphReportUpdate {
  currentJobId: number;
  jobId: number;
  pageId: string;
  report: GlyphDiagnosticsReport;
}

export const applyPageGlyphStatusForJob = (
  pages: PdfPageInfo[],
  update: PageGlyphStatusUpdate,
): PdfPageInfo[] => {
  if (update.jobId !== update.currentJobId) return pages;

  let changed = false;
  const nextPages = pages.map(page => {
    if (page.id !== update.pageId) return page;

    changed = true;
    return {
      ...page,
      glyphDiagnosticsStatus: update.status,
      glyphDiagnosticsError: update.error,
    };
  });

  return changed ? nextPages : pages;
};

export const applyPageGlyphReportForJob = (
  pages: PdfPageInfo[],
  update: PageGlyphReportUpdate,
): PdfPageInfo[] => {
  if (update.jobId !== update.currentJobId) return pages;

  let changed = false;
  const nextPages = pages.map(page => {
    if (page.id !== update.pageId) return page;

    changed = true;
    return {
      ...page,
      glyphDiagnostics: update.report,
      glyphDiagnosticsStatus: 'complete' as const,
      glyphDiagnosticsError: undefined,
    };
  });

  return changed ? nextPages : pages;
};
