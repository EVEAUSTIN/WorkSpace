'use strict';
const { DatabaseSync } = require('node:sqlite');
function openStorage(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  const read = db.prepare('SELECT value FROM settings WHERE key=?');
  const write = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const remove = db.prepare('DELETE FROM settings WHERE key=?');
  return {
    get(key) { return read.get(key)?.value ?? null; },
    set(key, value) { write.run(key, value); },
    remove(key) { remove.run(key); },
    close() { db.close(); }
  };
}
module.exports = { openStorage };
