'use strict';
const { DatabaseSync } = require('node:sqlite');
function openStorage(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  db.exec('CREATE TABLE IF NOT EXISTS sync_history (id INTEGER PRIMARY KEY, key TEXT NOT NULL, value TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const archive = db.prepare('INSERT INTO sync_history(key,value,reason) VALUES (?,?,?)');
  const read = db.prepare('SELECT value FROM settings WHERE key=?');
  const write = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const remove = db.prepare('DELETE FROM settings WHERE key=?');
  return {
    get(key) { return read.get(key)?.value ?? null; },
    set(key, value) { write.run(key, value); },
    remove(key) { remove.run(key); },
    batch(writes, archives = []) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const item of archives) archive.run(item.key, item.value, item.reason);
        for (const item of writes) write.run(item.key, item.value);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); }
  };
}
module.exports = { openStorage };
