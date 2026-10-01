// Datenquelle für die OpenF1-API (https://openf1.org). Historische Sessions sind frei abrufbar
// und werden als Wiederholung abgespielt; Live-Daten während einer Session brauchen ein Token.
import { sectorClass } from '../format.js';
import { findLayout } from '../circuits.js';
import { buildOpenF1Calendar } from '../calendar.js';
import { samplePath } from '../svgpath.js';
import { fitSimilarity } from '../fit.js';

const BASE = 'https://api.openf1.org/v1';

const iso = (ms) => new Date(ms).toISOString().replace('Z', '+00:00');
const enc = encodeURIComponent;

/** Neueste Zeile je Fahrer aus einer nach Datum sortierten Liste. */
export function latestBy(rows, key = 'driver_number') {
  const m = new Map();
  for (const r of rows) m.set(r[key], r);
  return m;
}

/** Flaggenstatus aus den Race-Control-Meldungen (chronologisch) ableiten. */
export function flagFromControl(msgs) {
  let flag = 'green', since = null;
  for (const m of msgs) {
    const text = String(m.message || '').toUpperCase();
    const t = Date.parse(m.date);
    if (m.category === 'SafetyCar') {
      if (text.includes('VIRTUAL') && text.includes('DEPLOYED')) { flag = 'vsc'; since = t; }
      else if (text.includes('DEPLOYED')) { flag = 'sc'; since = t; }
      else if (text.includes('ENDING') || text.includes('IN THIS LAP')) { /* bleibt aktiv bis grün */ }
    } else if (m.category === 'Flag') {
      const f = String(m.flag || '').toUpperCase();
      if (f === 'RED') { flag = 'red'; since = t; }
      else if (f === 'CHEQUERED') { flag = 'chequered'; since = t; }
      else if ((f === 'GREEN' || f === 'CLEAR') && (m.scope === 'Track' || m.scope == null)) { flag = 'green'; since = null; }
      else if ((f === 'YELLOW' || f === 'DOUBLE YELLOW') && flag === 'green') { flag = 'yellow'; since = t; }
      else if (f === 'CLEAR' && flag === 'yellow') { flag = 'green'; since = null; }
    } else if (text.includes('PIT EXIT OPEN') && flag === 'red') { flag = 'green'; since = null; }
  }
  return { flag, since };
}

function sessionType(name = '') {
  if (/race|sprint$/i.test(name) && !/qualifying|shootout/i.test(name)) return 'race';
  if (/qualifying|shootout/i.test(name)) return 'quali';
  return 'practice';
}

export function createOpenF1Source({ token = null, speed = 8, wantType = null, sessionKey = null } = {}) {
  let timer = null, stopped = false, onState = null;
  let session = null, upcoming = null, replay = false, t0 = 0, vStart = 0;
  let toTrack = (x, y) => [x, y], drivers = new Map(), carData = new Map(), loc = new Map(), pos = new Map(), intervals = new Map(), laps = [], stints = [], control = [], radioRows = [], weather = null, track = null;
  let lastSlow = 0, lastFast = 0, errors = 0, note = '', layoutNote = '', nextSession = null;

  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  async function get(path) {
    const r = await fetch(`${BASE}/${path}`, { headers });
    if (!r.ok) throw new Error(`OpenF1 ${r.status}`);
    return r.json();
  }
  const vnow = () => (replay ? vStart + (Date.now() - t0) * speed : Date.now());

  async function chooseSession() {
    const year = new Date().getFullYear();
    let list = await get(`sessions?year=${year}`);
    let chosen = null;
    if (sessionKey) {
      chosen = (await get(`sessions?session_key=${sessionKey}`))[0] || null;
      if (chosen && !list.some((s) => s.session_key === chosen.session_key)) list = [...list, chosen];
    }
    if (!list.length) list = await get(`sessions?year=${year - 1}`);
    list.sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
    const now = Date.now();
    const live = list.find((s) => Date.parse(s.date_start) <= now && now <= Date.parse(s.date_end));
    let next = list.find((s) => Date.parse(s.date_start) > now);
    const past = list.filter((s) => Date.parse(s.date_end) < now);
    let pick = null;
    if (sessionKey) pick = chosen;
    else if (wantType === 'upcoming') pick = null;
    else if (wantType) pick = [...past].reverse().find((s) => sessionType(s.session_name) === wantType) || null;
    else pick = live || (next && Date.parse(next.date_start) - now < 4 * 86400000 ? null : past[past.length - 1]) || null;
    if (pick && Date.parse(pick.date_start) > now) { next = pick; pick = null; } // gewähltes Rennen liegt in der Zukunft
    upcoming = next ? { startsAt: Date.parse(next.date_start), nextLabel: next.session_name, meeting: next.location || next.circuit_short_name, circuit: `${next.circuit_short_name || ''} · ${next.country_name || ''}`.trim() } : null;
    const meetingSessions = next ? await get(`sessions?meeting_key=${next.meeting_key}`) : [];
    upcoming = upcoming && { ...upcoming, schedule: meetingSessions.map((s) => [s.session_name, new Date(s.date_start).toLocaleString('de-CH', { weekday: 'short', hour: '2-digit', minute: '2-digit' })]) };
    session = pick;
    nextSession = next || null;
    if (session) {
      const live2 = Date.parse(session.date_start) <= now && now <= Date.parse(session.date_end);
      replay = !live2;
      if (replay) { vStart = Date.parse(session.date_start) + 0.15 * (Date.parse(session.date_end) - Date.parse(session.date_start)); t0 = Date.now(); }
    }
  }

  async function loadStatic() {
    const k = session.session_key;
    const ds = await get(`drivers?session_key=${k}`);
    drivers = new Map(ds.map((d) => [d.driver_number, d]));
    // Streckenlayout: Positionsdaten einer Runde eines Fahrers, auf das Layout aus f1-circuits-svg abgebildet
    toTrack = (x, y) => [x, y];
    layoutNote = '';
    let outline = null;
    try {
      const num = ds[0].driver_number;
      const ls = await get(`laps?session_key=${k}&driver_number=${num}&lap_number=3`);
      const l = ls[0];
      if (l?.date_start && l.lap_duration) {
        const a = Date.parse(l.date_start);
        const pts = await get(`location?session_key=${k}&driver_number=${num}&date>${enc(iso(a))}&date<${enc(iso(a + l.lap_duration * 1000))}`);
        const clean = pts.filter((p, i) => i % 3 === 0 && (p.x || p.y)).map((p) => [p.x, -p.y]);
        if (clean.length > 20) outline = clean;
      }
    } catch { /* Layout optional */ }
    let layout = null;
    try {
      const db = await (await fetch('data/circuits.json')).json();
      layout = findLayout(db, session, new Date(session.date_start).getFullYear());
    } catch { /* ohne Layoutdaten: eigene Umrisslinie */ }
    if (layout) {
      const pts = samplePath(layout.d, 300);
      track = { points: pts, rotate: layout.rotate, name: layout.circuit };
      if (outline) {
        const fit = fitSimilarity(outline, pts);
        if (fit.error < 0.08) toTrack = (x, y) => fit.map(x, y);
        else { track = { points: outline }; layoutNote = ' · Layout passt nicht zu den Positionsdaten, zeige Umrisslinie'; }
      } else { track = { points: pts, rotate: layout.rotate }; }
    } else if (outline) track = { points: outline };
  }

  async function pollFast() {
    const k = session.session_key, now = vnow(), a = iso(now - 4000), b = iso(now);
    const [cd, lc] = await Promise.all([
      get(`car_data?session_key=${k}&date>${enc(a)}&date<${enc(b)}`),
      get(`location?session_key=${k}&date>${enc(a)}&date<${enc(b)}`),
    ]);
    carData = latestBy(cd); loc = new Map([...latestBy(lc)].map(([n, p]) => { const [x, y] = toTrack(p.x, -p.y); return [n, { x, y }]; }));
    const iv = await get(`intervals?session_key=${k}&date>${enc(iso(now - 15000))}&date<${enc(b)}`);
    for (const [n, r] of latestBy(iv)) intervals.set(n, r);
    const ps = await get(`position?session_key=${k}&date>${enc(iso(now - 30000))}&date<${enc(b)}`);
    for (const [n, r] of latestBy(ps)) pos.set(n, r);
    const rc = await get(`race_control?session_key=${k}&date<${enc(b)}`);
    control = rc;
  }

  async function pollSlow() {
    const k = session.session_key, b = iso(vnow());
    [laps, stints, radioRows] = await Promise.all([get(`laps?session_key=${k}`), get(`stints?session_key=${k}`), get(`team_radio?session_key=${k}&date<${enc(b)}`)]);
    const w = await get(`weather?session_key=${k}&date<${enc(b)}`);
    const last = w[w.length - 1];
    weather = last ? { air: Math.round(last.air_temperature), track: Math.round(last.track_temperature), rain: !!last.rainfall } : null;
  }

  function build() {
    const now = vnow();
    if (!session) {
      return { now: Date.now(), flag: 'green', session: { type: 'upcoming', startsAt: upcoming?.startsAt, meeting: upcoming?.meeting }, drivers: [], feed: [], track: track || { points: [] }, weather, upcoming: upcoming || {}, problem: errors ? note : '', sourceNote: note || 'OpenF1: keine laufende Session.' };
    }
    const type = sessionType(session.session_name);
    const { flag, since } = flagFromControl(control);
    const doneLaps = laps.filter((l) => l.lap_duration && Date.parse(l.date_start) + l.lap_duration * 1000 <= now);
    const per = new Map();
    for (const l of doneLaps) {
      const o = per.get(l.driver_number) || { last: null, best: null, bestSec: [null, null, null], lap: 0 };
      o.last = l; o.lap = Math.max(o.lap, l.lap_number);
      if (!l.is_pit_out_lap && (o.best == null || l.lap_duration < o.best)) o.best = l.lap_duration;
      [l.duration_sector_1, l.duration_sector_2, l.duration_sector_3].forEach((v, i) => { if (v && (o.bestSec[i] == null || v < o.bestSec[i])) o.bestSec[i] = v; });
      per.set(l.driver_number, o);
    }
    const overall = [0, 1, 2].map((i) => Math.min(...[...per.values()].map((o) => o.bestSec[i]).filter((v) => v != null)));
    const rows = [...drivers.values()].map((d) => {
      const n = d.driver_number, o = per.get(n), c = carData.get(n), p = loc.get(n), iv = intervals.get(n);
      const stint = stints.filter((s) => s.driver_number === n && s.lap_start <= (o?.lap || 1) + 1).sort((a, b) => b.stint_number - a.stint_number)[0];
      const secs = o?.last ? [o.last.duration_sector_1, o.last.duration_sector_2, o.last.duration_sector_3] : [null, null, null];
      return {
        num: n, code: d.name_acronym, name: d.last_name || d.full_name, team: d.team_name || null, color: d.team_colour ? `#${d.team_colour}` : null, pos: pos.get(n)?.position ?? 99, gap: iv?.gap_to_leader != null && typeof iv.gap_to_leader === 'number' ? iv.gap_to_leader : null,
        interval: typeof iv?.interval === 'number' ? iv.interval : null, last: o?.last?.lap_duration ?? null, best: o?.best ?? null, sectors: secs,
        sectorCls: secs.map((v, i) => sectorClass(v, o?.bestSec[i], overall[i])), tyre: stint?.compound ? stint.compound[0] : null, stops: stint ? stint.stint_number - 1 : 0,
        speed: c?.speed ?? null, throttle: c?.throttle ?? null, brake: c?.brake ?? null, gear: c?.n_gear ?? null, rpm: c?.rpm ?? null, drs: (c?.drs ?? 0) >= 10, x: p?.x ?? null, y: p?.y ?? null, onTrack: !!p,
      };
    });
    if (type === 'quali') rows.sort((a, b) => (a.best ?? 1e9) - (b.best ?? 1e9)); else rows.sort((a, b) => a.pos - b.pos);
    rows.forEach((r, i) => { if (type === 'quali') r.pos = i + 1; });
    const leaderLap = Math.max(0, ...[...per.values()].map((o) => o.lap));
    const feed = [
      ...control.map((m) => ({ id: `rc${m.date}${m.message}`, kind: 'rc', t: Date.parse(m.date), level: m.flag === 'RED' ? 'red' : /YELLOW|SAFETY/i.test(`${m.flag} ${m.category}`) ? 'yellow' : '', tag: String(m.category || 'INFO').toUpperCase(), text: m.message })),
      ...radioRows.map((r) => ({ id: `rd${r.recording_url || r.date + r.driver_number}`, kind: 'radio', t: Date.parse(r.date), code: drivers.get(r.driver_number)?.name_acronym, tag: 'FUNK', url: r.recording_url })),
    ].sort((a, b) => b.t - a.t);
    return {
      now: replay ? now : Date.now(), flag, weather, feed, track: track || { points: [] }, drivers: rows, upcoming,
      problem: errors ? note : '',
      sourceNote: (replay ? `OpenF1-Wiederholung (${speed}×): ${session.session_name}, ${session.location}` : `OpenF1 live: ${session.session_name}, ${session.location}`) + layoutNote + ' · Streckenlayouts: julesr0y/f1-circuits-svg (CC BY 4.0)',
      session: { type, name: session.session_name, circuit: session.circuit_short_name, lap: leaderLap || null, totalLaps: null, flagSince: since, phase: replay ? 'replay' : 'live', cutoff: type === 'quali' ? 10 : null,
        remaining: type === 'quali' ? Math.max(0, (Date.parse(session.date_end) - now) / 1000) : null },
    };
  }

  async function tick() {
    if (stopped) return;
    try {
      if (session) {
        const t = Date.now();
        await pollFast();
        if (t - lastSlow > 10000) { await pollSlow(); lastSlow = t; }
      }
      errors = 0; note = '';
    } catch (e) {
      errors++; note = `OpenF1 nicht erreichbar (${e.message}). Wiederhole …`;
    }
    onState(build());
    timer = setTimeout(tick, errors ? 5000 : 2000);
  }

  async function init() {
    try {
      await chooseSession();
      if (session) await loadStatic();
      else if (nextSession) {
        const db = await (await fetch('data/circuits.json')).json();
        const l = findLayout(db, nextSession, new Date(nextSession.date_start).getFullYear());
        if (l) track = { points: samplePath(l.d, 300), rotate: l.rotate };
      }
    } catch (e) { note = `OpenF1 nicht erreichbar (${e.message}).`; errors = 1; }
    tick();
  }

  return {
    id: 'openf1', demo: false,
    start(cb) { onState = cb; stopped = false; init(); },
    stop() { stopped = true; clearTimeout(timer); },
    async calendar(year) {
      const [meetings, sessions] = await Promise.all([get(`meetings?year=${year}`), get(`sessions?year=${year}&session_name=Race`)]);
      return { year, demo: false, races: buildOpenF1Calendar(meetings, sessions) };
    },
    openRace(key) { sessionKey = key; wantType = null; session = null; track = null; lastSlow = 0; clearTimeout(timer); init(); },
    select(type) { sessionKey = null; wantType = type; session = null; track = null; lastSlow = 0; clearTimeout(timer); init(); },
    trigger() {},
  };
}
