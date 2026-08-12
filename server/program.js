'use strict';

const db = require('./db');
const { computeRows, roundToIncrement } = require('./program-template');

const DEFAULT_SETTINGS = {
  starting_1rm: '285',
  new_1rm: '315',
  units: 'lb',
  rounding: '5',
  week4_add: '20',
  week5_add: '30',
};

// Segments already logged on the spreadsheet before this app existed
// (Week 1 / Day 1, all four segments). Imported once at seed time so the
// app starts in sync with real progress. Matched by (week, day, segment).
const INITIAL_LOG = [
  { week: 1, day: 1, segment: '1', actualWeight: 185, setsDone: 3, repsDone: 8, rpe: 6, date: '2026-08-10', notes: null },
  { week: 1, day: 1, segment: '2', actualWeight: 200, setsDone: 1, repsDone: 5, rpe: 6, date: '2026-08-10', notes: null },
  { week: 1, day: 1, segment: '3', actualWeight: 210, setsDone: 2, repsDone: 2, rpe: 6, date: '2026-08-10', notes: "Didn't count the weight right" },
  { week: 1, day: 1, segment: '4', actualWeight: 230, setsDone: 1, repsDone: 1, rpe: 6, date: '2026-08-10', notes: null },
];

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { ...DEFAULT_SETTINGS };
  rows.forEach((r) => { settings[r.key] = r.value; });
  return settings;
}

function setSettings(partial) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const tx = db.transaction((entries) => {
    entries.forEach(([k, v]) => upsert.run(k, String(v)));
  });
  tx(Object.entries(partial));
  return getSettings();
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM segments').get().n;
  if (count > 0) return;

  const existing = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  if (existing === 0) setSettings(DEFAULT_SETTINGS);

  const settings = getSettings();
  const rows = computeRows(settings);

  const insert = db.prepare(`
    INSERT INTO segments
      (phase, week, day, segment, sets, reps, pct, one_rm_ref, base_add_ref,
       one_rm_basis, base_add, target_weight, status, sort_order, guidance, special)
    VALUES
      (@phase, @week, @day, @segment, @sets, @reps, @pct, @oneRmRef, @baseAddRef,
       @oneRmBasis, @baseAdd, @targetWeight, 'planned', @sortOrder, @guidance, @special)
  `);

  const tx = db.transaction((allRows) => {
    allRows.forEach((r) => insert.run(r));
  });
  tx(rows);

  // Apply already-completed log entries from the original spreadsheet.
  const markDone = db.prepare(`
    UPDATE segments SET
      status = 'complete', actual_weight = ?, sets_done = ?, reps_done = ?,
      rpe = ?, date = ?, notes = ?
    WHERE week = ? AND day = ? AND segment = ?
  `);
  const tx2 = db.transaction((entries) => {
    entries.forEach((e) => {
      markDone.run(e.actualWeight, e.setsDone, e.repsDone, e.rpe, e.date, e.notes, e.week, e.day, e.segment);
    });
  });
  tx2(INITIAL_LOG);
}

// Recompute target_weight/one_rm_basis/base_add for rows that are still
// 'planned' (i.e. not yet logged), using the current settings. Completed
// rows keep their historical target untouched.
function regeneratePlanned() {
  const settings = getSettings();
  const computed = computeRows(settings);
  const update = db.prepare(`
    UPDATE segments SET one_rm_basis = ?, base_add = ?, target_weight = ?
    WHERE week = ? AND day = ? AND segment = ? AND status != 'complete'
  `);
  const tx = db.transaction((rows) => {
    rows.forEach((r) => {
      update.run(r.oneRmBasis, r.baseAdd, r.targetWeight, r.week, r.day, r.segment);
    });
  });
  tx(computed);
}

module.exports = { getSettings, setSettings, seedIfEmpty, regeneratePlanned, roundToIncrement };
