import { contextBridge, ipcRenderer } from 'electron';
import { type AntigravityPdfBridge } from '../src/shared/types/electron';

const antigravityPdfBridge: AntigravityPdfBridge = {
  cleanOcrPage(input) {
    return ipcRenderer.invoke('clean-ocr-page', input);
  },
};

contextBridge.exposeInMainWorld('antigravityPdf', antigravityPdfBridge);
