import { isAnalysisOcrCandidate, type PdfPageInfo } from '../features/pdf-engine/utils';

export type OcrJobPhase =
  | 'idle'
  | 'preparing'
  | 'detecting-language'
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type OcrJobMode = 'single' | 'selected' | 'batch';

export interface OcrJobOptions {
  mode: OcrJobMode;
  force?: boolean;
  includeTextPages?: boolean;
}

export interface OcrJob {
  id: number;
  phase: OcrJobPhase;
  mode: OcrJobMode | null;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  currentPageId: string | null;
  pageIds: string[];
  failedPageIds: string[];
  error: string | null;
  language: string;
  progress: number | null;
}

export type OcrJobAction =
  | { type: 'started'; jobId: number; pageIds: string[]; options: OcrJobOptions }
  | { type: 'detecting-language'; jobId: number }
  | { type: 'language-detected'; jobId: number; language: string }
  | { type: 'page-running'; jobId: number; pageId: string }
  | { type: 'page-progress'; jobId: number; progress: number }
  | { type: 'page-complete'; jobId: number; pageId: string }
  | { type: 'page-failed'; jobId: number; pageId: string; error: string }
  | { type: 'page-skipped'; jobId: number; pageId: string }
  | { type: 'completed'; jobId: number }
  | { type: 'failed'; jobId: number; error: string }
  | { type: 'cancelled'; jobId: number };

const BUSY_PHASES = new Set<OcrJobPhase>([
  'preparing',
  'detecting-language',
  'running',
]);

export const createIdleOcrJob = (id = 0): OcrJob => ({
  id,
  phase: 'idle',
  mode: null,
  total: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  currentPageId: null,
  pageIds: [],
  failedPageIds: [],
  error: null,
  language: 'eng',
  progress: null,
});

export const isOcrJobBusy = (job: OcrJob): boolean => BUSY_PHASES.has(job.phase);

export const isOcrJobVisible = (job: OcrJob): boolean => (
  job.phase !== 'idle' && job.phase !== 'complete'
);

export const getOcrJobProgress = (job: OcrJob): number => {
  if (job.total === 0) return 0;
  if (job.phase === 'complete') return 100;

  const completedUnits = job.completed + job.failed + job.skipped;
  const currentProgress = job.progress === null ? 0 : job.progress / 100;
  return Math.min(99, Math.round(((completedUnits + currentProgress) / job.total) * 100));
};

export const ocrJobReducer = (job: OcrJob, action: OcrJobAction): OcrJob => {
  if (action.type === 'started') {
    return {
      ...createIdleOcrJob(action.jobId),
      phase: 'preparing',
      mode: action.options.mode,
      total: action.pageIds.length,
      pageIds: action.pageIds,
    };
  }

  if (action.jobId !== job.id) return job;
  if (job.phase === 'cancelled' && action.type !== 'cancelled') return job;

  switch (action.type) {
    case 'detecting-language':
      return {
        ...job,
        phase: 'detecting-language',
        progress: null,
        currentPageId: null,
      };
    case 'language-detected':
      return {
        ...job,
        language: action.language,
      };
    case 'page-running':
      return {
        ...job,
        phase: 'running',
        currentPageId: action.pageId,
        progress: null,
      };
    case 'page-progress':
      return {
        ...job,
        progress: Math.min(100, Math.max(0, action.progress)),
      };
    case 'page-complete':
      return {
        ...job,
        completed: Math.min(job.total, job.completed + 1),
        currentPageId: job.currentPageId === action.pageId ? null : job.currentPageId,
        progress: null,
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
        progress: null,
      };
    case 'page-skipped':
      return {
        ...job,
        skipped: Math.min(job.total, job.skipped + 1),
        currentPageId: job.currentPageId === action.pageId ? null : job.currentPageId,
        progress: null,
      };
    case 'completed':
      return {
        ...job,
        phase: job.failed > 0 ? 'failed' : 'complete',
        currentPageId: null,
        progress: null,
        error: job.failed > 0 ? job.error ?? 'Some pages failed OCR.' : null,
      };
    case 'failed':
      return {
        ...job,
        phase: 'failed',
        currentPageId: null,
        progress: null,
        error: action.error,
      };
    case 'cancelled':
      return {
        ...job,
        phase: 'cancelled',
        currentPageId: null,
        progress: null,
      };
  }
};

export const getOcrCandidatePages = (
  pages: PdfPageInfo[],
  pageIds: string[],
  options: Pick<OcrJobOptions, 'force' | 'includeTextPages'> = {},
): PdfPageInfo[] => {
  const requested = new Set(pageIds);
  return pages.filter(page => {
    if (!requested.has(page.id)) return false;
    if (page.ocrStatus === 'running' || page.ocrStatus === 'queued') return false;
    if (options.force || options.includeTextPages) return true;
    return isAnalysisOcrCandidate(page.analysis);
  });
};

interface PageOcrStatusUpdate {
  currentJobId: number;
  jobId: number;
  pageId: string;
  status: PdfPageInfo['ocrStatus'];
  error?: string;
}

interface PageOcrResultUpdate {
  currentJobId: number;
  jobId: number;
  pageId: string;
  ocrResult: NonNullable<PdfPageInfo['ocrResult']>;
}

export const applyPageOcrStatusForJob = (
  pages: PdfPageInfo[],
  update: PageOcrStatusUpdate,
): PdfPageInfo[] => {
  if (update.jobId !== update.currentJobId) return pages;

  let changed = false;
  const nextPages = pages.map(page => {
    if (page.id !== update.pageId) return page;

    changed = true;
    return {
      ...page,
      ocrStatus: update.status,
      ocrError: update.error,
    };
  });

  return changed ? nextPages : pages;
};

export const applyPageOcrResultForJob = (
  pages: PdfPageInfo[],
  update: PageOcrResultUpdate,
): PdfPageInfo[] => {
  if (update.jobId !== update.currentJobId) return pages;

  let changed = false;
  const nextPages = pages.map(page => {
    if (page.id !== update.pageId) return page;

    changed = true;
      return {
        ...page,
        nativeAnalysis: page.nativeAnalysis ?? page.analysis,
        ocrResult: update.ocrResult,
        ocrStatus: 'complete' as const,
      ocrError: undefined,
      analysis: {
        hasText: true,
        hasOCR: true,
        isScanned: false,
        textHealth: 'hiddenOcr' as const,
        textHealthReasons: ['ocr-result'],
        textItemCount: update.ocrResult.items.length,
        textSample: update.ocrResult.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, 500),
      },
      analysisStatus: 'complete' as const,
      analysisError: undefined,
    };
  });

  return changed ? nextPages : pages;
};
