import { _electron as electron, expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../../package.json' with { type: 'json' };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function getPackagedExecutablePath(): string {
  if (process.env.PACKAGED_APP_EXECUTABLE) {
    return process.env.PACKAGED_APP_EXECUTABLE;
  }

  const releaseRoot = path.join(repoRoot, 'release', packageJson.version);

  if (process.platform === 'win32') {
    return path.join(releaseRoot, 'win-unpacked', 'Antigravity PDF.exe');
  }

  if (process.platform === 'darwin') {
    return path.join(releaseRoot, 'mac', 'Antigravity PDF.app', 'Contents', 'MacOS', 'Antigravity PDF');
  }

  return path.join(releaseRoot, 'linux-unpacked', 'fast-pdf-editor');
}

export function requirePackagedExecutable() {
  const executablePath = getPackagedExecutablePath();
  testSkipIfMissing(executablePath, `Missing packaged executable: ${executablePath}. Run npm run package:dir first.`);
  return executablePath;
}

function testSkipIfMissing(filePath: string, reason: string) {
  testSkip(!existsSync(filePath), reason);
}

function testSkip(condition: boolean, reason: string) {
  if (condition) {
    throw new Error(reason);
  }
}

export async function launchPackagedApp(testInfo: TestInfo): Promise<{
  electronApp: ElectronApplication;
  page: Page;
}> {
  const executablePath = requirePackagedExecutable();
  const electronApp = await electron.launch({
    executablePath,
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    artifactsDir: testInfo.outputPath('electron-artifacts'),
    timeout: 60_000,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  const page = await electronApp.firstWindow({ timeout: 60_000 });
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.getByText('Select PDF Files')).toBeVisible({ timeout: 60_000 });

  return { electronApp, page };
}

export async function loadPdf(page: Page, filePath: string, expectedPages: number, testInfo: TestInfo) {
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await expect(page.locator('.page-count-badge')).toHaveText(String(expectedPages), { timeout: 120_000 });
  await expect(page.locator('.page-indicator-label')).toContainText(`1 / ${expectedPages}`);
  await page.locator('.pdf-page-container.ready').waitFor({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath(`packaged-loaded-${expectedPages}-pages.png`), fullPage: true });
}
