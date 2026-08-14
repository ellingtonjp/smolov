'use strict';

const APP = document.getElementById('app');
const TOAST = document.getElementById('toast');

let STATE = null;
let VIEW = 'next';
let CURRENT_DAY_KEY = null; // "week-day"

// ---------- data fetch / mutate ----------

// A phone in a gym loses its connection all the time, so a failed write is the
// normal case here, not an edge case. Every request goes through this helper so
// that a failure is always loud: it never resolves with a half-answer, and an
// error body never reaches STATE.
const REQUEST_TIMEOUT_MS = 10000;

async function request(url, options = {}) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    // A hung request is a silent failure too — time it out and say so.
    throw new Error(err.name === 'TimeoutError' ? 'server not responding' : 'no connection');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch (err) { /* non-JSON error page */ }
    throw new Error(detail || `server error (${res.status})`);
  }
  return res.json();
}

async function loadState() {
  STATE = await request('/api/state');
}

// Applied optimistically so check-off feels instant, then rolled back if the
// write doesn't land. A checkbox is a claim that the set is *saved*, so showing
// it checked after a failed write is the one thing we must never do.
async function patchSegment(id, fields) {
  const idx = STATE.segments.findIndex((s) => s.id === id);
  const previous = idx >= 0 ? STATE.segments[idx] : null;
  if (previous) STATE.segments[idx] = { ...previous, ...fields };
  render();

  try {
    const updated = await request(`/api/segments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (idx >= 0) STATE.segments[idx] = updated;
    showToast('Saved');
    render();
  } catch (err) {
    if (previous) STATE.segments[idx] = previous;
    render();
    showError(`Set not saved — ${err.message}`, () => patchSegment(id, fields));
  }
}

async function putDayNote(week, day, note) {
  const key = `${week}-${day}`;
  STATE.dayNotes[key] = note;
  try {
    await request(`/api/day-notes/${week}/${day}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    showToast('Note saved');
  } catch (err) {
    // Unlike a set, the note is text the lifter just typed — keep it in memory
    // so switching views doesn't discard it, and let them retry.
    showError(`Note not saved — ${err.message}`, () => putDayNote(week, day, note));
  }
}

async function patchSettings(fields) {
  try {
    STATE = await request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    showToast('Settings saved — upcoming targets recalculated');
    render();
  } catch (err) {
    showError(`Settings not saved — ${err.message}`, () => patchSettings(fields));
  }
}

let TOAST_RETRY = null;

function showToast(msg) {
  // A visible error outranks a routine "Saved". Overwriting it would strand the
  // failed write — the lifter would never get back to the Retry button, which is
  // exactly the silent loss this is all meant to prevent.
  if (!TOAST.hidden && TOAST.classList.contains('error')) return;
  clearTimeout(showToast._t);
  TOAST_RETRY = null;
  TOAST.className = 'toast';
  TOAST.textContent = msg;
  TOAST.hidden = false;
  showToast._t = setTimeout(() => { TOAST.hidden = true; }, 1600);
}

// Errors never auto-dismiss. If a set didn't save, the lifter needs to still see
// that when they put the bar down, not 1.6 seconds later.
function showError(msg, retry) {
  clearTimeout(showToast._t);
  TOAST_RETRY = retry || null;
  TOAST.className = 'toast error';
  TOAST.innerHTML = `<span>${escapeHtml(msg)}</span>`
    + (retry ? '<button class="toast-btn" data-toast-action="retry">Retry</button>' : '')
    + '<button class="toast-btn" data-toast-action="dismiss" aria-label="Dismiss">✕</button>';
  TOAST.hidden = false;
}

TOAST.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toast-action]');
  if (!btn) return;
  const retry = TOAST_RETRY;
  TOAST_RETRY = null;
  TOAST.hidden = true;
  if (btn.dataset.toastAction === 'retry' && retry) retry();
});

// ---------- helpers ----------

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function pctLabel(seg) {
  if (seg.pct == null) return '';
  // Round away float noise (0.55 * 100 = 55.00000000000001) before printing.
  return `${Math.round(seg.pct * 1000) / 10}%`;
}

// Prescription for the (read-only) Target column: the scheme ("9 @ 70% + 20")
// followed by the weight it works out to, which the row renders smaller.
function targetParts(seg) {
  if (seg.special === 'rest') return { scheme: 'Rest day', weight: '' };
  if (seg.special === 'test') return { scheme: 'Test 1RM', weight: '' };

  // Weeks 4/5 add a flat increase on top of the percentage; show it, since the
  // target weight is computed as 1RM * pct + add.
  const add = seg.base_add ? ` + ${seg.base_add}` : '';
  const reps = seg.reps == null ? '' : `${seg.reps} `; // speed work — sets/reps are the lifter's call
  return {
    scheme: `${reps}@ ${pctLabel(seg)}${add}`,
    weight: seg.target_weight != null ? `${seg.target_weight}${STATE.settings.units || 'lb'}` : '',
  };
}

// Compact one-line prescription for a whole day ("4x9 @ 70% + 20"), rebuilt
// from the set rows so the Week 4/5 adds show as real numbers. Rest/test days
// have no prescription, so they get no summary.
function daySummary(day) {
  const blocks = [];
  day.segments.forEach((s) => {
    if (s.special) return;
    const last = blocks[blocks.length - 1];
    if (!last || last.segment !== s.segment) blocks.push({ ...s });
  });
  if (blocks.length === 0) return '';
  return blocks.map((s) => {
    const add = s.base_add ? ` + ${s.base_add}` : '';
    const scheme = s.total_sets != null && s.reps != null ? `${s.total_sets}x${s.reps} ` : '';
    return `${scheme}@ ${pctLabel(s)}${add}`;
  }).join(', ');
}

function unitsLabel() {
  return (STATE.settings.units || 'lb') === 'kg' ? 'kg' : 'lbs';
}

function weightLabel(v) {
  if (v == null) return '—';
  const units = STATE.settings.units || 'lb';
  return `${v} ${units}`;
}

function groupDays(segments) {
  const days = [];
  let cur = null;
  segments.forEach((s) => {
    if (!cur || cur.week !== s.week || cur.day !== s.day) {
      cur = { week: s.week, day: s.day, phase: s.phase, segments: [] };
      days.push(cur);
    }
    cur.segments.push(s);
  });
  return days;
}

function dayStatus(day) {
  const all = day.segments;
  if (all.every((s) => s.status === 'complete')) return 'complete';
  if (all.some((s) => s.status === 'complete')) return 'partial';
  if (all[0].special === 'rest') return 'rest';
  return 'planned';
}

// Number the working sets 1..n down the day. set_number restarts inside each
// segment, so the running count is what the lifter actually ticks off; rest and
// test days aren't sets and get no number.
function daySetNumbers(day) {
  let n = 0;
  return day.segments.map((seg) => ({ seg, setNumber: seg.special ? null : ++n }));
}

function dayWeightRange(day) {
  const weights = day.segments.map((s) => s.target_weight).filter((v) => v != null);
  if (weights.length === 0) return null;
  const min = Math.min(...weights), max = Math.max(...weights);
  return min === max ? weightLabel(min) : `${min}–${weightLabel(max)}`;
}

function findDay(days, week, day) {
  return days.find((d) => d.week === week && d.day === day);
}

function nextIncompleteDay(days) {
  return days.find((d) => dayStatus(d) !== 'complete') || days[days.length - 1];
}

// ---------- render: shell ----------

function render() {
  // The initial load can fail, leaving us with no state — the tabs are still
  // live at that point, so don't let one render a view against null.
  if (!STATE) return;
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === VIEW);
  });
  if (VIEW === 'next') APP.innerHTML = renderNextView();
  else if (VIEW === 'overview') APP.innerHTML = renderOverviewView();
  else if (VIEW === 'progress') APP.innerHTML = renderProgressView();
  else if (VIEW === 'settings') APP.innerHTML = renderSettingsView();
}

function switchView(v) {
  VIEW = v;
  render();
  window.scrollTo(0, 0);
}

// ---------- render: Next Workout ----------

function renderNextView() {
  const days = groupDays(STATE.segments);
  if (!CURRENT_DAY_KEY) {
    const d = nextIncompleteDay(days);
    CURRENT_DAY_KEY = `${d.week}-${d.day}`;
  }
  const [w, d] = CURRENT_DAY_KEY.split('-').map(Number);
  const day = findDay(days, w, d) || nextIncompleteDay(days);
  const idx = days.indexOf(day);
  const prev = days[idx - 1];
  const next = days[idx + 1];
  const status = dayStatus(day);
  const dayNote = STATE.dayNotes[`${day.week}-${day.day}`] || '';
  const summary = daySummary(day);

  // The Target column spells out every set, so the day's guidance line is only
  // worth showing when the rows themselves don't say enough: rest/test days and
  // the open-ended speed-work days.
  const isRestDay = day.segments.every((s) => s.special === 'rest');
  const needsGuidance = !isRestDay && (Boolean(day.segments[0].special) || day.segments[0].reps == null);
  const uniqueGuidance = needsGuidance ? [...new Set(day.segments.map((s) => s.guidance))] : [];

  return `
    <div class="card">
      <div class="row between">
        <button class="btn secondary small" data-action="prev-day" ${prev ? '' : 'disabled'}>&larr; Prev</button>
        <button class="btn small" data-action="jump-next">Today</button>
        <button class="btn secondary small" data-action="next-day" ${next ? '' : 'disabled'}>Next &rarr;</button>
      </div>
    </div>

    <div class="card">
      <div class="day-header">
        <div>
          <h2>Week ${day.week}, Day ${day.day}</h2>
          <div class="muted">${day.phase}${summary ? ` <span class="day-summary">${escapeHtml(summary)}</span>` : ''}</div>
        </div>
        <span class="badge ${status}">${status}</span>
      </div>
      ${uniqueGuidance.filter(Boolean).map((g) => `<div class="guidance">${escapeHtml(g)}</div>`).join('')}

      <div class="set-table">
        ${isRestDay ? '' : `
          <div class="set-head">
            <span>#</span>
            <span>Target</span>
            <span>${unitsLabel()}</span>
            <span>reps</span>
            <span>rpe</span>
            <span></span>
          </div>`}
        ${daySetNumbers(day).map(({ seg, setNumber }) => renderSetRow(seg, setNumber)).join('')}
      </div>

      <div class="field field-full" style="margin-top:0.75rem;">
        <label>Day notes (how the session felt, cues, adjustments)</label>
        <textarea data-action="day-note" data-week="${day.week}" data-day="${day.day}">${escapeHtml(dayNote)}</textarea>
      </div>
    </div>
  `;
}

// One set per line: # | Target (read-only) | weight | reps | rpe | done.
// Weight and reps are pre-filled with the prescription until the lifter
// overrides them; RPE is intentionally never pre-filled.
function renderSetRow(seg, setNumber) {
  const checked = seg.status === 'complete';
  const check = `<div class="checkbox ${checked ? 'checked' : ''}" data-action="toggle-check" data-id="${seg.id}" role="checkbox" aria-checked="${checked}" aria-label="Mark set complete">✓</div>`;
  const num = `<div class="set-num">${setNumber ?? ''}</div>`;
  const target = targetParts(seg);
  const targetCell = `
    <div class="set-target">
      ${escapeHtml(target.scheme)}
      ${target.weight ? `<span class="set-target-weight">${escapeHtml(target.weight)}</span>` : ''}
    </div>`;

  if (seg.special === 'rest') {
    return `
      <div class="set-row rest ${checked ? 'complete' : ''}">
        ${num}
        ${targetCell}
        ${check}
      </div>
    `;
  }

  const defaultWeight = seg.actual_weight ?? (seg.special === 'test' ? null : seg.target_weight);
  const defaultReps = seg.reps_done ?? (seg.special === 'test' ? null : seg.reps);

  return `
    <div class="set-row ${checked ? 'complete' : ''}">
      ${num}
      ${targetCell}
      <input class="cell" type="number" inputmode="decimal" step="0.5" aria-label="Weight"
             data-field="actual_weight" data-id="${seg.id}" value="${defaultWeight ?? ''}" />
      <input class="cell" type="number" inputmode="numeric" step="1" aria-label="Reps"
             data-field="reps_done" data-id="${seg.id}" value="${defaultReps ?? ''}" />
      <input class="cell" type="number" inputmode="decimal" step="0.5" min="1" max="10" aria-label="RPE"
             data-field="rpe" data-id="${seg.id}" value="${seg.rpe ?? ''}" />
      ${check}
    </div>
  `;
}

// ---------- render: Program Overview ----------

function renderOverviewView() {
  const days = groupDays(STATE.segments);
  const phases = [...new Set(days.map((d) => d.phase))];
  const totalSegs = STATE.segments.length;
  const doneSegs = STATE.segments.filter((s) => s.status === 'complete').length;

  const phaseBlocks = phases.map((phase) => {
    const phaseDays = days.filter((d) => d.phase === phase);
    const phaseSegs = phaseDays.flatMap((d) => d.segments);
    const done = phaseSegs.filter((s) => s.status === 'complete').length;
    const pct = phaseSegs.length ? Math.round((done / phaseSegs.length) * 100) : 0;
    const weeks = [...new Set(phaseDays.map((d) => d.week))];
    const weekRange = weeks.length > 1 ? `Weeks ${weeks[0]}–${weeks[weeks.length - 1]}` : `Week ${weeks[0]}`;

    return `
      <div class="overview-phase">
        <div class="overview-phase-title">
          <span>${phase} <span class="muted">(${weekRange})</span></span>
          <span class="muted">${done}/${phaseSegs.length}</span>
        </div>
        <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
        ${phaseDays.map((d) => renderOverviewDayRow(d)).join('')}
      </div>
    `;
  }).join('');

  return `
    <div class="card">
      <h2>Program Overview</h2>
      <div class="muted">${doneSegs} / ${totalSegs} segments complete (${Math.round((doneSegs / totalSegs) * 100)}%)</div>
      <div class="progress-bar"><div class="progress-bar-fill" style="width:${Math.round((doneSegs / totalSegs) * 100)}%"></div></div>
    </div>
    <div class="card">
      ${phaseBlocks}
    </div>
  `;
}

function renderOverviewDayRow(day) {
  const status = dayStatus(day);
  const weightInfo = dayWeightRange(day);
  const guidance = day.segments.length === 1 ? day.segments[0].guidance : null;
  return `
    <div class="overview-day-row" data-action="goto-day" data-week="${day.week}" data-day="${day.day}">
      <span class="dot ${status}"></span>
      <span class="overview-day-label">Week ${day.week}, Day ${day.day}${guidance && day.segments[0].special ? ` — ${escapeHtml(guidance)}` : ''}</span>
      <span class="overview-day-weight">${weightInfo || ''}</span>
    </div>
  `;
}

// ---------- render: Progress ----------

function epley1RM(weight, reps) {
  if (weight == null || reps == null || reps <= 0) return null;
  return weight * (1 + reps / 30);
}

function renderProgressView() {
  const completed = STATE.segments
    .filter((s) => s.status === 'complete')
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.sort_order - b.sort_order);

  // Each segment row is already a single set, so tonnage per row is just weight * reps.
  const totalPlannedTonnage = STATE.segments.reduce((sum, s) => {
    if (s.target_weight != null && s.reps != null) return sum + s.target_weight * s.reps;
    return sum;
  }, 0);
  const totalActualTonnage = completed.reduce((sum, s) => {
    if (s.actual_weight != null && s.reps_done != null) return sum + s.actual_weight * s.reps_done;
    return sum;
  }, 0);

  const totalSegs = STATE.segments.length;
  const donePct = totalSegs ? Math.round((completed.length / totalSegs) * 100) : 0;

  const metOrExceeded = completed.filter((s) => s.actual_weight != null && s.target_weight != null && s.actual_weight >= s.target_weight).length;
  const withTarget = completed.filter((s) => s.actual_weight != null && s.target_weight != null).length;
  const adherence = withTarget ? Math.round((metOrExceeded / withTarget) * 100) : null;

  let idx = 0;
  const tonnagePoints = [];
  let cumPlanned = 0, cumActual = 0;
  completed.forEach((s) => {
    idx += 1;
    if (s.target_weight != null && s.reps != null) cumPlanned += s.target_weight * s.reps;
    if (s.actual_weight != null && s.reps_done != null) cumActual += s.actual_weight * s.reps_done;
    tonnagePoints.push({ idx, cumPlanned, cumActual, label: `W${s.week}D${s.day}` });
  });

  const tonnageChart = buildLineChart([
    { label: 'Planned (cumulative)', color: '#9aa1ac', points: tonnagePoints.map((p) => ({ x: p.idx, y: p.cumPlanned, label: `${p.label}: ${Math.round(p.cumPlanned)}` })) },
    { label: 'Actual (cumulative)', color: '#4f8cff', points: tonnagePoints.map((p) => ({ x: p.idx, y: p.cumActual, label: `${p.label}: ${Math.round(p.cumActual)}` })) },
  ]);

  const avtPoints = completed.filter((s) => s.target_weight != null && s.actual_weight != null);
  const avtChart = buildLineChart([
    { label: 'Target', color: '#9aa1ac', points: avtPoints.map((s, i) => ({ x: i + 1, y: s.target_weight, label: `W${s.week}D${s.day}: target ${s.target_weight}` })) },
    { label: 'Actual', color: '#3ecf8e', points: avtPoints.map((s, i) => ({ x: i + 1, y: s.actual_weight, label: `W${s.week}D${s.day}: actual ${s.actual_weight}` })) },
  ]);

  const rpePoints = completed.filter((s) => s.rpe != null);
  const rpeChart = buildLineChart([
    { label: 'RPE', color: '#e8b339', points: rpePoints.map((s, i) => ({ x: i + 1, y: s.rpe, label: `W${s.week}D${s.day}: RPE ${s.rpe}` })) },
  ], { minYOverride: 0, maxYOverride: 10 });

  const oneRmPoints = completed
    .filter((s) => s.actual_weight != null && s.reps_done != null && s.reps_done <= 8)
    .map((s, i) => ({ x: i + 1, y: Math.round(epley1RM(s.actual_weight, s.reps_done)), label: `W${s.week}D${s.day}: est ${Math.round(epley1RM(s.actual_weight, s.reps_done))}` }));
  const oneRmChart = buildLineChart([
    { label: 'Estimated 1RM', color: '#e8596b', points: oneRmPoints },
  ]);
  const latestEstimate = oneRmPoints.length ? oneRmPoints[oneRmPoints.length - 1].y : null;

  return `
    <div class="card">
      <h2>Progress</h2>
      <div class="stat-grid">
        <div class="stat-box"><div class="val">${donePct}%</div><div class="lbl">Program complete</div></div>
        <div class="stat-box"><div class="val">${Math.round(totalActualTonnage).toLocaleString()}</div><div class="lbl">Actual tonnage (${STATE.settings.units})</div></div>
        <div class="stat-box"><div class="val">${Math.round(totalPlannedTonnage).toLocaleString()}</div><div class="lbl">Planned tonnage</div></div>
        <div class="stat-box"><div class="val">${adherence != null ? adherence + '%' : '—'}</div><div class="lbl">Hit target weight</div></div>
        <div class="stat-box"><div class="val">${latestEstimate != null ? latestEstimate : '—'}</div><div class="lbl">Latest est. 1RM</div></div>
      </div>
    </div>

    <div class="card">
      <h3>Tonnage — cumulative planned vs actual</h3>
      <div class="chart-wrap">${tonnageChart}</div>
      <div class="chart-legend">
        <span><span class="legend-dot" style="background:#9aa1ac"></span>Planned</span>
        <span><span class="legend-dot" style="background:#4f8cff"></span>Actual</span>
      </div>
    </div>

    <div class="card">
      <h3>Actual vs target weight per logged segment</h3>
      <div class="chart-wrap">${avtChart}</div>
      <div class="chart-legend">
        <span><span class="legend-dot" style="background:#9aa1ac"></span>Target</span>
        <span><span class="legend-dot" style="background:#3ecf8e"></span>Actual</span>
      </div>
    </div>

    <div class="card">
      <h3>RPE trend</h3>
      <div class="chart-wrap">${rpePoints.length ? rpeChart : '<div class="muted">Log an RPE to see this chart.</div>'}</div>
    </div>

    <div class="card">
      <h3>Estimated 1RM trend <span class="muted">(Epley formula, sets of 8 reps or fewer)</span></h3>
      <div class="chart-wrap">${oneRmPoints.length ? oneRmChart : '<div class="muted">Not enough data yet.</div>'}</div>
    </div>
  `;
}

function buildLineChart(series, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 200;
  const padL = 42, padR = 10, padT = 10, padB = 10;
  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) return '<div class="muted">Not enough data yet.</div>';

  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = opts.minYOverride != null ? opts.minYOverride : Math.min(0, ...ys);
  let maxY = opts.maxYOverride != null ? opts.maxYOverride : Math.max(...ys);
  if (minX === maxX) { minX -= 1; maxX += 1; }
  if (minY === maxY) { maxY += 1; }

  const xScale = (x) => padL + ((x - minX) / (maxX - minX)) * (width - padL - padR);
  const yScale = (y) => height - padB - ((y - minY) / (maxY - minY)) * (height - padT - padB);

  let svg = `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`;
  const gridN = 4;
  for (let i = 0; i <= gridN; i++) {
    const y = padT + (i * (height - padT - padB)) / gridN;
    const val = maxY - (i * (maxY - minY)) / gridN;
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="#2e333d" stroke-width="1" />`;
    svg += `<text x="2" y="${(y + 3).toFixed(1)}" font-size="9" fill="#9aa1ac">${Math.round(val)}</text>`;
  }
  series.forEach((s) => {
    const pts = s.points;
    if (pts.length === 0) return;
    if (pts.length > 1) {
      const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(' ');
      svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" />`;
    }
    pts.forEach((p) => {
      svg += `<circle cx="${xScale(p.x).toFixed(1)}" cy="${yScale(p.y).toFixed(1)}" r="3" fill="${s.color}"><title>${escapeAttr(p.label || `${p.x}, ${p.y}`)}</title></circle>`;
    });
  });
  svg += `</svg>`;
  return svg;
}

// ---------- render: Settings ----------

function renderSettingsView() {
  const s = STATE.settings;
  return `
    <div class="card">
      <h2>Program Settings</h2>
      <div class="muted" style="margin-bottom:0.75rem;">Editing these recalculates the target weight for every workout that isn't logged complete yet. Completed history is never changed.</div>
      <div class="settings-form">
        <div class="field">
          <label>Starting squat 1RM (used weeks 1–5)</label>
          <input type="number" step="0.5" id="set-starting_1rm" value="${s.starting_1rm}" />
        </div>
        <div class="field">
          <label>New 1RM after Week 6 (used weeks 7–13)</label>
          <input type="number" step="0.5" id="set-new_1rm" value="${s.new_1rm}" />
        </div>
        <div class="field">
          <label>Units</label>
          <select id="set-units">
            <option value="lb" ${s.units === 'lb' ? 'selected' : ''}>lb</option>
            <option value="kg" ${s.units === 'kg' ? 'selected' : ''}>kg</option>
          </select>
        </div>
        <div class="field">
          <label>Rounding increment</label>
          <input type="number" step="0.5" id="set-rounding" value="${s.rounding}" />
        </div>
        <div class="field">
          <label>Week 4 increase</label>
          <input type="number" step="0.5" id="set-week4_add" value="${s.week4_add}" />
        </div>
        <div class="field">
          <label>Week 5 increase</label>
          <input type="number" step="0.5" id="set-week5_add" value="${s.week5_add}" />
        </div>
        <button class="btn" data-action="save-settings">Save &amp; recalculate</button>
      </div>
    </div>

    <div class="card">
      <h3>Export data</h3>
      <div class="row wrap" style="margin-top:0.5rem;">
        <a class="btn secondary small" href="/api/export.csv">Download CSV</a>
        <a class="btn secondary small" href="/api/export.json">Download JSON</a>
      </div>
    </div>

    <div class="card link-row">
      <div class="muted">Program source: <a href="https://www.smolovjr.com/smolov-squat-routine/" target="_blank" rel="noopener">smolovjr.com</a></div>
    </div>
  `;
}

// ---------- events ----------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

APP.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="reload"]')) {
    window.location.reload();
    return;
  }

  const checkEl = e.target.closest('[data-action="toggle-check"]');
  if (checkEl) {
    const id = Number(checkEl.dataset.id);
    const seg = STATE.segments.find((s) => s.id === id);
    if (seg.status === 'complete') {
      patchSegment(id, { status: 'planned' });
    } else {
      const fields = { status: 'complete' };
      if (!seg.special) {
        if (seg.actual_weight == null) fields.actual_weight = seg.target_weight;
        if (seg.reps_done == null) fields.reps_done = seg.reps;
      }
      if (!seg.date) fields.date = todayStr();
      patchSegment(id, fields);
    }
    return;
  }

  const prevBtn = e.target.closest('[data-action="prev-day"]');
  if (prevBtn) {
    const days = groupDays(STATE.segments);
    const [w, d] = CURRENT_DAY_KEY.split('-').map(Number);
    const idx = days.findIndex((x) => x.week === w && x.day === d);
    if (idx > 0) { CURRENT_DAY_KEY = `${days[idx - 1].week}-${days[idx - 1].day}`; render(); }
    return;
  }
  const nextBtn = e.target.closest('[data-action="next-day"]');
  if (nextBtn) {
    const days = groupDays(STATE.segments);
    const [w, d] = CURRENT_DAY_KEY.split('-').map(Number);
    const idx = days.findIndex((x) => x.week === w && x.day === d);
    if (idx < days.length - 1) { CURRENT_DAY_KEY = `${days[idx + 1].week}-${days[idx + 1].day}`; render(); }
    return;
  }
  const jumpBtn = e.target.closest('[data-action="jump-next"]');
  if (jumpBtn) {
    const days = groupDays(STATE.segments);
    const d = nextIncompleteDay(days);
    CURRENT_DAY_KEY = `${d.week}-${d.day}`;
    render();
    return;
  }

  const gotoDay = e.target.closest('[data-action="goto-day"]');
  if (gotoDay) {
    CURRENT_DAY_KEY = `${gotoDay.dataset.week}-${gotoDay.dataset.day}`;
    switchView('next');
    return;
  }

  const saveSettingsBtn = e.target.closest('[data-action="save-settings"]');
  if (saveSettingsBtn) {
    patchSettings({
      starting_1rm: document.getElementById('set-starting_1rm').value,
      new_1rm: document.getElementById('set-new_1rm').value,
      units: document.getElementById('set-units').value,
      rounding: document.getElementById('set-rounding').value,
      week4_add: document.getElementById('set-week4_add').value,
      week5_add: document.getElementById('set-week5_add').value,
    });
    return;
  }
});

APP.addEventListener('change', (e) => {
  const field = e.target.closest('[data-field]');
  if (field) {
    const id = Number(field.dataset.id);
    const key = field.dataset.field;
    let val = field.value;
    if (['actual_weight', 'reps_done', 'rpe'].includes(key)) {
      val = val === '' ? null : Number(val);
    }
    patchSegment(id, { [key]: val });
  }
});

APP.addEventListener('blur', (e) => {
  const dayNoteEl = e.target.closest('[data-action="day-note"]');
  if (dayNoteEl) {
    putDayNote(dayNoteEl.dataset.week, dayNoteEl.dataset.day, dayNoteEl.value);
  }
}, true);

// ---------- escaping ----------

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

// ---------- boot ----------

// Without this the app just sits on "Loading…" forever with no explanation.
function showLoadError(message) {
  APP.innerHTML = `
    <div class="empty-state">
      <div>Couldn't load your program — ${escapeHtml(message)}.</div>
      <button class="btn" data-action="reload" style="margin-top:0.75rem;">Try again</button>
    </div>`;
}

(async function init() {
  APP.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    await loadState();
  } catch (err) {
    showLoadError(err.message);
    return;
  }
  render();
})();
