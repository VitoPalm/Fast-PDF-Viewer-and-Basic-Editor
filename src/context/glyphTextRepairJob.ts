export type GlyphTextRepairJobPhase =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'cancelling'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface GlyphTextRepairJob {
  id: number;
  phase: GlyphTextRepairJobPhase;
  total: number;
  completed: number;
  repaired: number;
  skipped: number;
  failed: number;
  currentPageId: string | null;
  pageIds: string[];
  failedPageIds: string[];
  skippedPageIds: string[];
  repairedPageIds: string[];
  error: string | null;
}

export type GlyphTextRepairJobAction =
  | { type: 'started'; jobId: number; pageIds: string[] }
  | { type: 'page-running'; jobId: number; pageId: string }
  | { type: 'page-repaired'; jobId: number; pageId: string }
  | { type: 'page-skipped'; jobId: number; pageId: string }
  | { type: 'page-failed'; jobId: number; pageId: string; error: string }
  | { type: 'cancel-requested'; jobId: number }
  | { type: 'completed'; jobId: number }
  | { type: 'failed'; jobId: number; error: string }
  | { type: 'cancelled'; jobId: number };

const BUSY_PHASES = new Set<GlyphTextRepairJobPhase>(['preparing', 'running', 'cancelling']);

export const createIdleGlyphTextRepairJob = (id = 0): GlyphTextRepairJob => ({
  id,
  phase: 'idle',
  total: 0,
  completed: 0,
  repaired: 0,
  skipped: 0,
  failed: 0,
  currentPageId: null,
  pageIds: [],
  failedPageIds: [],
  skippedPageIds: [],
  repairedPageIds: [],
  error: null,
});

export const isGlyphTextRepairJobBusy = (job: GlyphTextRepairJob): boolean => BUSY_PHASES.has(job.phase);

export const isGlyphTextRepairJobVisible = (job: GlyphTextRepairJob): boolean => (
  job.phase === 'preparing' || job.phase === 'running' || job.phase === 'cancelling' || job.phase === 'failed'
);

export const getGlyphTextRepairJobProgress = (job: GlyphTextRepairJob): number => {
  if (job.total === 0) return 0;
  if (job.phase === 'complete' || job.completed >= job.total) return 100;
  return Math.min(99, Math.round((job.completed / job.total) * 100));
};

const addUnique = (values: string[], value: string): string[] => (
  values.includes(value) ? values : [...values, value]
);

const hasSettledPage = (job: GlyphTextRepairJob, pageId: string): boolean => (
  job.repairedPageIds.includes(pageId) ||
  job.skippedPageIds.includes(pageId) ||
  job.failedPageIds.includes(pageId)
);

export const glyphTextRepairJobReducer = (
  job: GlyphTextRepairJob,
  action: GlyphTextRepairJobAction,
): GlyphTextRepairJob => {
  if (action.type === 'started') {
    return {
      ...createIdleGlyphTextRepairJob(action.jobId),
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
        phase: job.phase === 'cancelling' ? 'cancelling' : 'running',
        currentPageId: action.pageId,
      };
    case 'page-repaired': {
      const alreadySettled = hasSettledPage(job, action.pageId);
      return {
        ...job,
        completed: alreadySettled ? job.completed : Math.min(job.total, job.completed + 1),
        repaired: alreadySettled ? job.repaired : Math.min(job.total, job.repaired + 1),
        repairedPageIds: addUnique(job.repairedPageIds, action.pageId),
        currentPageId: job.currentPageId === action.pageId ? null : job.currentPageId,
      };
    }
    case 'page-skipped': {
      const alreadySettled = hasSettledPage(job, action.pageId);
      return {
        ...job,
        completed: alreadySettled ? job.completed : Math.min(job.total, job.completed + 1),
        skipped: alreadySettled ? job.skipped : Math.min(job.total, job.skipped + 1),
        skippedPageIds: addUnique(job.skippedPageIds, action.pageId),
        currentPageId: job.currentPageId === action.pageId ? null : job.currentPageId,
      };
    }
    case 'page-failed': {
      const alreadySettled = hasSettledPage(job, action.pageId);
      return {
        ...job,
        completed: alreadySettled ? job.completed : Math.min(job.total, job.completed + 1),
        failed: alreadySettled ? job.failed : Math.min(job.total, job.failed + 1),
        failedPageIds: addUnique(job.failedPageIds, action.pageId),
        currentPageId: job.currentPageId === action.pageId ? null : job.currentPageId,
        error: action.error,
      };
    }
    case 'cancel-requested':
      return {
        ...job,
        phase: BUSY_PHASES.has(job.phase) ? 'cancelling' : job.phase,
      };
    case 'completed':
      return {
        ...job,
        phase: job.failed > 0 ? 'failed' : 'complete',
        currentPageId: null,
        error: job.failed > 0 ? job.error ?? 'Some text repairs failed.' : null,
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
