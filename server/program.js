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

// Sets already logged on the spreadsheet before this app existed (Week 1 /
// Day 1, all four prescribed blocks). Imported once at seed time, one row
// per individual set, so the app starts in sync with real progress.
// Matched by (week, day, segment, set_number).
function expandInitialLog(week, day, segment, setNumbers, fields) {
  const { notes, ...rest } = fields;
  return setNumbers.map((setNumber, i) => ({
    week, day, segment, setNumber,
    ...rest,
    notes: i === 0 ? (notes || null) : null,
  }));
}

const INITIAL_LOG = [
  ...expandInitialLog(1, 1, '1', [1, 2, 3], { actualWeight: 185, repsDone: 8, rpe: 6, date: '2026-08-10' }),
  ...expandInitialLog(1, 1, '2', [1], { actualWeight: 200, repsDone: 5, rpe: 6, date: '2026-08-10' }),
  ...expandInitialLog(1, 1, '3', [1, 2], { actualWeight: 210, repsDone: 2, rpe: 6, date: '2026-08-10', notes: "Didn't count the weight right" }),
  ...expandInitialLog(1, 1, '4', [1], { actualWeight: 230, repsDone: 1, rpe: 6, date: '2026-08-10' }),
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
      (phase, week, day, segment, set_number, total_sets, reps, pct, one_rm_ref, base_add_ref,
       one_rm_basis, base_add, target_weight, status, sort_order, guidance, special)
    VALUES
      (@phase, @week, @day, @segment, @setNumber, @totalSets, @reps, @pct, @oneRmRef, @baseAddRef,
       @oneRmBasis, @baseAdd, @targetWeight, 'planned', @sortOrder, @guidance, @special)
  `);

  const tx = db.transaction((allRows) => {
    allRows.forEach((r) => insert.run(r));
  });
  tx(rows);

  // Apply already-completed log entries from the original spreadsheet.
  const markDone = db.prepare(`
    UPDATE segments SET
      status = 'complete', actual_weight = ?, reps_done = ?,
      rpe = ?, date = ?, notes = ?
    WHERE week = ? AND day = ? AND segment = ? AND set_number = ?
  `);
  const tx2 = db.transaction((entries) => {
    entries.forEach((e) => {
      markDone.run(e.actualWeight, e.repsDone, e.rpe, e.date, e.notes, e.week, e.day, e.segment, e.setNumber);
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
    WHERE week = ? AND day = ? AND segment = ? AND set_number = ? AND status != 'complete'
  `);
  const tx = db.transaction((rows) => {
    rows.forEach((r) => {
      update.run(r.oneRmBasis, r.baseAdd, r.targetWeight, r.week, r.day, r.segment, r.setNumber);
    });
  });
  tx(computed);
}

module.exports = { getSettings, setSettings, seedIfEmpty, regeneratePlanned, roundToIncrement };
