// Local JSON persistence. Replaces the web app's localStorage.
// Default location: ~/.loquitur/state.json (override with LOQUITUR_HOME).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const HOME = process.env.LOQUITUR_HOME || path.join(os.homedir(), '.loquitur');
const FILE = path.join(HOME, 'state.json');

const EMPTY = { courses: [], quizResults: [], quizzes: {}, billableLog: [] };

export function load() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return structuredClone(EMPTY);
  }
}

/** Current revision of the saved file; the browser app uses it to tell whether it is up to date. */
export function rev() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')).syncRev || 0;
  } catch {
    return 0;
  }
}

export function save(state) {
  fs.mkdirSync(HOME, { recursive: true });
  state.syncRev = Math.max(rev(), state.syncRev || 0) + 1;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

export function newId() {
  return crypto.randomBytes(4).toString('hex');
}

export const statePath = FILE;

/** Find a course by id or case-insensitive name (exact, then prefix). */
export function findCourse(state, ref) {
  if (!ref) return null;
  const r = ref.toLowerCase().trim();
  return (
    state.courses.find(c => c.id === ref) ||
    state.courses.find(c => c.name.toLowerCase() === r) ||
    state.courses.find(c => c.name.toLowerCase().startsWith(r)) ||
    null
  );
}

export function gatherCourseContext(course) {
  let ctx = '';
  for (const m of course.materials || []) ctx += `\n--- File: ${m.name} ---\n${(m.content || '').slice(0, 8000)}\n`;
  for (const n of course.notes || []) ctx += `\n--- Note (${n.createdAt}) ---\n${(n.text || '').slice(0, 3000)}\n`;
  return ctx.slice(0, 30000) || 'No materials uploaded yet. Generate based on common topics for this type of law course.';
}

/** Topics averaging under 65%, worst first. Mirrors getWeakAreas() in the web app. */
export function weakAreas(state, limit = 8) {
  const buckets = {};
  for (const r of state.quizResults) {
    // Agent entries store course/score; the web app's own quizzes store courseName/pct.
    const key = `${r.course || r.courseName || 'General'}|||${r.topic || 'General'}`;
    (buckets[key] ||= []).push(Number(r.score ?? r.pct) || 0);
  }
  const out = [];
  for (const [key, scores] of Object.entries(buckets)) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg < 65) {
      const [course, topic] = key.split('|||');
      out.push({ course, topic, avg: Math.round(avg), attempts: scores.length });
    }
  }
  return out.sort((a, b) => a.avg - b.avg).slice(0, limit);
}
