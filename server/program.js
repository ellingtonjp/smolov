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

const UNITS = ['lb', 'kg'];
const KG_PER_LB = 0.45359237;

// A rounding increment describes the plates on the bar, not a quantity to
// convert: 5 lb becomes 2.27 kg, which no rack can actually make. Switching
// units therefore adopts the conventional increment for the new unit.
const DEFAULT_ROUNDING = { lb: '5', kg: '2.5' };

// The lifter's own inputs. Their stored values move with the unit; `rounding`
// is handled separately above, and `units` is the switch itself.
const CONVERTED_SETTINGS = ['starting_1rm', 'new_1rm', 'week4_add', 'week5_add'];

function unitFactor(from, to) {
  if (from === to) return 1;
  return from === 'lb' ? KG_PER_LB : 1 / KG_PER_LB;
}

// Re-express the settings in the new unit. Note the merge: a PATCH may carry
// only some fields, and the ones it omits are sitting in the database still
// denominated in the old unit, so they need converting just as much as the
// submitted ones. Everything in `merged` is in `from` units at this point.
function convertedSettings(updates, from, to) {
  const merged = { ...getSettings(), ...updates };
  const factor = unitFactor(from, to);
  CONVERTED_SETTINGS.forEach((f) => {
    const n = Number(merged[f]);
    // Round the lifter's inputs to a half-unit so the settings form stays
    // editable — 285 lb reads as 129.5 kg, not 129.2738.
    if (Number.isFinite(n)) merged[f] = String(Math.round(n * factor * 2) / 2);
  });
  merged.rounding = DEFAULT_ROUNDING[to];
  merged.units = to;
  return merged;
}

// Logged history is converted at full precision — a record of what was
// actually lifted should never be rounded. NULL * factor is NULL in SQLite,
// so unlogged rows are left alone for free.
function convertStoredWeights(from, to) {
  const factor = unitFactor(from, to);
  db.prepare(`
    UPDATE segments SET
      target_weight = ROUND(target_weight * ?, 4),
      actual_weight = ROUND(actual_weight * ?, 4),
      one_rm_basis  = ROUND(one_rm_basis  * ?, 4),
      base_add      = ROUND(base_add      * ?, 4)
  `).run(factor, factor, factor, factor);
}

// The one entry point for a settings write. A unit change isn't a relabel: it
// has to re-express every stored weight, so settings, conversion and recalc
// all commit together or not at all — a half-applied switch would leave the
// database silently holding two different units at once.
const updateSettings = db.transaction((updates) => {
  const from = getSettings().units || 'lb';
  const to = updates.units || from;
  if (to === from) {
    setSettings(updates);
  } else {
    setSettings(convertedSettings(updates, from, to));
    convertStoredWeights(from, to);
  }
  regeneratePlanned();
});

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

module.exports = { getSettings, setSettings, updateSettings, seedIfEmpty, regeneratePlanned, roundToIncrement, UNITS };
