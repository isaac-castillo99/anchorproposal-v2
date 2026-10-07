const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, ...args) => {
  const result = await ipcRenderer.invoke(`anchor:${name}`, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('anchor', {
  bootstrap: () => invoke('bootstrap'),
  auth: (action, data) => invoke('auth', action, data),
  logout: () => invoke('logout'),
  request: (route, method, body) => invoke('request', route, method, body),
  settings: value => invoke('settings', value),
  window: action => invoke('window', action),
  openRoute: path => invoke('openRoute', path),
  external: url => invoke('external', url),
  ready: () => invoke('ready'),
  publicRequest: route => invoke('publicRequest', route),
  upload: (route, file) => invoke('upload', route, file),
  download: (id, filename) => invoke('download', id, filename),
  paste: () => invoke('paste'),
  copy: text => invoke('copy', text),
  generate: input => invoke('generate', input),
  cancel: () => invoke('cancel'),
  export: (id, type, kind) => invoke('export', id, type, kind),
  onEvent: callback => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on('anchor:event', listener);
    return () => ipcRenderer.removeListener('anchor:event', listener);
  },
});
