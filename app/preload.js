const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capri', {
  ask: (text) => ipcRenderer.send('ask', text),
  micDown: () => ipcRenderer.send('mic-down'),
  micUp: () => ipcRenderer.send('mic-up'),
  hangUp: () => ipcRenderer.send('hang-up'),
  clear: () => ipcRenderer.send('clear'),
  eye: (on) => ipcRenderer.send('eye', on),
  hover: (over) => ipcRenderer.send('hover', over),
  dockHover: (over) => ipcRenderer.send('dock-hover', over),
  dockClick: () => ipcRenderer.send('dock-click'),
  ping: () => ipcRenderer.send('ping'),
  assets: () => ipcRenderer.invoke('assets'),
  skin: () => ipcRenderer.invoke('skin'),
  mode: () => ipcRenderer.invoke('mode'),
  setMode: (m) => ipcRenderer.send('set-mode', m),
  closePanel: () => ipcRenderer.send('panel-close'),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, ...args) => fn(...args)),
});
