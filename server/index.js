'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');
const { getSettings, setSettings, seedIfEmpty, regeneratePlanned } = require('./program');

seedIfEmpty();

const app = express();
app.use(express.json());

const SEGMENT_FIELDS = ['status', 'actual_weight', 'reps_done', 'rpe', 'notes', 'date'];
const SETTINGS_FIELDS = ['starting_1rm', 'new_1rm', 'units', 'rounding', 'week4_add', 'week5_add'];

function getState() {
  const settings = getSettings();
  const segments = db.prepare('SELECT * FROM segments ORDER BY sort_order ASC').all();
  const dayNotesRows = db.prepare('SELECT * FROM day_notes').all();
  const dayNotes = {};
  dayNotesRows.forEach((r) => { dayNotes[`${r.week}-${r.day}`] = r.note; });
  const liftNotesRows = db.prepare('SELECT * FROM lift_notes').all();
  const liftNotes = {};
  liftNotesRows.forEach((r) => { liftNotes[r.lift] = r.note; });
  return { settings, segments, dayNotes, liftNotes };
}

app.get('/api/state', (req, res) => {
  res.json(getState());
});

app.patch('/api/segments/:id', (req, res) => {
  const id = Number(req.params.id);
  const seg = db.prepare('SELECT * FROM segments WHERE id = ?').get(id);
  if (!seg) return res.status(404).json({ error: 'not found' });

  const updates = {};
  SEGMENT_FIELDS.forEach((f) => {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) updates[f] = req.body[f];
  });
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no fields to update' });

  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE segments SET ${setClause} WHERE id = @id`).run({ ...updates, id });

  const updated = db.prepare('SELECT * FROM segments WHERE id = ?').get(id);
  res.json(updated);
});

app.put('/api/day-notes/:week/:day', (req, res) => {
  const week = Number(req.params.week);
  const day = Number(req.params.day);
  const note = req.body.note || '';
  db.prepare(`
    INSERT INTO day_notes (week, day, note, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(week, day) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
  `).run(week, day, note, new Date().toISOString());
  res.json({ week, day, note });
});

app.put('/api/lift-notes/:lift', (req, res) => {
  const lift = req.params.lift;
  const note = req.body.note || '';
  db.prepare(`
    INSERT INTO lift_notes (lift, note, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(lift) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
  `).run(lift, note, new Date().toISOString());
  res.json({ lift, note });
});

app.patch('/api/settings', (req, res) => {
  const updates = {};
  SETTINGS_FIELDS.forEach((f) => {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) updates[f] = req.body[f];
  });
  setSettings(updates);
  regeneratePlanned();
  res.json(getState());
});

app.get('/api/export.json', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="smolov-export.json"');
  res.json(getState());
});

app.get('/api/export.csv', (req, res) => {
  const segments = db.prepare('SELECT * FROM segments ORDER BY sort_order ASC').all();
  const cols = ['phase', 'week', 'day', 'segment', 'set_number', 'total_sets', 'reps', 'pct', 'one_rm_basis', 'base_add',
    'target_weight', 'status', 'actual_weight', 'reps_done', 'rpe', 'date', 'notes', 'guidance'];
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  segments.forEach((s) => lines.push(cols.map((c) => escape(s[c])).join(',')));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="smolov-export.csv"');
  res.send(lines.join('\n'));
});

// Unknown API routes have to fail as JSON. The SPA catch-all below would
// otherwise answer them with index.html and a 200, so a typo'd endpoint would
// look like a successful write to the client.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'unknown endpoint' });
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// node:sqlite throws synchronously, so express catches handler errors — but its
// default handler replies with an HTML stack trace, which the client can't read
// and which leaks internals. Always answer with the JSON shape the client
// expects. The unused `next` is required — express identifies error middleware
// by its arity.
app.use((err, req, res, next) => {
  const status = err.status && err.status < 500 ? err.status : 500;
  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  res.status(status).json({ error: status === 500 ? 'server error' : 'bad request' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Smolov tracker running on port ${PORT}`);
});
