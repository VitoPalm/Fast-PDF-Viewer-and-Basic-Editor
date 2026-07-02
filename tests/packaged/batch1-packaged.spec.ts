import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { launchPackagedApp, loadPdf } from './packagedApp';

const fixtureDir = process.env.PDF_UI_FIXTURE_DIR ?? '/tmp/antigravity-pdf-ui-fixtures';

const fixtures = {
  stats27: path.join(fixtureDir, 'stats_note_27p_low_text.pdf'),
  slides62: path.join(fixtureDir, 'oop_gui_db_usecases_62p_slides.pdf'),
  sparse665: path.join(fixtureDir, 'db_book_665p_sparse_text.pdf'),
};

type CleanOcrResultLike =
  | { ok: true; pdfBytes: Uint8Array }
  | { ok: false; error: { code: string; message: string } };

type GlyphDiagnosticsResultLike =
  | { ok: true; report: { pageCount: number; pagesAnalyzed: number; fontCount: number; glyphEvents: number } }
  | { ok: false; error: { code: string; message: string } };

type GlyphRepairResultLike =
  | { ok: true; pdfBytes: Uint8Array; report: { pageCount: number; pagesAnalyzed: number; fontsRepaired: number; mappingsAdded: number } }
  | { ok: false; error: { code: string; message: string } };

type PackagedBridgeWindow = Window & {
  antigravityPdf?: {
    cleanOcrPage(input: { pdfBytes: Uint8Array; pageNumber: number }): Promise<CleanOcrResultLike>;
    diagnoseGlyphText(input: { pdfBytes: Uint8Array; pageNumbers: number[] }): Promise<GlyphDiagnosticsResultLike>;
    repairGlyphText(input: { pdfBytes: Uint8Array; pageNumbers: number[] }): Promise<GlyphRepairResultLike>;
  };
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

async function createCleanOcrProbePdfBytes() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([180, 120]);
  page.drawText('Clean OCR probe', {
    x: 24,
    y: 64,
    size: 14,
    color: rgb(0, 0, 0),
  });
  return new Uint8Array(await pdf.save());
}

test.describe('Packaged app Batch 1 smoke regressions', () => {
  test('packaged preload exposes typed Clean OCR bridge and rejects invalid input', async ({ browserName }, testInfo) => {
    void browserName;
    const { electronApp, page } = await launchPackagedApp(testInfo);

    try {
      const bridgeShape = await page.evaluate(() => {
        const bridge = (window as PackagedBridgeWindow).antigravityPdf;
        return {
          hasBridge: Boolean(bridge),
          hasCleanOcrPage: typeof bridge?.cleanOcrPage === 'function',
          hasDiagnoseGlyphText: typeof bridge?.diagnoseGlyphText === 'function',
          hasRepairGlyphText: typeof bridge?.repairGlyphText === 'function',
        };
      });

      expect(bridgeShape).toEqual({
        hasBridge: true,
        hasCleanOcrPage: true,
        hasDiagnoseGlyphText: true,
        hasRepairGlyphText: true,
      });

      const invalidResult = await page.evaluate(async () => {
        const bridge = (window as PackagedBridgeWindow).antigravityPdf;
        if (!bridge) {
          return { ok: false, error: { code: 'missing-bridge', message: 'Missing bridge.' } };
        }
        return bridge.cleanOcrPage({ pdfBytes: new Uint8Array(), pageNumber: 1 });
      });

      expect(invalidResult).toMatchObject({
        ok: false,
        error: { code: 'invalid-input' },
      });

      const validPdfBytes = await createCleanOcrProbePdfBytes();
      const validResult = await page.evaluate(async (bytes) => {
        const bridge = (window as PackagedBridgeWindow).antigravityPdf;
        if (!bridge) {
          return { ok: false, error: { code: 'missing-bridge', message: 'Missing bridge.' } };
        }
        const result = await bridge.cleanOcrPage({ pdfBytes: new Uint8Array(bytes), pageNumber: 1 });
        return result.ok
          ? { ok: true, byteLength: result.pdfBytes.byteLength }
          : result;
      }, Array.from(validPdfBytes));

      expect(validResult.ok).toBe(true);
      if (validResult.ok) {
        expect(validResult.byteLength).toBeGreaterThan(0);
      }

      const glyphResult = await page.evaluate(async (bytes) => {
        const bridge = (window as PackagedBridgeWindow).antigravityPdf;
        if (!bridge) {
          return { ok: false, error: { code: 'missing-bridge', message: 'Missing bridge.' } };
        }
        return bridge.diagnoseGlyphText({ pdfBytes: new Uint8Array(bytes), pageNumbers: [1] });
      }, Array.from(validPdfBytes));

      expect(glyphResult.ok).toBe(true);
      if (glyphResult.ok) {
        expect(glyphResult.report).toMatchObject({
          pageCount: 1,
          pagesAnalyzed: 1,
        });
        expect(glyphResult.report.fontCount).toBeGreaterThan(0);
        expect(glyphResult.report.glyphEvents).toBeGreaterThan(0);
      }

      const repairResult = await page.evaluate(async (bytes) => {
        const bridge = (window as PackagedBridgeWindow).antigravityPdf;
        if (!bridge) {
          return { ok: false, error: { code: 'missing-bridge', message: 'Missing bridge.' } };
        }
        const result = await bridge.repairGlyphText({ pdfBytes: new Uint8Array(bytes), pageNumbers: [1] });
        return result.ok
          ? {
              ok: true,
              byteLength: result.pdfBytes.byteLength,
              report: result.report,
            }
          : result;
      }, Array.from(validPdfBytes));

      expect(repairResult.ok).toBe(true);
      if (repairResult.ok) {
        expect(repairResult.byteLength).toBeGreaterThan(0);
        expect(repairResult.report.fontsRepaired).toBeGreaterThan(0);
        expect(repairResult.report.mappingsAdded).toBeGreaterThan(0);
      }
    } finally {
      await electronApp.close();
    }
  });

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
      await confirmDialogAction(page, /remove pages in range/i, 'Remove');
      await expect(page.locator('.page-count-badge')).toHaveText('25');
      await expect(page.locator('.page-range-input')).toHaveValue('');

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
