import { contextBridge, ipcRenderer } from 'electron';
import { type AntigravityPdfBridge } from '../src/shared/types/electron';

const antigravityPdfBridge: AntigravityPdfBridge = {
  cleanOcrPage(input) {
    return ipcRenderer.invoke('clean-ocr-page', input);
  },
  diagnoseGlyphText(input) {
    return ipcRenderer.invoke('diagnose-glyph-text', input);
  },
  repairGlyphText(input) {
    return ipcRenderer.invoke('repair-glyph-text', input);
  },
};

contextBridge.exposeInMainWorld('antigravityPdf', antigravityPdfBridge);
