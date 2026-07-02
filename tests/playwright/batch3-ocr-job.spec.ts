import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';

async function createImageOnlyFixture(filePath: string, pageCount: number) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = pdf.addPage([360, 480]);
    page.drawRectangle({
      x: 64,
      y: 96,
      width: 232,
      height: 288,
      color: rgb(0.92, 0.92, 0.92),
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
    page.drawRectangle({
      x: 96,
      y: 150 + i * 8,
      width: 168,
      height: 22,
      color: rgb(0.35, 0.35, 0.35),
    });
  }
  writeFileSync(filePath, await pdf.save());
}

async function loadPdf(page: Page, filePath: string, expectedPages: number, testInfo: TestInfo) {
  await page.goto('/');
  await expect(page.getByText('Select PDF Files')).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await expect(page.locator('.page-count-badge')).toHaveText(String(expectedPages), { timeout: 120_000 });
  await page.locator('.pdf-page-container.ready').waitFor({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath(`ocr-loaded-${expectedPages}-pages.png`), fullPage: true });
}

test.describe('Batch 3 OCR jobs', () => {
  test('selected scanned pages start a context OCR job and can be cancelled', async ({ page }, testInfo) => {
    const fixturePath = testInfo.outputPath('image-only-ocr-fixture.pdf');
    await createImageOnlyFixture(fixturePath, 3);
    await loadPdf(page, fixturePath, 3, testInfo);

    const scannedThumbnail = page.locator('.thumbnail-item').filter({
      has: page.locator('.thumbnail-ocr-badge[title="Scanned page (needs OCR)"]'),
    }).first();
    await expect(scannedThumbnail).toBeVisible({ timeout: 30_000 });
    await scannedThumbnail.click({ modifiers: ['Control'] });

    await expect(page.locator('.batch-toolbar-count')).toContainText('selected');
    page.once('dialog', async nativeDialog => {
      expect(nativeDialog.message()).toMatch(/Run OCR on \d+ pages?\?/);
      await nativeDialog.accept();
    });
    await page.locator('.batch-toolbar .batch-btn[title="OCR Selected Pages"]').click();
    await expect(page.locator('.ocr-pill')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.ocr-pill')).toContainText(/Preparing OCR|Detecting language|Recognizing text|Processing OCR/);

    await page.locator('.ocr-pill-cancel[title="Cancel OCR"]').click();
    await expect(page.locator('.ocr-pill')).toContainText('OCR cancelled');
    await expect(page.locator('.thumbnail-ocr-badge.skipped').first()).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: testInfo.outputPath('selected-ocr-job-cancelled.png'), fullPage: true });
  });
});
