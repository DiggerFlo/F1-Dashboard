// Rennkalender: reine Funktionen, die aus Quelldaten die Liste der Rennen eines Jahres bauen.
import { seasonsInclude } from './circuits.js';

export const FIRST_YEAR = 2023; // OpenF1 hat Daten ab 2023

export function yearsFor(now = Date.now()) {
  const y = new Date(now).getFullYear();
  const out = [];
  for (let i = y; i >= FIRST_YEAR; i--) out.push(i);
  return out;
}

export function raceStatus(start, end, now) {
  if (now > end) return 'done';
  if (now >= start) return 'live';
  return 'upcoming';
}

/** Nummeriert nach Datum, setzt status und markiert das nächste noch nicht beendete Rennen. */
export function finishCalendar(races, now) {
  races.sort((a, b) => a.start - b.start);
  races.forEach((r, i) => { r.round = i + 1; r.status = raceStatus(r.start, r.end, now); r.next = false; });
  const next = races.find((r) => r.status !== 'done');
  if (next) next.next = true;
  return races;
}

/** OpenF1: meetings + sessions (nur session_name === 'Race') eines Jahres. */
export function buildOpenF1Calendar(meetings, sessions, now = Date.now()) {
  const races = sessions.filter((s) => s.session_name === 'Race').map((s) => {
    const m = meetings.find((x) => x.meeting_key === s.meeting_key) || {};
    return { key: s.session_key, meeting: m.meeting_name || s.location, official: m.meeting_official_name || '', location: s.location, country: s.country_name, circuit: s.circuit_short_name,
      year: s.year, start: Date.parse(s.date_start), end: Date.parse(s.date_end) };
  });
  return finishCalendar(races, now);
}

const DEMO_ORDER = ['melbourne', 'shanghai', 'suzuka', 'bahrain', 'jeddah', 'miami', 'imola', 'monaco', 'madring', 'catalunya', 'montreal', 'spielberg', 'silverstone',
  'spa-francorchamps', 'hungaroring', 'zandvoort', 'monza', 'baku', 'marina-bay', 'austin', 'mexico-city', 'interlagos', 'las-vegas', 'lusail', 'yas-marina'];

const pretty = (slug) => String(slug || '').split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** Demo: Strecken, die im Jahr genutzt wurden, mit erfundenen Terminen (alle 14 Tage ab Mitte März). */
export function buildDemoCalendar(db, year, now = Date.now()) {
  const ids = DEMO_ORDER.filter((id) => db[id]?.layouts.some((l) => seasonsInclude(l.seasons, year)));
  const base = Date.UTC(year, 2, 15, 14, 0, 0);
  const races = ids.map((id, i) => {
    const start = base + i * 14 * 86400000;
    return { key: null, demo: true, meeting: db[id].name, official: '', location: pretty(id), country: pretty(db[id].country), circuit: id, year, start, end: start + 2 * 3600000 };
  });
  return finishCalendar(races, now);
}
