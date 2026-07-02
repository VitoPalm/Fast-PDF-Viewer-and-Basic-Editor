import { app, BrowserWindow, ipcMain } from 'electron';
import gsWasm from '@okathira/ghostpdl-wasm';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CleanOcrErrorCode,
  type CleanOcrResult,
} from '../src/shared/types/electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Linux GPU/Wayland Stability Fixes
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
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

const cleanOcrFailure = (code: CleanOcrErrorCode, message: string): CleanOcrResult => ({
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

const getPdfPageCount = (pdfBytes: Uint8Array): number | null => {
  const pdfText = Buffer.from(pdfBytes).toString('latin1');
  if (!pdfText.slice(0, 1024).includes('%PDF-')) return null;

  const pageObjectMatches = pdfText.match(/\/Type\s*\/Page(?!s)\b/g);
  if (pageObjectMatches && pageObjectMatches.length > 0) {
    return pageObjectMatches.length;
  }

  const countMatches = [...pdfText.matchAll(/\/Count\s+(\d+)/g)]
    .map(match => Number.parseInt(match[1] ?? '0', 10))
    .filter(count => Number.isInteger(count) && count > 0);

  if (countMatches.length === 0) return null;
  return Math.max(...countMatches);
};

const validateCleanOcrPageRange = (
  pdfBytes: Uint8Array,
  pageNumber: number,
): CleanOcrResult | { pageCount: number } => {
  const pageCount = getPdfPageCount(pdfBytes);
  if (pageCount === null) {
    return cleanOcrFailure('invalid-input', 'Clean OCR could not read the PDF bytes.');
  }

  if (pageNumber > pageCount) {
    return cleanOcrFailure(
      'page-out-of-range',
      `Clean OCR page ${pageNumber} is outside this ${pageCount}-page PDF.`,
    );
  }

  return { pageCount };
};

ipcMain.handle('clean-ocr-page', async (_event, input: unknown): Promise<CleanOcrResult> => {
  const validInput = validateCleanOcrInput(input);
  if ('ok' in validInput) return validInput;

  const rangeValidation = validateCleanOcrPageRange(validInput.pdfBytes, validInput.pageNumber);
  if ('ok' in rangeValidation) return rangeValidation;

  let instance: Awaited<ReturnType<typeof gsWasm>> | null = null;
  let inputFilename: string | null = null;
  let outputFilename: string | null = null;

  try {
    instance = await gsWasm();
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
