// Secure bridge between renderer and main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  getPacks: () => ipcRenderer.invoke('pet:get-packs'),
  getScreenSize: () => ipcRenderer.invoke('pet:get-screen-size'),
  getPosition: () => ipcRenderer.invoke('pet:get-position'),
  getSize: () => ipcRenderer.invoke('pet:get-size'),
  setSize: (size) => ipcRenderer.invoke('pet:set-size', size),
  canShow: () => ipcRenderer.invoke('pet:can-show'),
  show: () => ipcRenderer.invoke('pet:show'),
  pickImageFile: () => ipcRenderer.invoke('pet:pick-image-file'),
  showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
  reportAction: (name) => ipcRenderer.send('pet:report-action', name),
  reportPack: (name) => ipcRenderer.send('pet:report-pack', name),
  move: (x, y) => ipcRenderer.send('pet:move', { x, y }),
  setIgnoreMouseEvents: (ignore, opts) => ipcRenderer.send('pet:set-ignore-mouse', { ignore, opts }),

  onSetAction: (cb) => ipcRenderer.on('pet:set-action', (_e, name) => cb(name)),
  onLoadPack: (cb) => ipcRenderer.on('pet:load-pack', (_e, name) => cb(name)),
  onSetSize: (cb) => ipcRenderer.on('pet:size-changed', (_e, size) => cb(size)),
  onReloadConfig: (cb) => ipcRenderer.on('pet:reload-config', () => cb())
});

contextBridge.exposeInMainWorld('panelAPI', {
  getAssets: () => ipcRenderer.invoke('panel:get-assets'),
  canShowPet: () => ipcRenderer.invoke('panel:can-show-pet'),
  showPet: () => ipcRenderer.invoke('panel:show-pet'),
  deleteAsset: (name) => ipcRenderer.invoke('panel:delete-asset', name),
  uploadVideo: (filePath, onProgress) => {
    const listener = (_e, progress) => onProgress(progress);
    ipcRenderer.on('panel:upload-progress', listener);
    return ipcRenderer.invoke('panel:upload-video', filePath).finally(() => {
      ipcRenderer.removeListener('panel:upload-progress', listener);
    });
  },
  getConfig: () => ipcRenderer.invoke('panel:get-config'),
  saveAction: (name, data) => ipcRenderer.invoke('panel:save-action', name, data),
  deleteAction: (name) => ipcRenderer.invoke('panel:delete-action', name),
  getMessages: () => ipcRenderer.invoke('panel:get-messages'),
  saveMessage: (index, text) => ipcRenderer.invoke('panel:save-message', index, text),
  deleteMessage: (index) => ipcRenderer.invoke('panel:delete-message', index),
  getPetName: () => ipcRenderer.invoke('panel:get-pet-name'),
  getPetNames: () => ipcRenderer.invoke('panel:get-pet-names'),
  savePetName: (payload) => ipcRenderer.invoke('panel:save-pet-name', payload),
  deletePetName: (name) => ipcRenderer.invoke('panel:delete-pet-name', name),
  getPetSize: () => ipcRenderer.invoke('pet:get-size'),
  setPetSize: (size) => ipcRenderer.invoke('pet:set-size', size),
  saveOrchestration: (data) => ipcRenderer.invoke('panel:save-orchestration', data),
  focusWindow: () => ipcRenderer.invoke('panel:focus-window')
});
