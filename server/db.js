'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'smolov.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
try {
  // WAL improves concurrent read/write behavior, but isn't supported on
  // every filesystem (e.g. some network/overlay mounts) — fall back quietly.
  db.exec('PRAGMA journal_mode = WAL');
} catch (err) {
  // default rollback-journal mode is fine for a single-process app
}

// better-sqlite3-style helper: run fn() inside a transaction.
db.transaction = function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phase TEXT NOT NULL,
    week INTEGER NOT NULL,
    day INTEGER NOT NULL,
    segment TEXT NOT NULL,
    sets INTEGER,
    reps INTEGER,
    pct REAL,
    one_rm_ref TEXT,
    base_add_ref TEXT,
    one_rm_basis REAL,
    base_add REAL,
    target_weight REAL,
    status TEXT NOT NULL DEFAULT 'planned',
    actual_weight REAL,
    sets_done INTEGER,
    reps_done INTEGER,
    rpe REAL,
    date TEXT,
    notes TEXT,
    guidance TEXT,
    special TEXT,
    sort_order INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS day_notes (
    week INTEGER NOT NULL,
    day INTEGER NOT NULL,
    note TEXT,
    updated_at TEXT,
    PRIMARY KEY (week, day)
  );

  CREATE TABLE IF NOT EXISTS lift_notes (
    lift TEXT PRIMARY KEY,
    note TEXT,
    updated_at TEXT
  );
`);

module.exports = db;
