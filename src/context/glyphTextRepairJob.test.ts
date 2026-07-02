import { describe, expect, it } from 'vitest';
import {
  createIdleGlyphTextRepairJob,
  getGlyphTextRepairJobProgress,
  glyphTextRepairJobReducer,
  isGlyphTextRepairJobBusy,
  isGlyphTextRepairJobVisible,
} from './glyphTextRepairJob';

describe('glyph text repair job state', () => {
  it('tracks repaired, skipped, and failed pages', () => {
    let job = glyphTextRepairJobReducer(createIdleGlyphTextRepairJob(), {
      type: 'started',
      jobId: 1,
      pageIds: ['a', 'b', 'c'],
    });

    expect(job).toMatchObject({ id: 1, phase: 'preparing', total: 3 });
    expect(isGlyphTextRepairJobBusy(job)).toBe(true);

    job = glyphTextRepairJobReducer(job, { type: 'page-running', jobId: 1, pageId: 'a' });
    job = glyphTextRepairJobReducer(job, { type: 'page-repaired', jobId: 1, pageId: 'a' });
    expect(getGlyphTextRepairJobProgress(job)).toBe(33);

    job = glyphTextRepairJobReducer(job, { type: 'page-skipped', jobId: 1, pageId: 'b' });
    job = glyphTextRepairJobReducer(job, { type: 'page-failed', jobId: 1, pageId: 'c', error: 'bad map' });
    job = glyphTextRepairJobReducer(job, { type: 'completed', jobId: 1 });

    expect(job).toMatchObject({
      phase: 'failed',
      repaired: 1,
      skipped: 1,
      failed: 1,
      repairedPageIds: ['a'],
      skippedPageIds: ['b'],
      failedPageIds: ['c'],
      error: 'bad map',
    });
    expect(getGlyphTextRepairJobProgress(job)).toBe(100);
    expect(isGlyphTextRepairJobVisible(job)).toBe(true);
  });

  it('models stop-after-current cancellation without double-counting queued pages', () => {
    let job = glyphTextRepairJobReducer(createIdleGlyphTextRepairJob(), {
      type: 'started',
      jobId: 2,
      pageIds: ['a', 'b'],
    });

    job = glyphTextRepairJobReducer(job, { type: 'page-running', jobId: 2, pageId: 'a' });
    job = glyphTextRepairJobReducer(job, { type: 'page-skipped', jobId: 2, pageId: 'b' });
    job = glyphTextRepairJobReducer(job, { type: 'cancel-requested', jobId: 2 });

    expect(job).toMatchObject({ phase: 'cancelling', completed: 1, skipped: 1, currentPageId: 'a' });
    expect(isGlyphTextRepairJobBusy(job)).toBe(true);

    job = glyphTextRepairJobReducer(job, { type: 'page-repaired', jobId: 2, pageId: 'a' });
    job = glyphTextRepairJobReducer(job, { type: 'page-skipped', jobId: 2, pageId: 'b' });
    job = glyphTextRepairJobReducer(job, { type: 'cancelled', jobId: 2 });

    expect(job).toMatchObject({
      phase: 'cancelled',
      completed: 2,
      repaired: 1,
      skipped: 1,
      repairedPageIds: ['a'],
      skippedPageIds: ['b'],
    });
    expect(isGlyphTextRepairJobBusy(job)).toBe(false);
    expect(isGlyphTextRepairJobVisible(job)).toBe(true);
  });

  it('keeps all-skipped completion visible for review', () => {
    let job = glyphTextRepairJobReducer(createIdleGlyphTextRepairJob(), {
      type: 'started',
      jobId: 4,
      pageIds: ['a'],
    });

    job = glyphTextRepairJobReducer(job, { type: 'page-skipped', jobId: 4, pageId: 'a' });
    job = glyphTextRepairJobReducer(job, { type: 'completed', jobId: 4 });

    expect(job).toMatchObject({ phase: 'complete', repaired: 0, skipped: 1 });
    expect(isGlyphTextRepairJobVisible(job)).toBe(true);
  });

  it('ignores stale updates and late completion after hard cancellation', () => {
    let job = glyphTextRepairJobReducer(createIdleGlyphTextRepairJob(), {
      type: 'started',
      jobId: 3,
      pageIds: ['a'],
    });

    job = glyphTextRepairJobReducer(job, { type: 'page-repaired', jobId: 2, pageId: 'old' });
    expect(job.repaired).toBe(0);

    job = glyphTextRepairJobReducer(job, { type: 'cancelled', jobId: 3 });
    job = glyphTextRepairJobReducer(job, { type: 'page-repaired', jobId: 3, pageId: 'a' });
    job = glyphTextRepairJobReducer(job, { type: 'completed', jobId: 3 });

    expect(job).toMatchObject({ phase: 'cancelled', repaired: 0, completed: 0 });
  });
});
