import { defineConfig } from '@playwright/test';

const artifactRoot = 'output/playwright';

export default defineConfig({
  testDir: './tests/packaged',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: `${artifactRoot}/packaged/results.json` }],
    ['html', { outputFolder: `${artifactRoot}/packaged/html-report`, open: 'never' }],
  ],
  outputDir: `${artifactRoot}/packaged/test-results`,
  use: {
    viewport: { width: 1440, height: 960 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
