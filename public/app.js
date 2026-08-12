'use strict';

const APP = document.getElementById('app');
const TOAST = document.getElementById('toast');

let STATE = null;
let VIEW = 'next';
let CURRENT_DAY_KEY = null; // "week-day"

// ---------- data fetch / mutate ----------

async function loadState() {
  const res = await fetch('/api/state');
  STATE = await res.json();
}

async function patchSegment(id, fields) {
  const res = await fetch(`/api/segments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const updated = await res.json();
  const idx = STATE.segments.findIndex((s) => s.id === id);
  if (idx >= 0) STATE.segments[idx] = updated;
  showToast('Saved');
  render();
}

async function putDayNote(week, day, note) {
  await fetch(`/api/day-notes/${week}/${day}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  STATE.dayNotes[`${week}-${day}`] = note;
  showToast('Note saved');
}

async function patchSettings(fields) {
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  STATE = await res.json();
  showToast('Settings saved — upcoming targets recalculated');
  render();
}

function showToast(msg) {
  TOAST.textContent = msg;
  TOAST.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { TOAST.hidden = true; }, 1600);
}

// ---------- helpers ----------

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function pctLabel(seg) {
  if (seg.pct == null) return '';
  const v = seg.pct * 100;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

function prescriptionLabel(seg) {
  if (seg.special) return seg.guidance;
  if (seg.sets == null && seg.reps == null) return `Speed work @ ${pctLabel(seg)}`;
  return `${seg.sets} x ${seg.reps} @ ${pctLabel(seg)}`;
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

  const uniqueGuidance = [...new Set(day.segments.map((s) => s.guidance))];

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
          <div class="muted">${day.phase}</div>
        </div>
        <span class="badge ${status}">${status}</span>
      </div>
      ${uniqueGuidance.filter((g) => g && day.segments.length > 1 && !day.segments[0].special).map((g) => `<div class="guidance">${escapeHtml(g)}</div>`).join('')}
      ${day.segments.map((seg) => renderSegmentRow(seg)).join('')}

      <div class="field field-full" style="margin-top:0.75rem;">
        <label>Day notes (how the session felt, cues, adjustments)</label>
        <textarea data-action="day-note" data-week="${day.week}" data-day="${day.day}">${escapeHtml(dayNote)}</textarea>
      </div>
    </div>
  `;
}

function renderSegmentRow(seg) {
  const checked = seg.status === 'complete';
  const label = seg.special ? seg.guidance : prescriptionLabel(seg);

  return `
    <div class="segment-row ${checked ? 'complete' : ''}">
      <div class="segment-top">
        <div class="checkbox ${checked ? 'checked' : ''}" data-action="toggle-check" data-id="${seg.id}">✓</div>
        <div class="segment-info">
          <div class="segment-title">${escapeHtml(label)}</div>
          ${seg.special ? '' : `<div class="segment-sub">Target ${weightLabel(seg.target_weight)}</div>`}
        </div>
        ${seg.special ? '' : `<div class="segment-target">${weightLabel(seg.target_weight)}</div>`}
      </div>
      ${renderSegmentDetails(seg)}
    </div>
  `;
}

function renderSegmentDetails(seg) {
  // Fields default to the prescribed values until the lifter overrides them.
  // RPE is intentionally never pre-filled.
  const defaultDate = seg.date ?? todayStr();

  if (seg.special === 'rest') {
    return `
      <div class="segment-details">
        <div class="field">
          <label>Date</label>
          <input type="date" data-field="date" data-id="${seg.id}" value="${defaultDate}" />
        </div>
        <div class="field field-full">
          <label>Notes</label>
          <input type="text" data-field="notes" data-id="${seg.id}" value="${escapeAttr(seg.notes || '')}" />
        </div>
      </div>
    `;
  }
  if (seg.special === 'test') {
    return `
      <div class="segment-details">
        <div class="field">
          <label>Tested weight</label>
          <input type="number" step="0.5" data-field="actual_weight" data-id="${seg.id}" value="${seg.actual_weight ?? ''}" />
        </div>
        <div class="field">
          <label>RPE (optional)</label>
          <input type="number" step="0.5" min="1" max="10" data-field="rpe" data-id="${seg.id}" value="${seg.rpe ?? ''}" />
        </div>
        <div class="field">
          <label>Date</label>
          <input type="date" data-field="date" data-id="${seg.id}" value="${defaultDate}" />
        </div>
        <div class="field field-full">
          <label>Notes</label>
          <input type="text" data-field="notes" data-id="${seg.id}" value="${escapeAttr(seg.notes || '')}" placeholder="e.g. new 1RM = 320" />
        </div>
      </div>
    `;
  }

  const defaultWeight = seg.actual_weight ?? seg.target_weight;
  const defaultSets = seg.sets_done ?? seg.sets;
  const defaultReps = seg.reps_done ?? seg.reps;

  return `
    <div class="segment-details">
      <div class="field">
        <label>Actual weight</label>
        <input type="number" step="0.5" data-field="actual_weight" data-id="${seg.id}" value="${defaultWeight ?? ''}" />
      </div>
      <div class="field">
        <label>Sets done</label>
        <input type="number" step="1" data-field="sets_done" data-id="${seg.id}" value="${defaultSets ?? ''}" />
      </div>
      <div class="field">
        <label>Reps done</label>
        <input type="number" step="1" data-field="reps_done" data-id="${seg.id}" value="${defaultReps ?? ''}" />
      </div>
      <div class="field">
        <label>RPE (optional)</label>
        <input type="number" step="0.5" min="1" max="10" data-field="rpe" data-id="${seg.id}" value="${seg.rpe ?? ''}" />
      </div>
      <div class="field">
        <label>Date</label>
        <input type="date" data-field="date" data-id="${seg.id}" value="${defaultDate}" />
      </div>
      <div class="field field-full">
        <label>Notes</label>
        <input type="text" data-field="notes" data-id="${seg.id}" value="${escapeAttr(seg.notes || '')}" />
      </div>
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

  const totalPlannedTonnage = STATE.segments.reduce((sum, s) => {
    if (s.target_weight != null && s.sets != null && s.reps != null) return sum + s.target_weight * s.sets * s.reps;
    return sum;
  }, 0);
  const totalActualTonnage = completed.reduce((sum, s) => {
    if (s.actual_weight != null && s.sets_done != null && s.reps_done != null) return sum + s.actual_weight * s.sets_done * s.reps_done;
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
    if (s.target_weight != null && s.sets != null && s.reps != null) cumPlanned += s.target_weight * s.sets * s.reps;
    if (s.actual_weight != null && s.sets_done != null && s.reps_done != null) cumActual += s.actual_weight * s.sets_done * s.reps_done;
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
        if (seg.sets_done == null) fields.sets_done = seg.sets;
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
    if (['actual_weight', 'sets_done', 'reps_done', 'rpe'].includes(key)) {
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

(async function init() {
  APP.innerHTML = '<div class="empty-state">Loading…</div>';
  await loadState();
  render();
})();
