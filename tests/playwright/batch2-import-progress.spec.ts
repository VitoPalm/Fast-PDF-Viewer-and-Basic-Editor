import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

const fixtureDir = process.env.PDF_UI_FIXTURE_DIR ?? '/tmp/antigravity-pdf-ui-fixtures';

const fixtures = {
  stats27: path.join(fixtureDir, 'stats_note_27p_low_text.pdf'),
  sparse665: path.join(fixtureDir, 'db_book_665p_sparse_text.pdf'),
};

function requireFixture(filePath: string) {
  test.skip(!existsSync(filePath), `Missing local PDF UI fixture: ${filePath}`);
}

async function startUpload(page: Page, filePath: string) {
  await page.goto('/');
  await expect(page.getByText('Select PDF Files')).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
}

async function waitForWorkspacePage(page: Page, expectedPages: number, testInfo: TestInfo, screenshotName: string) {
  await expect(page.locator('.page-count-badge')).toHaveText(String(expectedPages), { timeout: 120_000 });
  await expect(page.locator('.page-indicator-label')).toContainText(`1 / ${expectedPages}`);
  await page.locator('.pdf-page-container.ready').waitFor({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath(screenshotName), fullPage: true });
}

test.describe('Batch 2 import progress', () => {
  test('large import publishes pages and renders page 1 while analysis continues', async ({ page }, testInfo) => {
    requireFixture(fixtures.sparse665);

    await startUpload(page, fixtures.sparse665);

    await expect(
      page.locator('[data-testid="upload-import-progress"], [data-testid="workspace-import-progress"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('.page-count-badge')).toHaveText('665', { timeout: 120_000 });
    await expect(page.locator('[data-testid="workspace-import-progress"]')).toBeVisible({ timeout: 15_000 });

    const progressText = await page.locator('[data-testid="workspace-import-progress"]').textContent();
    const match = progressText?.match(/Analyzing\s+(\d+)\/665/);
    expect(match, `expected in-progress analysis text, got: ${progressText}`).not.toBeNull();
    expect(Number(match?.[1] ?? 665)).toBeLessThan(665);

    await page.locator('.page-range-input').fill('1');
    await expect(page.getByRole('button', { name: 'Save as PDF', exact: true }).first()).toBeDisabled();
    await page.locator('.page-range-input').fill('');

    await expect(page.locator('.page-indicator-label')).toContainText('1 / 665');
    await page.locator('.pdf-page-container.ready').waitFor({ timeout: 60_000 });

    await page.screenshot({ path: testInfo.outputPath('large-import-first-render-during-analysis.png'), fullPage: true });
  });

  test('Start Over during a large import cancels late work and returns to upload', async ({ page }, testInfo) => {
    requireFixture(fixtures.sparse665);

    await startUpload(page, fixtures.sparse665);
    await expect(page.locator('.page-count-badge')).toHaveText('665', { timeout: 120_000 });
    await expect(page.locator('[data-testid="workspace-import-progress"]')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Start Over', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /start over/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Start over', exact: true }).click();

    await expect(page.getByText('Select PDF Files')).toBeVisible();
    await expect(page.locator('.page-count-badge')).toHaveCount(0);

    await page.waitForTimeout(1_500);
    await expect(page.locator('.thumbnail-item')).toHaveCount(0);
    await expect(page.getByText('Select PDF Files')).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('start-over-cancelled-large-import.png'), fullPage: true });
  });

  test('Start Over undo during large import restores pages and restarts analysis', async ({ page }, testInfo) => {
    requireFixture(fixtures.sparse665);

    await startUpload(page, fixtures.sparse665);
    await expect(page.locator('.page-count-badge')).toHaveText('665', { timeout: 120_000 });
    await expect(page.locator('[data-testid="workspace-import-progress"]')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Start Over', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /start over/i });
    await dialog.getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(page.getByText('Select PDF Files')).toBeVisible();

    const undoToast = page.getByRole('status').filter({ hasText: /Cleared workspace/i });
    await expect(undoToast).toBeVisible();
    await undoToast.getByRole('button', { name: 'Undo', exact: true }).click();

    await expect(page.locator('.page-count-badge')).toHaveText('665', { timeout: 120_000 });
    await expect(page.locator('[data-testid="workspace-import-progress"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="workspace-import-progress"]')).toContainText(/Analyzing/);

    await page.screenshot({ path: testInfo.outputPath('start-over-undo-restarts-analysis.png'), fullPage: true });
  });

  test('Add PDFs to Merge shows import progress and appends pages', async ({ page }, testInfo) => {
    requireFixture(fixtures.stats27);
    requireFixture(fixtures.sparse665);

    await startUpload(page, fixtures.stats27);
    await waitForWorkspacePage(page, 27, testInfo, 'add-flow-first-document.png');
    await expect(page.locator('[data-testid="workspace-import-progress"]')).toHaveCount(0, { timeout: 60_000 });

    await page.locator('input[type="file"]').first().setInputFiles(fixtures.sparse665);
    await expect(page.locator('[data-testid="workspace-import-progress"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.page-count-badge')).toHaveText('692', { timeout: 120_000 });
    await expect(page.locator('.page-indicator-label')).toContainText('1 / 692');

    await page.screenshot({ path: testInfo.outputPath('add-flow-progress-and-appended-pages.png'), fullPage: true });
  });
});
