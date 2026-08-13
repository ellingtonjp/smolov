'use strict';

// Static definition of the Smolov squat program, transcribed from the user's
// original spreadsheet. Percentages/sets/reps/guidance are fixed by the
// program design; the *target weight* is computed at runtime from editable
// settings (1RMs, rounding increment, Week 4/5 adds) using the same formula
// logic the spreadsheet used:
//
//   Target Weight = round_to_increment(applicable 1RM * pct + base_add)
//   Weeks 1-5 use Starting 1RM, Weeks 7-13 use New 1RM, Week 6 is rest/test.

const ROWS = [];

// Each prescribed block (e.g. "3 x 8 @ 65%") is expanded into one row per
// individual set, so every set gets its own row/checkbox in the app.
// Switching-phase blocks have no fixed set count (sets/reps are left for the
// lifter to choose), so they stay a single editable row.
function addDay(phase, week, dayNum, oneRmRef, guidance, segRows, baseAddRef = null) {
  segRows.forEach(([segment, sets, reps, pct]) => {
    const totalSets = sets;
    const count = sets == null ? 1 : sets;
    for (let setNumber = 1; setNumber <= count; setNumber++) {
      ROWS.push({
        phase,
        week,
        day: dayNum,
        segment: String(segment),
        setNumber,
        totalSets,
        reps,
        pct: pct / 100,
        oneRmRef,
        baseAddRef,
        guidance,
        special: null,
      });
    }
  });
}

function addSpecial(phase, week, dayNum, special, guidance) {
  ROWS.push({
    phase,
    week,
    day: dayNum,
    segment: '—',
    setNumber: null,
    totalSets: null,
    reps: null,
    pct: null,
    oneRmRef: null,
    baseAddRef: null,
    guidance,
    special,
  });
}

// ---- Phase In (weeks 1-2) — based on Starting 1RM ----
const PHASE_IN_DAY12_GUIDANCE = '3 x 8 @ 65%, 1 x 5 @ 70%, 2 x 2 @ 75%, 1 x 1 @ 80%';
addDay('Phase In', 1, 1, 'starting', PHASE_IN_DAY12_GUIDANCE, [
  [1, 3, 8, 65], [2, 1, 5, 70], [3, 2, 2, 75], [4, 1, 1, 80],
]);
addDay('Phase In', 1, 2, 'starting', PHASE_IN_DAY12_GUIDANCE, [
  [1, 3, 8, 65], [2, 1, 5, 70], [3, 2, 2, 75], [4, 1, 1, 80],
]);
const PHASE_IN_DAY3_GUIDANCE = '4 x 5 @ 70%, 1 x 3 @ 75%, 2 x 2 @ 80%, 1 x 1 @ 90%';
addDay('Phase In', 1, 3, 'starting', PHASE_IN_DAY3_GUIDANCE, [
  [1, 4, 5, 70], [2, 1, 3, 75], [3, 2, 2, 80], [4, 1, 1, 90],
]);
addDay('Phase In', 2, 1, 'starting', '1 x 5 @ 80%', [[1, 1, 5, 80]]);
addDay('Phase In', 2, 2, 'starting', '1 x 5 @ 82.5%', [[1, 1, 5, 82.5]]);
addDay('Phase In', 2, 3, 'starting', '1 x 5 @ 85%', [[1, 1, 5, 85]]);

// ---- Base Cycle (weeks 3-6) — based on Starting 1RM ----
addDay('Base Cycle', 3, 1, 'starting', '4 x 9 @ 70%', [[1, 4, 9, 70]]);
addDay('Base Cycle', 3, 2, 'starting', '5 x 7 @ 75%', [[1, 5, 7, 75]]);
addDay('Base Cycle', 3, 3, 'starting', '7 x 5 @ 80%', [[1, 7, 5, 80]]);
addDay('Base Cycle', 3, 4, 'starting', '10 x 3 @ 85%', [[1, 10, 3, 85]]);

addDay('Base Cycle', 4, 1, 'starting', '4 x 9 @ 70% + Week 4 add', [[1, 4, 9, 70]], 'week4');
addDay('Base Cycle', 4, 2, 'starting', '5 x 7 @ 75% + Week 4 add', [[1, 5, 7, 75]], 'week4');
addDay('Base Cycle', 4, 3, 'starting', '7 x 5 @ 80% + Week 4 add', [[1, 7, 5, 80]], 'week4');
addDay('Base Cycle', 4, 4, 'starting', '10 x 3 @ 85% + Week 4 add', [[1, 10, 3, 85]], 'week4');

addDay('Base Cycle', 5, 1, 'starting', '4 x 9 @ 70% + Week 5 add', [[1, 4, 9, 70]], 'week5');
addDay('Base Cycle', 5, 2, 'starting', '5 x 7 @ 75% + Week 5 add', [[1, 5, 7, 75]], 'week5');
addDay('Base Cycle', 5, 3, 'starting', '7 x 5 @ 80% + Week 5 add', [[1, 7, 5, 80]], 'week5');
addDay('Base Cycle', 5, 4, 'starting', '10 x 3 @ 85% + Week 5 add', [[1, 10, 3, 85]], 'week5');

addSpecial('Base Cycle', 6, 1, 'rest', 'Rest day');
addSpecial('Base Cycle', 6, 2, 'rest', 'Rest day');
addSpecial('Base Cycle', 6, 3, 'test', 'Build to 1RM — record the tested max as your New 1RM.');
addSpecial('Base Cycle', 6, 4, 'test', 'Build to 1RM — use only if needed; update New 1RM after testing.');

// ---- Switching (weeks 7-8) — based on New 1RM, editable speed work ----
addDay('Switching', 7, 1, 'new', 'Editable speed-work @ 50% — dynamic effort, ~50-60% of new 1RM; choose sets/reps.', [[1, null, null, 50]]);
addDay('Switching', 7, 2, 'new', 'Editable speed-work @ 55% — optional box squats or band work; emphasize speed out of the bottom.', [[1, null, null, 55]]);
addDay('Switching', 7, 3, 'new', 'Editable speed-work @ 60% — template provided since source download link is unavailable.', [[1, null, null, 60]]);
addDay('Switching', 8, 1, 'new', 'Editable speed-work @ 50% — dynamic effort, ~50-60% of new 1RM; choose sets/reps.', [[1, null, null, 50]]);
addDay('Switching', 8, 2, 'new', 'Editable speed-work @ 55% — optional box squats or band work; emphasize speed out of the bottom.', [[1, null, null, 55]]);
addDay('Switching', 8, 3, 'new', 'Editable speed-work @ 60% — template provided since source download link is unavailable.', [[1, null, null, 60]]);

// ---- Intense Cycle (weeks 9-12) — based on New 1RM ----
addDay('Intense Cycle', 9, 1, 'new', '1 x 3 @ 65%, 1 x 4 @ 75%, 3 x 4 @ 85%, 1 x 5 @ 85%', [
  [1, 1, 3, 65], [2, 1, 4, 75], [3, 3, 4, 85], [4, 1, 5, 85],
]);
addDay('Intense Cycle', 9, 2, 'new', '1 x 3 @ 60%, 1 x 3 @ 70%, 1 x 4 @ 80%, 1 x 3 @ 90%, 2 x 5 @ 85%', [
  [1, 1, 3, 60], [2, 1, 3, 70], [3, 1, 4, 80], [4, 1, 3, 90], [5, 2, 5, 85],
]);
addDay('Intense Cycle', 9, 3, 'new', '1 x 4 @ 65%, 1 x 4 @ 70%, 5 x 4 @ 80%', [
  [1, 1, 4, 65], [2, 1, 4, 70], [3, 5, 4, 80],
]);

addDay('Intense Cycle', 10, 1, 'new', '1 x 4 @ 60%, 1 x 4 @ 70%, 1 x 4 @ 80%, 1 x 3 @ 90%, 2 x 4 @ 90%', [
  [1, 1, 4, 60], [2, 1, 4, 70], [3, 1, 4, 80], [4, 1, 3, 90], [5, 2, 4, 90],
]);
addDay('Intense Cycle', 10, 2, 'new', '1 x 3 @ 65%, 1 x 3 @ 75%, 1 x 3 @ 85%, 3 x 3 @ 90%, 1 x 3 @ 95%', [
  [1, 1, 3, 65], [2, 1, 3, 75], [3, 1, 3, 85], [4, 3, 3, 90], [5, 1, 3, 95],
]);
addDay('Intense Cycle', 10, 3, 'new', '1 x 3 @ 65%, 1 x 3 @ 75%, 1 x 4 @ 85%, 4 x 5 @ 90%', [
  [1, 1, 3, 65], [2, 1, 3, 75], [3, 1, 4, 85], [4, 4, 5, 90],
]);

addDay('Intense Cycle', 11, 1, 'new', '1 x 3 @ 60%, 1 x 3 @ 70%, 1 x 3 @ 80%, 5 x 5 @ 90%', [
  [1, 1, 3, 60], [2, 1, 3, 70], [3, 1, 3, 80], [4, 5, 5, 90],
]);
addDay('Intense Cycle', 11, 2, 'new', '1 x 3 @ 60%, 1 x 3 @ 70%, 1 x 3 @ 80%, 2 x 3 @ 95%', [
  [1, 1, 3, 60], [2, 1, 3, 70], [3, 1, 3, 80], [4, 2, 3, 95],
]);
addDay('Intense Cycle', 11, 3, 'new', '1 x 3 @ 65%, 1 x 3 @ 75%, 1 x 3 @ 85%, 4 x 3 @ 95%', [
  [1, 1, 3, 65], [2, 1, 3, 75], [3, 1, 3, 85], [4, 4, 3, 95],
]);

addDay('Intense Cycle', 12, 1, 'new', '1 x 3 @ 70%, 1 x 4 @ 80%, 5 x 5 @ 90%', [
  [1, 1, 3, 70], [2, 1, 4, 80], [3, 5, 5, 90],
]);
addDay('Intense Cycle', 12, 2, 'new', '1 x 3 @ 70%, 1 x 3 @ 80%, 4 x 3 @ 95%', [
  [1, 1, 3, 70], [2, 1, 3, 80], [3, 4, 3, 95],
]);
addDay('Intense Cycle', 12, 3, 'new', '1 x 3 @ 75%, 1 x 4 @ 90%, 3 x 4 @ 95%', [
  [1, 1, 3, 75], [2, 1, 4, 90], [3, 3, 4, 95],
]);

// ---- Taper (week 13) — based on New 1RM ----
addDay('Taper', 13, 1, 'new', '1 x 3 @ 70%, 1 x 3 @ 80%, 2 x 5 @ 90%, 3 x 4 @ 95%', [
  [1, 1, 3, 70], [2, 1, 3, 80], [3, 2, 5, 90], [4, 3, 4, 95],
]);
addDay('Taper', 13, 2, 'new', '1 x 4 @ 75%, 4 x 4 @ 85%', [
  [1, 1, 4, 75], [2, 4, 4, 85],
]);
addSpecial('Taper', 13, 3, 'test', 'Build to 1RM — final 1RM test; record the result in notes.');

ROWS.forEach((r, i) => { r.sortOrder = i; });

function roundToIncrement(value, increment) {
  if (value == null) return null;
  if (!increment || increment <= 0) return null;
  return Math.round(value / increment) * increment;
}

// Compute target weights for every template row given current settings.
// Does NOT touch the database — pure function, used both for seeding and
// for regenerating not-yet-logged targets after a settings change.
function computeRows(settings) {
  const startingRm = Number(settings.starting_1rm);
  const newRm = Number(settings.new_1rm);
  const rounding = Number(settings.rounding);
  const week4Add = Number(settings.week4_add) || 0;
  const week5Add = Number(settings.week5_add) || 0;

  return ROWS.map((r) => {
    const oneRmBasis = r.oneRmRef === 'starting' ? startingRm : r.oneRmRef === 'new' ? newRm : null;
    const baseAdd = r.baseAddRef === 'week4' ? week4Add : r.baseAddRef === 'week5' ? week5Add : 0;
    const target = r.pct != null && oneRmBasis != null
      ? roundToIncrement(oneRmBasis * r.pct + baseAdd, rounding)
      : null;
    return {
      ...r,
      oneRmBasis,
      baseAdd: r.baseAddRef ? baseAdd : 0,
      targetWeight: target,
    };
  });
}

module.exports = { ROWS, computeRows, roundToIncrement };
