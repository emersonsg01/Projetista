// Ponte segura entre a interface web e o app desktop.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('projetista', {
  desktop: true,
  showFile: (f) => ipcRenderer.invoke('show-file', f),
  openExternal: (f) => ipcRenderer.invoke('open-external', f),
  gpuInfo: () => ipcRenderer.invoke('gpu-info'),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, m) => fn(m)),
  pickFile: (opts) => ipcRenderer.invoke('pick-file', opts),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  setTitleBar: (theme) => ipcRenderer.invoke('title-bar', theme),
});
