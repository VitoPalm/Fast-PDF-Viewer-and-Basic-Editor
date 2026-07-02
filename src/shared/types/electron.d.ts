export type IpcRendererListener = (event: unknown, ...args: unknown[]) => void;

export interface IpcRenderer {
  on: (channel: string, listener: IpcRendererListener) => IpcRenderer;
  off: (channel: string, ...listeners: IpcRendererListener[]) => IpcRenderer;
  send: (channel: string, ...args: unknown[]) => void;
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
}

declare global {
  interface Window {
    ipcRenderer: IpcRenderer;
  }
}
