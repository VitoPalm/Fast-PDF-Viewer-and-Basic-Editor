import { app, BrowserWindow, ipcMain } from 'electron';
import gsWasm from '@okathira/ghostpdl-wasm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

ipcMain.handle('convert-text-to-paths', async (event, pdfBytes: Uint8Array, pageIndex: number) => {
  try {
    const instance = await gsWasm();
    const inputFilename = `/input-${Date.now()}.pdf`;
    const outputFilename = `/output-${Date.now()}.pdf`;

    // Write the raw bytes into the WebAssembly virtual file system
    instance.FS.writeFile(inputFilename, pdfBytes);

    // Ghostscript command to convert fonts to paths for a specific page.
    const pageNum = pageIndex + 1;
    const args = [
      '-o', outputFilename,
      '-sDEVICE=pdfwrite',
      '-dNoOutputFonts',
      `-dFirstPage=${pageNum}`,
      `-dLastPage=${pageNum}`,
      inputFilename
    ];

    // Execute Ghostscript inside WASM
    instance.callMain(args);

    // Read the output from the virtual file system
    const outputBytes = instance.FS.readFile(outputFilename);

    // Cleanup virtual file system
    instance.FS.unlink(inputFilename);
    instance.FS.unlink(outputFilename);

    return outputBytes;
  } catch (err) {
    console.error("Ghostscript WASM conversion failed:", err);
    throw err;
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
