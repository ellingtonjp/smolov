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
//
// Nestable, because some operations are built by composing smaller wrapped
// ones — a unit change is a settings write plus a weight conversion plus a
// recalc, and it must commit or fail as a whole. A plain BEGIN inside a BEGIN
// is an error in SQLite, so inner levels use savepoints and only the outermost
// level actually commits.
let txDepth = 0;
db.transaction = function transaction(fn) {
  return (...args) => {
    const savepoint = `sp_${txDepth}`;
    const outermost = txDepth === 0;
    db.exec(outermost ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
    txDepth += 1;
    try {
      const result = fn(...args);
      db.exec(outermost ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (err) {
      // ROLLBACK TO leaves the savepoint itself in place, so release it too —
      // otherwise a retry at the same depth would reuse a stale name.
      if (outermost) db.exec('ROLLBACK');
      else db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw err;
    } finally {
      txDepth -= 1;
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
    set_number INTEGER,
    total_sets INTEGER,
    reps INTEGER,
    pct REAL,
    one_rm_ref TEXT,
    base_add_ref TEXT,
    one_rm_basis REAL,
    base_add REAL,
    target_weight REAL,
    status TEXT NOT NULL DEFAULT 'planned',
    actual_weight REAL,
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
