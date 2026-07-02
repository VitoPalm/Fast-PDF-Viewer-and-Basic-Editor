import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { launchPackagedApp, loadPdf } from './packagedApp';

const fixtureDir = process.env.PDF_UI_FIXTURE_DIR ?? '/tmp/antigravity-pdf-ui-fixtures';

const fixtures = {
  stats27: path.join(fixtureDir, 'stats_note_27p_low_text.pdf'),
  slides62: path.join(fixtureDir, 'oop_gui_db_usecases_62p_slides.pdf'),
  sparse665: path.join(fixtureDir, 'db_book_665p_sparse_text.pdf'),
};

function requireFixture(filePath: string) {
  test.skip(!existsSync(filePath), `Missing local PDF UI fixture: ${filePath}`);
}

async function fillRange(page: Page, range: string) {
  const input = page.locator('.page-range-input');
  await input.fill(range);
  await expect(input).toHaveValue(range);
}

async function enabledRangeActionNames(page: Page) {
  return page.locator('.page-range-action-btn').evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const htmlButton = button as HTMLButtonElement;
        const style = window.getComputedStyle(htmlButton);
        const visible =
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          htmlButton.getClientRects().length > 0;
        return visible && !htmlButton.disabled && htmlButton.getAttribute('aria-disabled') !== 'true';
      })
      .map((button) => button.textContent?.trim() ?? '')
      .filter(Boolean),
  );
}

async function jumpToPage(page: Page, pageNumber: number, totalPages: number) {
  await page.locator('.page-indicator-label').click();
  await page.locator('.page-indicator-input').fill(String(pageNumber));
  await page.locator('.page-indicator-input').press('Enter');
  await expect(page.locator('.page-indicator-label')).toContainText(`${pageNumber} / ${totalPages}`);
}

async function confirmDialogAction(page: Page, dialogName: RegExp, actionName: string) {
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: actionName, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.describe('Packaged app Batch 1 smoke regressions', () => {
  test('loads the packaged app, opens a PDF, and keeps invalid mixed range actions disabled', async ({ browserName }, testInfo) => {
    void browserName;
    requireFixture(fixtures.stats27);
    const { electronApp, page } = await launchPackagedApp(testInfo);

    try {
      await loadPdf(page, fixtures.stats27, 27, testInfo);
      await fillRange(page, '1-3, 9999');

      await expect(page.locator('.page-range-error')).toContainText('Page 9999 out of range');
      await expect
        .poll(() => enabledRangeActionNames(page), {
          message: 'packaged app must not enable actions for mixed valid/invalid ranges',
        })
        .toEqual([]);
    } finally {
      await electronApp.close();
    }
  });

  test('packaged destructive remove confirmation and undo work', async ({ browserName }, testInfo) => {
    void browserName;
    requireFixture(fixtures.stats27);
    const { electronApp, page } = await launchPackagedApp(testInfo);

    try {
      await loadPdf(page, fixtures.stats27, 27, testInfo);
      await fillRange(page, '2-3');
      await page.getByRole('button', { name: 'Remove', exact: true }).first().click();
      await confirmDialogAction(page, /remove selected pages/i, 'Remove');
      await expect(page.locator('.page-count-badge')).toHaveText('25');

      const undoToast = page.getByRole('status').filter({ hasText: /Removed 2 pages/i });
      await expect(undoToast).toBeVisible();
      await undoToast.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.locator('.page-count-badge')).toHaveText('27');
    } finally {
      await electronApp.close();
    }
  });

  test('packaged direct page jump keeps the active sidebar thumbnail synchronized', async ({ browserName }, testInfo) => {
    void browserName;
    requireFixture(fixtures.slides62);
    const { electronApp, page } = await launchPackagedApp(testInfo);

    try {
      await loadPdf(page, fixtures.slides62, 62, testInfo);
      await jumpToPage(page, 50, 62);

      await expect(page.locator('.thumbnail-item.active .thumbnail-page-num')).toHaveText('Page 50');
      await expect
        .poll(() => page.locator('.sidebar-scroll-container').evaluate((node) => node.scrollTop))
        .toBeGreaterThan(0);
    } finally {
      await electronApp.close();
    }
  });

  test('packaged large import shows progress and renders before analysis completes', async ({ browserName }, testInfo) => {
    void browserName;
    requireFixture(fixtures.sparse665);
    const { electronApp, page } = await launchPackagedApp(testInfo);

    try {
      await page.locator('input[type="file"]').first().setInputFiles(fixtures.sparse665);
      await expect(page.locator('.page-count-badge')).toHaveText('665', { timeout: 120_000 });
      await expect(page.locator('[data-testid="workspace-import-progress"]')).toBeVisible({ timeout: 15_000 });

      const progressText = await page.locator('[data-testid="workspace-import-progress"]').textContent();
      const match = progressText?.match(/Analyzing\s+(\d+)\/665/);
      expect(match, `expected in-progress analysis text, got: ${progressText}`).not.toBeNull();
      expect(Number(match?.[1] ?? 665)).toBeLessThan(665);

      await page.locator('.pdf-page-container.ready').waitFor({ timeout: 60_000 });
      await page.screenshot({ path: testInfo.outputPath('packaged-large-import-progress.png'), fullPage: true });
    } finally {
      await electronApp.close();
    }
  });
});
