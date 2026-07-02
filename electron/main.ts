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
} from '../src/shared/types/electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

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
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

interface ValidCleanOcrInput {
  pdfBytes: Uint8Array;
  pageNumber: number;
}

interface ValidGlyphDiagnosticsInput {
  pdfBytes: Uint8Array;
  pageNumbers: number[];
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
  locateFile(filename) {
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

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const validateCleanOcrInput = (input: unknown): CleanOcrResult | ValidCleanOcrInput => {
  if (!isRecord(input)) {
    return cleanOcrFailure('invalid-input', 'Clean OCR requires a PDF byte payload and page number.');
  }

  const { pdfBytes, pageNumber } = input;
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return cleanOcrFailure('invalid-input', 'Clean OCR requires non-empty PDF bytes.');
  }

  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
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

  if (
    !Array.isArray(pageNumbers) ||
    pageNumbers.length === 0 ||
    pageNumbers.some(pageNumber => !Number.isInteger(pageNumber) || pageNumber < 1)
  ) {
    return glyphDiagnosticsFailure('page-out-of-range', 'Glyph diagnostics require positive 1-indexed page numbers.');
  }

  return { pdfBytes, pageNumbers };
};

const hasPdfHeader = (pdfBytes: Uint8Array): boolean => {
  const header = String.fromCharCode(...pdfBytes.slice(0, 1024));
  return header.includes('%PDF-');
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
    return glyphDiagnosticsFailure('sidecar-failed', `Glyph diagnostics failed: ${errorMessage(err)}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, 'favicon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
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
