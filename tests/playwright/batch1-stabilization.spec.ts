import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

const fixtureDir = process.env.PDF_UI_FIXTURE_DIR ?? '/tmp/antigravity-pdf-ui-fixtures';

const fixtures = {
  stats27: path.join(fixtureDir, 'stats_note_27p_low_text.pdf'),
  slides62: path.join(fixtureDir, 'oop_gui_db_usecases_62p_slides.pdf'),
  sparse665: path.join(fixtureDir, 'db_book_665p_sparse_text.pdf'),
};

function requireFixture(filePath: string) {
  test.skip(!existsSync(filePath), `Missing local PDF UI fixture: ${filePath}`);
}

async function loadPdf(page: Page, filePath: string, expectedPages: number, testInfo: TestInfo) {
  await page.goto('/');
  await expect(page.getByText('Select PDF Files')).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await expect(page.locator('.page-count-badge')).toHaveText(String(expectedPages), { timeout: 120_000 });
  await expect(page.locator('.page-indicator-label')).toContainText(`1 / ${expectedPages}`);
  await page.locator('.pdf-page-container.ready').waitFor({ timeout: 60_000 });
  await expect(page.locator('[data-testid="workspace-import-progress"]')).toHaveCount(0, { timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath(`loaded-${expectedPages}-pages.png`), fullPage: true });
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

async function visibleSidebarOrder(page: Page) {
  return page.locator('.thumbnail-page-num').evaluateAll((nodes) =>
    nodes.slice(0, 8).map((node) => node.textContent?.trim() ?? ''),
  );
}

function firstRangeButton(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true }).first();
}

async function expectPageCount(page: Page, count: number) {
  await expect(page.locator('.page-count-badge')).toHaveText(String(count));
}

async function confirmDialogAction(page: Page, dialogName: RegExp, actionName: string) {
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: actionName, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function undoMutation(page: Page, description: RegExp) {
  const undoToast = page.getByRole('status').filter({ hasText: description });
  await expect(undoToast).toBeVisible();
  await undoToast.getByRole('button', { name: 'Undo', exact: true }).click();
}

async function selectThumbnail(page: Page, index: number) {
  await page.locator('.thumbnail-item').nth(index).click({ modifiers: ['Control'] });
}

async function collectDragInvariantMessages(page: Page) {
  const dragInvariantMessages: string[] = [];

  page.on('console', (message) => {
    const text = message.text();
    if (
      /invariant|draggable|droppable|drag handle|@hello-pangea|react-beautiful/i.test(text) &&
      /error|warning/.test(message.type())
    ) {
      dragInvariantMessages.push(`${message.type()}: ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    if (/invariant|draggable|droppable|drag/i.test(error.message)) {
      dragInvariantMessages.push(`pageerror: ${error.message}`);
    }
  });

  return dragInvariantMessages;
}

test.describe('Batch 1 desktop PDF regressions', () => {
  test('invalid mixed ranges expose the error and leave all range actions disabled', async ({ page }, testInfo) => {
    requireFixture(fixtures.stats27);
    await loadPdf(page, fixtures.stats27, 27, testInfo);

    await fillRange(page, '1-3, 9999');

    await expect(page.locator('.page-range-error')).toContainText('Page 9999 out of range');
    await expect
      .poll(() => enabledRangeActionNames(page), {
        message: 'mixed valid/invalid ranges must not leave destructive or selection actions enabled',
      })
      .toEqual([]);

    await page.screenshot({ path: testInfo.outputPath('invalid-mixed-range.png'), fullPage: true });
  });

  test('direct page jumps keep the sidebar active thumbnail synchronized', async ({ page }, testInfo) => {
    requireFixture(fixtures.slides62);
    await loadPdf(page, fixtures.slides62, 62, testInfo);

    await jumpToPage(page, 50, 62);

    await expect(page.locator('.thumbnail-item.active .thumbnail-page-num')).toHaveText('Page 50');
    await expect
      .poll(() => page.locator('.sidebar-scroll-container').evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);

    await page.screenshot({ path: testInfo.outputPath('direct-page-jump-sidebar-sync.png'), fullPage: true });
  });

  test('clicking a scrolled minimap row targets the clicked document page', async ({ page }, testInfo) => {
    requireFixture(fixtures.sparse665);
    await loadPdf(page, fixtures.sparse665, 665, testInfo);

    const minimap = page.locator('.document-minimap');
    await expect(minimap).toBeVisible();

    const metrics = await minimap.evaluate((node) => {
      const canvas = node.querySelector('canvas');
      if (!canvas) throw new Error('Minimap canvas was not rendered');
      const totalPages = Number(document.querySelector('.page-count-badge')?.textContent ?? '0');
      const lineSlot = canvas.getBoundingClientRect().height / totalPages;
      node.scrollTop = Math.min(lineSlot * 430, node.scrollHeight - node.clientHeight - 12);
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
      const clickY = Math.min(180, node.clientHeight - 24);
      return {
        clickY,
        lineSlot,
        scrollTop: node.scrollTop,
        totalPages,
      };
    });

    expect(metrics.scrollTop).toBeGreaterThan(0);
    const expectedPage = Math.min(
      metrics.totalPages,
      Math.max(1, Math.floor((metrics.scrollTop + metrics.clickY) / metrics.lineSlot) + 1),
    );

    await minimap.click({ position: { x: 12, y: metrics.clickY } });
    await expect(page.locator('.page-indicator-label')).toContainText(`${expectedPage} / 665`);

    await page.screenshot({ path: testInfo.outputPath('scrolled-minimap-click-target.png'), fullPage: true });
  });

  test('destructive range removal requires confirmation and can be undone', async ({ page }, testInfo) => {
    requireFixture(fixtures.stats27);
    await loadPdf(page, fixtures.stats27, 27, testInfo);

    await fillRange(page, '2-3');
    const remove = firstRangeButton(page, 'Remove');
    await expect(remove).toBeEnabled();

    await remove.click();
    const dialog = page.getByRole('dialog', { name: /remove pages in range/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Remove 2 pages/i);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectPageCount(page, 27);

    await fillRange(page, '2-3');
    await remove.click();
    await confirmDialogAction(page, /remove pages in range/i, 'Remove');
    await expectPageCount(page, 25);
    await expect(page.locator('.page-range-input')).toHaveValue('');

    await undoMutation(page, /Removed 2 pages/i);
    await expectPageCount(page, 27);

    await page.screenshot({ path: testInfo.outputPath('destructive-remove-undo.png'), fullPage: true });
  });

  test('range Keep Only requires confirmation and can be undone', async ({ page }, testInfo) => {
    requireFixture(fixtures.stats27);
    await loadPdf(page, fixtures.stats27, 27, testInfo);

    await fillRange(page, '2-4');
    const keepOnly = firstRangeButton(page, 'Keep Only');
    await expect(keepOnly).toBeEnabled();
    await keepOnly.click();

    const dialog = page.getByRole('dialog', { name: /keep only pages in range/i });
    await expect(dialog).toContainText(/Keep 3 pages and remove 24/i);
    await dialog.getByRole('button', { name: 'Keep only', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectPageCount(page, 3);
    await expect(page.locator('.page-range-input')).toHaveValue('');

    await undoMutation(page, /Kept only 3 pages/i);
    await expectPageCount(page, 27);

    await page.screenshot({ path: testInfo.outputPath('range-keep-only-undo.png'), fullPage: true });
  });

  test('thumbnail single-page removal requires confirmation and can be undone', async ({ page }, testInfo) => {
    requireFixture(fixtures.stats27);
    await loadPdf(page, fixtures.stats27, 27, testInfo);

    await page.locator('.thumbnail-remove').first().click();
    const dialog = page.getByRole('dialog', { name: /remove page/i });
    await expect(dialog).toContainText(/Remove page 1/i);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.page-indicator-label')).toContainText('1 / 27');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.locator('.thumbnail-remove').first().click();
    await expect(dialog).toContainText(/Remove page 1/i);
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectPageCount(page, 26);

    await undoMutation(page, /Removed page 1/i);
    await expectPageCount(page, 27);

    await page.screenshot({ path: testInfo.outputPath('thumbnail-remove-undo.png'), fullPage: true });
  });

  test('selected-page removal requires confirmation and can be undone', async ({ page }, testInfo) => {
    requireFixture(fixtures.stats27);
    await loadPdf(page, fixtures.stats27, 27, testInfo);

    await selectThumbnail(page, 0);
    await selectThumbnail(page, 1);
    await expect(page.locator('.batch-toolbar-count')).toHaveText('2 selected');

    await page.locator('.batch-toolbar .batch-btn[title="Remove selected"]').click();
    const dialog = page.getByRole('dialog', { name: /remove selected pages/i });
    await expect(dialog).toContainText(/Remove 2 pages/i);
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectPageCount(page, 25);

    await undoMutation(page, /Removed 2 pages/i);
    await expectPageCount(page, 27);

    await page.screenshot({ path: testInfo.outputPath('selected-remove-undo.png'), fullPage: true });
  });

  test('Start Over requires confirmation and can be undone from the upload screen', async ({ page }, testInfo) => {
    requireFixture(fixtures.stats27);
    await loadPdf(page, fixtures.stats27, 27, testInfo);

    await page.getByRole('button', { name: 'Start Over', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /start over/i });
    await expect(dialog).toContainText(/Clear all 27 pages/i);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectPageCount(page, 27);

    await page.getByRole('button', { name: 'Start Over', exact: true }).click();
    await confirmDialogAction(page, /start over/i, 'Start over');
    await expect(page.getByText('Select PDF Files')).toBeVisible();

    await undoMutation(page, /Cleared workspace/i);
    await expectPageCount(page, 27);

    await page.screenshot({ path: testInfo.outputPath('start-over-undo.png'), fullPage: true });
  });

  test('undo pauses while focused and expires after focus leaves', async ({ page }, testInfo) => {
    requireFixture(fixtures.stats27);
    await loadPdf(page, fixtures.stats27, 27, testInfo);

    await fillRange(page, '2');
    await firstRangeButton(page, 'Remove').click();
    await confirmDialogAction(page, /remove pages in range/i, 'Remove');
    await expectPageCount(page, 26);

    const undoToast = page.getByRole('status').filter({ hasText: /Removed 1 page/i });
    await expect(undoToast).toBeVisible();
    await expect(undoToast.getByRole('button', { name: 'Undo', exact: true })).toBeFocused();
    await page.waitForTimeout(8_500);
    await expect(undoToast).toBeVisible();
    await expectPageCount(page, 26);

    await page.getByRole('button', { name: 'Start Over', exact: true }).focus();
    await expect(undoToast).toBeHidden({ timeout: 9_500 });
    await expectPageCount(page, 26);

    await page.screenshot({ path: testInfo.outputPath('undo-expiry.png'), fullPage: true });
  });

  test('successful sidebar drag reorders pages and can be undone', async ({ page }, testInfo) => {
    requireFixture(fixtures.stats27);
    const dragInvariantMessages = await collectDragInvariantMessages(page);

    await loadPdf(page, fixtures.stats27, 27, testInfo);
    const beforeOrder = await visibleSidebarOrder(page);
    const handle = page.locator('.thumbnail-item').nth(1).locator('.drag-handle');
    const target = page.locator('.thumbnail-item').nth(4);
    const handleBox = await handle.boundingBox();
    const targetBox = await target.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect.poll(() => visibleSidebarOrder(page)).not.toEqual(beforeOrder);
    await expect(page.getByRole('status').filter({ hasText: /Reordered page/i })).toBeVisible();
    expect(dragInvariantMessages).toEqual([]);

    await undoMutation(page, /Reordered page/i);
    await expect.poll(() => visibleSidebarOrder(page)).toEqual(beforeOrder);

    await page.screenshot({ path: testInfo.outputPath('successful-drag-reorder-undo.png'), fullPage: true });
  });

  test('canceling a sidebar drag preserves order and emits no drag invariant console errors', async ({ page }, testInfo) => {
    requireFixture(fixtures.stats27);
    const dragInvariantMessages = await collectDragInvariantMessages(page);

    await loadPdf(page, fixtures.stats27, 27, testInfo);
    const beforeOrder = await visibleSidebarOrder(page);
    const handle = page.locator('.thumbnail-item').nth(1).locator('.drag-handle');
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 24, box!.y + box!.height / 2 + 80, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect(page.locator('.thumbnail-item.dragging')).toHaveCount(0);
    await expect.poll(() => visibleSidebarOrder(page)).toEqual(beforeOrder);
    expect(dragInvariantMessages).toEqual([]);

    await page.screenshot({ path: testInfo.outputPath('canceled-drag-no-invariant.png'), fullPage: true });
  });
});
