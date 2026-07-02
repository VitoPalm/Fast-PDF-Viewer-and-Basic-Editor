import { app, BrowserWindow, ipcMain } from 'electron';
import gsWasm from '@okathira/ghostpdl-wasm';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  type CleanOcrErrorCode,
  type CleanOcrResult,
  type GlyphDiagnosticsErrorCode,
  type GlyphDiagnosticsResult,
  type GlyphRepairErrorCode,
  type GlyphRepairResult,
} from '../src/shared/types/electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const MAX_CLEAN_OCR_PDF_BYTES = 256 * 1024 * 1024;
const MAX_CLEAN_OCR_OUTPUT_BYTES = 512 * 1024 * 1024;
const MAX_GLYPH_PDF_BYTES = 512 * 1024 * 1024;
const MAX_GLYPH_REPAIR_OUTPUT_BYTES = 768 * 1024 * 1024;
const MAX_GLYPH_PAGE_NUMBERS = 1_000;
const MAX_GLYPH_OCR_TEXT_BYTES = 2 * 1024 * 1024;
const JAVA_MAX_HEAP_ARG = '-Xmx1024m';
const JAVA_UNAVAILABLE_MESSAGE = 'Java is required for text checks and repair. Install a Java 21+ runtime or use a build with a bundled runtime.';

// Linux GPU/Wayland Stability Fixes
if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ └── main.js
// │ │ └── preload.js
// │
process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST!, '../public');


let win: BrowserWindow | null;
// 🚧 Use ['ENV_NAME'] avoid vite:define dev replacement
const isAllowedDevServerUrl = (value: string | undefined): value is string => {
  if (!value || app.isPackaged) return false;

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    );
  } catch {
    return false;
  }
};
const VITE_DEV_SERVER_URL = isAllowedDevServerUrl(process.env['VITE_DEV_SERVER_URL'])
  ? process.env['VITE_DEV_SERVER_URL']
  : undefined;

const isAllowedAppUrl = (targetUrl: string): boolean => {
  try {
    const url = new URL(targetUrl);
    if (VITE_DEV_SERVER_URL) {
      return url.origin === new URL(VITE_DEV_SERVER_URL).origin;
    }

    if (url.protocol !== 'file:') {
      return false;
    }

    const targetPath = path.normalize(fileURLToPath(url));
    const distPath = path.normalize(`${process.env.DIST}${path.sep}`);
    return targetPath === path.normalize(process.env.DIST!) || targetPath.startsWith(distPath);
  } catch {
    return false;
  }
};

interface ValidCleanOcrInput {
  pdfBytes: Uint8Array;
  pageNumber: number;
}

interface ValidGlyphDiagnosticsInput {
  pdfBytes: Uint8Array;
  pageNumbers: number[];
}

interface ValidGlyphRepairInput extends ValidGlyphDiagnosticsInput {
  replaceExistingToUnicode: boolean;
  ocrText: string | null;
}

const getGhostscriptWasmPath = (): string => (
  app.isPackaged
    ? path.join(process.resourcesPath, 'gs.wasm')
    : path.join(__dirname, '../node_modules/@okathira/ghostpdl-wasm/dist/gs.wasm')
);

const getGlyphRepairJarPath = (): string => (
  app.isPackaged
    ? path.join(process.resourcesPath, 'glyph-repair.jar')
    : path.join(__dirname, '../native/glyph-repair/target/glyph-repair.jar')
);

const loadGhostscript = () => gsWasm({
  locateFile(filename: string) {
    return filename.endsWith('.wasm') ? getGhostscriptWasmPath() : filename;
  },
});

const cleanOcrFailure = (code: CleanOcrErrorCode, message: string): CleanOcrResult => ({
  ok: false,
  error: { code, message },
});

const glyphDiagnosticsFailure = (
  code: GlyphDiagnosticsErrorCode,
  message: string,
): GlyphDiagnosticsResult => ({
  ok: false,
  error: { code, message },
});

const glyphRepairFailure = (
  code: GlyphRepairErrorCode,
  message: string,
): GlyphRepairResult => ({
  ok: false,
  error: { code, message },
});

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const isMissingJavaError = (error: unknown): boolean => (
  isRecord(error) &&
  (
    error.code === 'ENOENT' ||
    /spawn java ENOENT|java.*not found|ENOENT/i.test(errorMessage(error))
  )
);

const validateCleanOcrInput = (input: unknown): CleanOcrResult | ValidCleanOcrInput => {
  if (!isRecord(input)) {
    return cleanOcrFailure('invalid-input', 'Clean OCR requires a PDF byte payload and page number.');
  }

  const { pdfBytes, pageNumber } = input;
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return cleanOcrFailure('invalid-input', 'Clean OCR requires non-empty PDF bytes.');
  }
  if (pdfBytes.byteLength > MAX_CLEAN_OCR_PDF_BYTES) {
    return cleanOcrFailure('invalid-input', 'Clean OCR PDF payload is too large.');
  }

  if (typeof pageNumber !== 'number' || !Number.isInteger(pageNumber) || pageNumber < 1) {
    return cleanOcrFailure('page-out-of-range', 'Clean OCR page number must be a positive integer.');
  }

  return { pdfBytes, pageNumber };
};

const validateGlyphDiagnosticsInput = (input: unknown): GlyphDiagnosticsResult | ValidGlyphDiagnosticsInput => {
  if (!isRecord(input)) {
    return glyphDiagnosticsFailure('invalid-input', 'Glyph diagnostics require a PDF byte payload and page numbers.');
  }

  const { pdfBytes, pageNumbers } = input;
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return glyphDiagnosticsFailure('invalid-input', 'Glyph diagnostics require non-empty PDF bytes.');
  }
  if (pdfBytes.byteLength > MAX_GLYPH_PDF_BYTES) {
    return glyphDiagnosticsFailure('invalid-input', 'Glyph diagnostics PDF payload is too large.');
  }

  if (!Array.isArray(pageNumbers)) {
    return glyphDiagnosticsFailure(
      'page-out-of-range',
      `Glyph diagnostics require 1-${MAX_GLYPH_PAGE_NUMBERS} positive 1-indexed page numbers.`,
    );
  }

  const validPageNumbers = pageNumbers.filter((pageNumber): pageNumber is number => (
    Number.isInteger(pageNumber) && pageNumber >= 1
  ));
  if (
    validPageNumbers.length !== pageNumbers.length ||
    validPageNumbers.length === 0 ||
    validPageNumbers.length > MAX_GLYPH_PAGE_NUMBERS
  ) {
    return glyphDiagnosticsFailure(
      'page-out-of-range',
      `Glyph diagnostics require 1-${MAX_GLYPH_PAGE_NUMBERS} positive 1-indexed page numbers.`,
    );
  }

  return { pdfBytes, pageNumbers: validPageNumbers };
};

const validateGlyphRepairInput = (input: unknown): GlyphRepairResult | ValidGlyphRepairInput => {
  const validInput = validateGlyphDiagnosticsInput(input);
  if ('ok' in validInput) {
    return validInput.ok
      ? glyphRepairFailure('invalid-input', 'Glyph repair validation failed unexpectedly.')
      : glyphRepairFailure(validInput.error.code, validInput.error.message);
  }

  const { replaceExistingToUnicode, ocrText } = isRecord(input) ? input : {};
  if (replaceExistingToUnicode !== undefined && typeof replaceExistingToUnicode !== 'boolean') {
    return glyphRepairFailure('invalid-input', 'Glyph repair replaceExistingToUnicode must be a boolean.');
  }
  if (ocrText !== undefined && typeof ocrText !== 'string') {
    return glyphRepairFailure('invalid-input', 'Glyph repair OCR text must be a string.');
  }
  if (typeof ocrText === 'string' && Buffer.byteLength(ocrText, 'utf8') > MAX_GLYPH_OCR_TEXT_BYTES) {
    return glyphRepairFailure('invalid-input', 'Glyph repair OCR text is too large.');
  }

  return {
    ...validInput,
    replaceExistingToUnicode: replaceExistingToUnicode === true,
    ocrText: typeof ocrText === 'string' && ocrText.trim().length > 0 ? ocrText : null,
  };
};

const hasPdfHeader = (pdfBytes: Uint8Array): boolean => {
  const header = String.fromCharCode(...pdfBytes.slice(0, 1024));
  return header.includes('%PDF-');
};

const getUnsafeGlyphRepairValidationMessage = (report: unknown): string | null => {
  if (!isRecord(report) || typeof report.fontsRepaired !== 'number' || report.fontsRepaired <= 0) {
    return null;
  }

  const validation = report.validation;
  if (!isRecord(validation)) {
    return 'Glyph repair returned no validation report.';
  }
  if (validation.reloaded !== true) {
    return 'Glyph repair output could not be reloaded for validation.';
  }
  if (typeof validation.visualPagesCompared !== 'number' || validation.visualPagesCompared <= 0) {
    return 'Glyph repair output could not be visually validated.';
  }

  const changedPixelRatio = typeof validation.maxChangedPixelRatio === 'number'
    ? validation.maxChangedPixelRatio
    : 1;
  const maxChannelDelta = typeof validation.maxChannelDelta === 'number'
    ? validation.maxChannelDelta
    : 255;
  if (changedPixelRatio > 0.000001 || maxChannelDelta > 0) {
    return 'Glyph repair changed page appearance, so the repaired PDF was rejected.';
  }

  return null;
};

ipcMain.handle('clean-ocr-page', async (_event, input: unknown): Promise<CleanOcrResult> => {
  const validInput = validateCleanOcrInput(input);
  if ('ok' in validInput) return validInput;

  if (!hasPdfHeader(validInput.pdfBytes)) {
    return cleanOcrFailure('invalid-input', 'Clean OCR requires a valid PDF payload.');
  }

  let instance: Awaited<ReturnType<typeof gsWasm>> | null = null;
  let inputFilename: string | null = null;
  let outputFilename: string | null = null;

  try {
    instance = await loadGhostscript();
    const filenameSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    inputFilename = `/input-${filenameSuffix}.pdf`;
    outputFilename = `/output-${filenameSuffix}.pdf`;

    // Write the raw bytes into the WebAssembly virtual file system
    instance.FS.writeFile(inputFilename, validInput.pdfBytes);

    // Ghostscript command to convert fonts to paths for a specific page.
    const args = [
      '-o', outputFilename,
      '-sDEVICE=pdfwrite',
      '-dNoOutputFonts',
      `-dFirstPage=${validInput.pageNumber}`,
      `-dLastPage=${validInput.pageNumber}`,
      inputFilename
    ];

    // Execute Ghostscript inside WASM
    instance.callMain(args);

    // Read the output from the virtual file system
    const outputStats = instance.FS.stat(outputFilename) as { size?: number };
    if (typeof outputStats.size === 'number' && outputStats.size > MAX_CLEAN_OCR_OUTPUT_BYTES) {
      return cleanOcrFailure('ghostscript-failed', 'Clean OCR output is too large.');
    }
    const outputBytes = instance.FS.readFile(outputFilename);
    const pdfBytes = new Uint8Array(outputBytes.byteLength);
    pdfBytes.set(outputBytes);

    return { ok: true, pdfBytes };
  } catch (err) {
    console.error('Ghostscript WASM conversion failed:', err);
    return cleanOcrFailure('ghostscript-failed', `Ghostscript failed to clean OCR: ${errorMessage(err)}`);
  } finally {
    if (instance) {
      for (const filename of [inputFilename, outputFilename]) {
        if (!filename) continue;
        try {
          instance.FS.unlink(filename);
        } catch {
          // Ignore cleanup misses from partially completed Ghostscript runs.
        }
      }
    }
  }
});

ipcMain.handle('diagnose-glyph-text', async (_event, input: unknown): Promise<GlyphDiagnosticsResult> => {
  const validInput = validateGlyphDiagnosticsInput(input);
  if ('ok' in validInput) return validInput;

  if (!hasPdfHeader(validInput.pdfBytes)) {
    return glyphDiagnosticsFailure('invalid-input', 'Glyph diagnostics require a valid PDF payload.');
  }

  const glyphRepairJarPath = getGlyphRepairJarPath();
  try {
    await fs.access(glyphRepairJarPath);
  } catch {
    return glyphDiagnosticsFailure(
      'sidecar-unavailable',
      'Glyph diagnostics sidecar is unavailable. Build native/glyph-repair first.',
    );
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-glyph-'));
  const inputPath = path.join(tempDir, 'input.pdf');

  try {
    await fs.writeFile(inputPath, validInput.pdfBytes);
    const { stdout, stderr } = await execFileAsync(
      'java',
      [
        JAVA_MAX_HEAP_ARG,
        '-jar',
        glyphRepairJarPath,
        'diagnose',
        '--input',
        inputPath,
        '--pages',
        validInput.pageNumbers.join(','),
        '--format',
        'json',
      ],
      {
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
    );

    const trimmedStdout = stdout.trim();
    if (!trimmedStdout) {
      return glyphDiagnosticsFailure(
        'sidecar-failed',
        stderr.trim() || 'Glyph diagnostics sidecar returned no output.',
      );
    }

    try {
      return { ok: true, report: JSON.parse(trimmedStdout) };
    } catch (err) {
      return glyphDiagnosticsFailure(
        'parse-failed',
        `Glyph diagnostics sidecar returned invalid JSON: ${errorMessage(err)}`,
      );
    }
  } catch (err) {
    if (isMissingJavaError(err)) {
      return glyphDiagnosticsFailure('sidecar-unavailable', JAVA_UNAVAILABLE_MESSAGE);
    }
    return glyphDiagnosticsFailure('sidecar-failed', `Glyph diagnostics failed: ${errorMessage(err)}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

ipcMain.handle('repair-glyph-text', async (_event, input: unknown): Promise<GlyphRepairResult> => {
  const validInput = validateGlyphRepairInput(input);
  if ('ok' in validInput) {
    return validInput.ok
      ? glyphRepairFailure('invalid-input', 'Glyph repair validation failed unexpectedly.')
      : glyphRepairFailure(validInput.error.code, validInput.error.message);
  }

  if (!hasPdfHeader(validInput.pdfBytes)) {
    return glyphRepairFailure('invalid-input', 'Glyph repair requires a valid PDF payload.');
  }

  const glyphRepairJarPath = getGlyphRepairJarPath();
  try {
    await fs.access(glyphRepairJarPath);
  } catch {
    return glyphRepairFailure(
      'sidecar-unavailable',
      'Glyph repair sidecar is unavailable. Build native/glyph-repair first.',
    );
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-glyph-repair-'));
  const inputPath = path.join(tempDir, 'input.pdf');
  const outputPath = path.join(tempDir, 'output.pdf');
  const ocrTextPath = path.join(tempDir, 'ocr.txt');

  try {
    await fs.writeFile(inputPath, validInput.pdfBytes);
    if (validInput.ocrText) {
      await fs.writeFile(ocrTextPath, validInput.ocrText, 'utf8');
    }

    const sidecarArgs = [
      JAVA_MAX_HEAP_ARG,
      '-jar',
      glyphRepairJarPath,
      'repair',
      '--input',
      inputPath,
      '--output',
      outputPath,
      '--pages',
      validInput.pageNumbers.join(','),
      '--format',
      'json',
    ];
    if (validInput.replaceExistingToUnicode) {
      sidecarArgs.push('--replace-existing-to-unicode');
    }
    if (validInput.ocrText) {
      sidecarArgs.push('--ocr-text-file', ocrTextPath);
    }

    const { stdout, stderr } = await execFileAsync(
      'java',
      sidecarArgs,
      {
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
    );

    const trimmedStdout = stdout.trim();
    if (!trimmedStdout) {
      return glyphRepairFailure(
        'sidecar-failed',
        stderr.trim() || 'Glyph repair sidecar returned no output.',
      );
    }

    try {
      const report = JSON.parse(trimmedStdout);
      const validationError = getUnsafeGlyphRepairValidationMessage(report);
      if (validationError) {
        return glyphRepairFailure('sidecar-failed', validationError);
      }
      const outputStats = await fs.stat(outputPath);
      if (outputStats.size > MAX_GLYPH_REPAIR_OUTPUT_BYTES) {
        return glyphRepairFailure('sidecar-failed', 'Glyph repair output is too large.');
      }
      const repairedBytes = await fs.readFile(outputPath);
      const pdfBytes = new Uint8Array(repairedBytes.byteLength);
      pdfBytes.set(repairedBytes);
      return { ok: true, pdfBytes, report };
    } catch (err) {
      return glyphRepairFailure(
        'parse-failed',
        `Glyph repair sidecar returned invalid output: ${errorMessage(err)}`,
      );
    }
  } catch (err) {
    if (isMissingJavaError(err)) {
      return glyphRepairFailure('sidecar-unavailable', JAVA_UNAVAILABLE_MESSAGE);
    }
    return glyphRepairFailure('sidecar-failed', `Glyph repair failed: ${errorMessage(err)}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, 'favicon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    width: 1200,
    height: 800,
    backgroundColor: '#0a0a0c',
  });

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString());
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url)) {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => (
    isAllowedAppUrl(url) ? { action: 'allow' } : { action: 'deny' }
  ));

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(process.env.DIST!, 'index.html'));
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(createWindow);
