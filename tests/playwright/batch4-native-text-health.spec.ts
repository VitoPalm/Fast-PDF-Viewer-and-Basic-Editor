import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

type BridgeWindow = Window & {
  antigravityPdf?: unknown;
};

async function createImageOnlyFixture(filePath: string) {
  const pdf = await PDFDocument.create();
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
    y: 168,
    width: 168,
    height: 22,
    color: rgb(0.35, 0.35, 0.35),
  });
  writeFileSync(filePath, await pdf.save());
}

async function createHealthyTextFixture(filePath: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([420, 540]);
  page.drawText('This page contains readable native PDF text.', {
    x: 48,
    y: 460,
    size: 14,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText('The text layer should remain selectable in the browser renderer.', {
    x: 48,
    y: 430,
    size: 12,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText('Numbers 12345 and punctuation, commas, and periods are normal.', {
    x: 48,
    y: 400,
    size: 12,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText('Additional lines keep the document out of sparse detection.', {
    x: 48,
    y: 370,
    size: 12,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText('A final readable sentence confirms healthy extraction.', {
    x: 48,
    y: 340,
    size: 12,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  writeFileSync(filePath, await pdf.save());
}

async function loadPdf(page: Page, filePath: string, testInfo: TestInfo) {
  await page.goto('/');
  await expect(page.getByText('Select PDF Files')).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await expect(page.locator('.page-count-badge')).toHaveText('1', { timeout: 60_000 });
  await page.locator('.pdf-page-container.ready').waitFor({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath(`batch4-${filePath.split('/').pop()}.png`), fullPage: true });
}

test.describe('Batch 4 native bridge and text health', () => {
  test('browser renderer has no native bridge and image-only pages still route to OCR', async ({ page }, testInfo) => {
    const fixturePath = testInfo.outputPath('batch4-image-only.pdf');
    await createImageOnlyFixture(fixturePath);
    await loadPdf(page, fixturePath, testInfo);

    const bridgeType = await page.evaluate(() => typeof (window as BridgeWindow).antigravityPdf);
    expect(bridgeType).toBe('undefined');

    await expect(page.getByRole('button', { name: /OCR candidate/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /OCR Page/i })).toBeVisible();
  });

  test('healthy native text remains selectable in the rendered text layer', async ({ page }, testInfo) => {
    const fixturePath = testInfo.outputPath('batch4-healthy-text.pdf');
    await createHealthyTextFixture(fixturePath);
    await loadPdf(page, fixturePath, testInfo);

    await expect.poll(() => page.locator('div.textLayer span').count()).toBeGreaterThan(0);
    await expect(page.getByText('Text layer appears suspect')).toHaveCount(0);
  });
});
