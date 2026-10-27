'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openStorage } = require('./storage.cjs');
let database;
let mainWindow;
const entry = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(() => {
    database = openStorage(path.join(app.getPath('userData'), 'workspace.sqlite'));
    ipcMain.on('qijian:storage', (event, operation, key, value) => {
      try {
        if (event.senderFrame !== mainWindow?.webContents.mainFrame || event.senderFrame.url !== entry) throw Error('不允许的存储来源');
        if (typeof key !== 'string' || key.length > 200 || !/^(qijian[-:]|desktop:)/.test(key)) throw Error('不允许的存储键');
        if (operation === 'get') event.returnValue = { value: database.get(key) };
        else if (operation === 'set' && typeof value === 'string' && Buffer.byteLength(value) <= 100 * 1024 * 1024) { database.set(key, value); event.returnValue = { value: null }; }
        else if (operation === 'remove') { database.remove(key); event.returnValue = { value: null }; }
        else throw Error('无效存储操作');
      } catch { event.returnValue = { error: '本地数据库操作失败，原记录未被主动清空。' }; }
    });
    mainWindow = new BrowserWindow({ width: 1320, height: 900, minWidth: 760, minHeight: 600, title: '栖间工作台', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      else if (url === pathToFileURL(path.join(__dirname, '..', 'cloudbase-test.html')).href) shell.openExternal('https://eveaustin.github.io/WorkSpace/cloudbase-test.html');
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault(); });
    mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    mainWindow.loadURL(entry);
  }).catch(() => { dialog.showErrorBox('启动失败', '无法打开本地数据库。请检查应用数据目录权限和磁盘空间。'); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => database?.close());
}
