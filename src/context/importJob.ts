import { type PageAnalysis, type PdfPageInfo } from '../features/pdf-engine/utils';

export type ImportJobPhase =
  | 'idle'
  | 'reading'
  | 'loading'
  | 'instantiating'
  | 'analyzing'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface ImportJob {
  id: number;
  phase: ImportJobPhase;
  filesTotal: number;
  filesDone: number;
  currentFileName: string | null;
  pagesTotal: number;
  pagesInstantiated: number;
  pagesAnalyzed: number;
  error: string | null;
}

export type ImportJobAction =
  | { type: 'started'; jobId: number; filesTotal: number }
  | { type: 'analysis-only-started'; jobId: number; pagesTotal: number }
  | { type: 'loading-file'; jobId: number; fileName: string }
  | { type: 'pages-discovered'; jobId: number; fileName: string; pageCount: number }
  | { type: 'pages-instantiated'; jobId: number; count: number }
  | { type: 'file-done'; jobId: number }
  | { type: 'analysis-started'; jobId: number }
  | { type: 'page-analyzed'; jobId: number }
  | { type: 'completed'; jobId: number }
  | { type: 'failed'; jobId: number; error: string }
  | { type: 'cancelled'; jobId: number };

const BUSY_PHASES = new Set<ImportJobPhase>([
  'reading',
  'loading',
  'instantiating',
  'analyzing',
]);
const BLOCKING_PHASES = new Set<ImportJobPhase>([
  'reading',
  'loading',
  'instantiating',
]);

export const createIdleImportJob = (id = 0): ImportJob => ({
  id,
  phase: 'idle',
  filesTotal: 0,
  filesDone: 0,
  currentFileName: null,
  pagesTotal: 0,
  pagesInstantiated: 0,
  pagesAnalyzed: 0,
  error: null,
});

export const isImportJobBusy = (job: ImportJob): boolean => BUSY_PHASES.has(job.phase);
export const isImportJobBlocking = (job: ImportJob): boolean => BLOCKING_PHASES.has(job.phase);

export const isImportJobVisible = (job: ImportJob): boolean => (
  job.phase !== 'idle' && job.phase !== 'complete' && job.phase !== 'cancelled'
);

export const getImportJobProgress = (job: ImportJob): number => {
  if (job.phase === 'complete') return 100;
  if (job.phase === 'failed' || job.phase === 'cancelled') return 0;

  if (job.pagesTotal > 0) {
    const pageWorkTotal = job.pagesTotal * 2;
    const pageWorkDone = job.pagesInstantiated + job.pagesAnalyzed;
    return Math.min(99, Math.round((pageWorkDone / pageWorkTotal) * 100));
  }

  if (job.filesTotal > 0) {
    return Math.min(25, Math.round((job.filesDone / job.filesTotal) * 25));
  }

  return 5;
};

export const importJobReducer = (job: ImportJob, action: ImportJobAction): ImportJob => {
  if (action.type === 'started') {
    return {
      ...createIdleImportJob(action.jobId),
      phase: 'reading',
      filesTotal: action.filesTotal,
    };
  }

  if (action.type === 'analysis-only-started') {
    return {
      ...createIdleImportJob(action.jobId),
      phase: 'analyzing',
      pagesTotal: action.pagesTotal,
      pagesInstantiated: action.pagesTotal,
    };
  }

  if (action.jobId !== job.id) return job;
  if (job.phase === 'cancelled' && action.type !== 'cancelled') return job;

  switch (action.type) {
    case 'loading-file':
      return {
        ...job,
        phase: 'loading',
        currentFileName: action.fileName,
        error: null,
      };
    case 'pages-discovered':
      return {
        ...job,
        phase: 'instantiating',
        currentFileName: action.fileName,
        pagesTotal: job.pagesTotal + action.pageCount,
        error: null,
      };
    case 'pages-instantiated':
      return {
        ...job,
        phase: 'instantiating',
        pagesInstantiated: job.pagesInstantiated + action.count,
      };
    case 'file-done': {
      const filesDone = Math.min(job.filesTotal, job.filesDone + 1);
      return {
        ...job,
        filesDone,
        currentFileName: filesDone === job.filesTotal ? null : job.currentFileName,
      };
    }
    case 'analysis-started':
      return {
        ...job,
        phase: 'analyzing',
        currentFileName: null,
      };
    case 'page-analyzed':
      return {
        ...job,
        pagesAnalyzed: Math.min(job.pagesTotal, job.pagesAnalyzed + 1),
      };
    case 'completed':
      return {
        ...job,
        phase: 'complete',
        currentFileName: null,
        pagesAnalyzed: job.pagesTotal,
        error: null,
      };
    case 'failed':
      return {
        ...job,
        phase: 'failed',
        currentFileName: null,
        error: action.error,
      };
    case 'cancelled':
      return {
        ...job,
        phase: 'cancelled',
        currentFileName: null,
        error: null,
      };
  }
};

export const createPagePlaceholders = (
  docId: string,
  pageCount: number,
  createId: () => string,
): PdfPageInfo[] => Array.from({ length: pageCount }, (_, index) => ({
  id: createId(),
  docId,
  originalPageIndex: index + 1,
  analysisStatus: 'pending',
}));

export const orderImportedPagesForAnalysis = (
  pages: PdfPageInfo[],
  activePageId: string | null,
  priorityPageLimit = 8,
): PdfPageInfo[] => {
  const ordered: PdfPageInfo[] = [];
  const seen = new Set<string>();

  const addPage = (page: PdfPageInfo | undefined) => {
    if (!page || seen.has(page.id)) return;
    ordered.push(page);
    seen.add(page.id);
  };

  if (activePageId) {
    addPage(pages.find(page => page.id === activePageId));
  }

  const docIds = Array.from(new Set(pages.map(page => page.docId)));
  for (const docId of docIds) {
    pages
      .filter(page => page.docId === docId)
      .slice(0, priorityPageLimit)
      .forEach(addPage);
  }

  pages.forEach(addPage);
  return ordered;
};

interface PageAnalysisUpdate {
  currentJobId: number;
  jobId: number;
  pageId: string;
  status: PdfPageInfo['analysisStatus'];
  analysis?: PageAnalysis;
  error?: string;
}

export const applyPageAnalysisUpdateForJob = (
  pages: PdfPageInfo[],
  update: PageAnalysisUpdate,
): PdfPageInfo[] => {
  if (update.jobId !== update.currentJobId) return pages;

  let changed = false;
  const nextPages = pages.map(page => {
    if (page.id !== update.pageId) return page;

    changed = true;
    return {
      ...page,
      analysis: update.analysis ?? page.analysis,
      analysisStatus: update.status,
      analysisError: update.error,
    };
  });

  return changed ? nextPages : pages;
};

export const markPendingAnalysisCancelled = (
  pages: PdfPageInfo[],
  error = 'PDF analysis was cancelled before this page could be checked.',
): PdfPageInfo[] => {
  let changed = false;
  const nextPages = pages.map(page => {
    if (page.analysisStatus !== 'pending' && page.analysisStatus !== 'running') return page;

    changed = true;
    return {
      ...page,
      analysisStatus: 'failed' as const,
      analysisError: error,
    };
  });

  return changed ? nextPages : pages;
};
