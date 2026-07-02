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

    const scannedThumbnailButton = page.getByRole('button', { name: /Open page 1 .* OCR candidate/i });
    await expect(scannedThumbnailButton).toBeVisible({ timeout: 30_000 });
    await scannedThumbnailButton.click({ modifiers: ['Control'] });

    await expect(page.locator('.batch-toolbar-count')).toContainText('selected');
    await page.getByRole('button', { name: /OCR \d+ selected page/i }).click();
    const dialog = page.getByRole('dialog', { name: /OCR selected pages/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Run OCR on \d+ selected pages?/);
    await dialog.getByRole('button', { name: 'Run OCR', exact: true }).click();

    await expect(page.locator('.ocr-pill')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.ocr-pill')).toContainText(/Preparing OCR|Detecting language|Recognizing text|Processing OCR/);

    await page.locator('.ocr-pill-cancel[title="Cancel OCR"]').click();
    await expect(page.locator('.ocr-pill')).toContainText('OCR cancelled');
    await expect(page.getByRole('button', { name: /OCR skipped/i }).first()).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: testInfo.outputPath('selected-ocr-job-cancelled.png'), fullPage: true });
  });
});
