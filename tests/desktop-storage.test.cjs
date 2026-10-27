'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { openStorage } = require('../desktop/storage.cjs');
test('records and notebook survive restart; deletion persists; SQL-like keys stay data', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qijian-test-'));
  try {
    const file = path.join(dir, 'workspace.sqlite');
    let store = openStorage(file);
    const payload = JSON.stringify({ notes: [{ title: '中文笔记', html: '<b>内容</b>' }], folders: [] });
    store.set('desktop:notebook', payload);
    store.set("qijian-'; DROP TABLE settings; --", 'safe');
    store.set('qijian-status-v1', '[1]');
    store.set('qijian-status-v1', '[2]');
    store.remove('qijian-status-v1');
    store.close();
    store = openStorage(file);
    assert.equal(store.get('desktop:notebook'), payload);
    assert.equal(store.get("qijian-'; DROP TABLE settings; --"), 'safe');
    assert.equal(store.get('qijian-status-v1'), null);
    assert.equal(store.get('qijian-absent'), null);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('sync checkpoints and incoming records commit atomically, failed batch rolls back', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qijian-atomic-'));
  try {
    const store = openStorage(path.join(dir, 'workspace.sqlite'));
    store.set('qijian-memos-v1', 'old');
    store.batch([{key:'qijian-memos-v1',value:'new'},{key:'desktop:sync-meta',value:'checkpoint'}],[{key:'qijian-memos-v1',value:'old',reason:'remote-apply'}]);
    assert.equal(store.get('qijian-memos-v1'), 'new');
    assert.equal(store.get('desktop:sync-meta'), 'checkpoint');
    assert.throws(()=>store.batch([{key:'qijian-memos-v1',value:'bad'},{key:'desktop:sync-meta',value:null}]));
    assert.equal(store.get('qijian-memos-v1'), 'new');
    assert.equal(store.get('desktop:sync-meta'), 'checkpoint');
    store.close();
  } finally { rmSync(dir, { recursive:true, force:true }); }
});
