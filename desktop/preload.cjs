'use strict';
const { contextBridge, ipcRenderer } = require('electron');
function request(operation, key, value) {
  const result = ipcRenderer.sendSync('qijian:storage', operation, String(key), value);
  if (!result || result.error) throw Error(result?.error || '本地数据库没有响应');
  return result.value;
}
contextBridge.exposeInMainWorld('qijianDesktop', {
  journalMetric: issn => ipcRenderer.invoke('qijian:journal-metric', issn),
  update: action => ipcRenderer.invoke('qijian:update', action),
  onUpdate: callback => {
    const handler=(_event,state)=>callback(state);
    ipcRenderer.on('qijian:update-state',handler);
    return ()=>ipcRenderer.removeListener('qijian:update-state',handler);
  },
  commit: (writes, archives = []) => request('batch', 'desktop:sync-meta', {writes, archives}),
  storage: {
    getItem: key => request('get', key),
    setItem: (key, value) => request('set', key, String(value)),
    removeItem: key => request('remove', key)
  }
});
