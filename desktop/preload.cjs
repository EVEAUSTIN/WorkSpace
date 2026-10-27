'use strict';
const { contextBridge, ipcRenderer } = require('electron');
function request(operation, key, value) {
  const result = ipcRenderer.sendSync('qijian:storage', operation, String(key), value);
  if (!result || result.error) throw Error(result?.error || '本地数据库没有响应');
  return result.value;
}
contextBridge.exposeInMainWorld('qijianDesktop', {
  storage: {
    getItem: key => request('get', key),
    setItem: (key, value) => request('set', key, String(value)),
    removeItem: key => request('remove', key)
  }
});
