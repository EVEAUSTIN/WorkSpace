'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const { startServer, ORIGIN } = require('./server.cjs');
const { openStorage } = require('./storage.cjs');
let database;
let mainWindow;
app.setPath('userData', path.join(app.getPath('appData'), 'qijian-workspace'));
const entry = ORIGIN + '/index.html';
let server;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    server = await startServer(path.join(__dirname, '..'));
    database = openStorage(path.join(app.getPath('userData'), 'workspace.sqlite'));
    ipcMain.on('qijian:storage', (event, operation, key, value) => {
      try {
        if (event.senderFrame !== mainWindow?.webContents.mainFrame || event.senderFrame.url !== entry) throw Error('不允许的存储来源');
        if (typeof key !== 'string' || key.length > 200 || !/^(qijian[-:]|desktop:)/.test(key)) throw Error('不允许的存储键');
        if (operation === 'batch') {
          const valid = item => item && typeof item.key === 'string' && item.key.length <= 200 && /^(qijian[-:]|desktop:)/.test(item.key) && typeof item.value === 'string' && Buffer.byteLength(item.value) <= 100 * 1024 * 1024;
          if (!value || !Array.isArray(value.writes) || !Array.isArray(value.archives) || value.writes.length > 10 || value.archives.length > 10 || !value.writes.every(valid) || !value.archives.every(item => valid(item) && typeof item.reason === 'string' && item.reason.length < 100)) throw Error('无效事务');
          database.batch(value.writes, value.archives); event.returnValue = { value: null };
        }
        else if (operation === 'get') event.returnValue = { value: database.get(key) };
        else if (operation === 'set' && typeof value === 'string' && Buffer.byteLength(value) <= 100 * 1024 * 1024) { database.set(key, value); event.returnValue = { value: null }; }
        else if (operation === 'remove') { database.remove(key); event.returnValue = { value: null }; }
        else throw Error('无效存储操作');
      } catch { event.returnValue = { error: '本地数据库操作失败，原记录未被主动清空。' }; }
    });
    mainWindow = new BrowserWindow({ width: 1320, height: 900, minWidth: 760, minHeight: 600, title: '栖间工作台', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url === ORIGIN + '/cloudbase-test.html') shell.openExternal('https://eveaustin.github.io/WorkSpace/cloudbase-test.html');
      else if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault(); });
    mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    mainWindow.loadURL(entry);
  }).catch(() => { dialog.showErrorBox('启动失败', '无法启动应用。请检查本地端口 17383 是否被占用，以及应用数据目录权限和磁盘空间。'); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { database?.close(); server?.close(); });
}
