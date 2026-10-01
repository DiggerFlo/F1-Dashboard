// Datenquelle für die OpenF1-API (https://openf1.org). Historische Sessions sind frei abrufbar
// und werden als Wiederholung abgespielt; Live-Daten während einer Session brauchen ein Token.
import { sectorClass, safePhoto } from '../format.js';
import { findLayout } from '../circuits.js';
import { buildOpenF1Calendar } from '../calendar.js';
import { samplePath } from '../svgpath.js';
import { fitSimilarity } from '../fit.js';
import { createJolpica, buildJolpicaCalendar } from './jolpica.js';
import { createReplayBuffer } from './replay-buffer.js';
import { createStaticCache, cacheKeyOf } from '../cache.js';
import { t as tr, locale } from '../i18n.js';
import { nearestFraction, aheadOf } from '../track.js';
import { sectorFlagsFrom, stationaryTime } from '../pit.js';

const BASE = 'https://api.openf1.org/v1';
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Anfrage-Client für OpenF1. Ohne Token erlaubt die API nur etwa 30 Anfragen pro Minute (sonst HTTP 429) und
 * antwortet auf Abfragen ohne Treffer mit 404. Deshalb: Anfragen nacheinander, höchstens maxPerMinute innerhalb
 * von 60 s (gleitendes Fenster, mit Token deutlich mehr), bei 429/503 warten und wiederholen, 404 als leere Liste.
 */
export function createOpenF1Client({ base = BASE, headers = {}, fetchImpl = (...a) => fetch(...a), minGap = 340, maxPerMinute = headers.Authorization ? 250 : 28, retries = 5, sleep = sleepMs, now = () => Date.now() } = {}) {
  let chain = Promise.resolve();
  let last = 0, blockedUntil = 0;
  const stamps = [];
  const slot = (cancelled) => {
    const p = chain.then(async () => {
      for (;;) {
        if (cancelled?.()) return false; // Anfrage einer verlassenen Session: nicht mehr senden
        const t = now();
        while (stamps.length && stamps[0] <= t - 60000) stamps.shift();
        const wait = Math.max(last + minGap - t, blockedUntil - t, stamps.length >= maxPerMinute ? stamps[0] + 60000 - t + 50 : 0);
        if (wait <= 0) break;
        await sleep(wait);
      }
      last = now();
      stamps.push(last);
      return true;
    });
    chain = p.catch(() => {});
    return p;
  };
  return async function get(path, cancelled) {
    for (let attempt = 0; ; attempt++) {
      if (!(await slot(cancelled))) throw new Error('abgebrochen');
      const r = await fetchImpl(`${base}/${path}`, { headers });
      if (r.ok) return r.json();
      if (r.status === 404) return []; // "No results found."
      if ((r.status === 429 || r.status === 503) && attempt < retries) {
        const ra = Number(r.headers?.get?.('retry-after'));
        blockedUntil = now() + (ra > 0 ? ra * 1000 : Math.min(30000, 4000 * 2 ** attempt));
        continue;
      }
      throw new Error(`OpenF1 ${r.status}`);
    }
  };
}

/**
 * Streckendaten von MultiViewer (api.multiviewer.app): exakte Streckenlinie im Koordinatensystem der OpenF1-Positionen,
 * Kurven, Marshal-Sektoren (die "TRACK SECTOR n" der Flaggen) und Boxenverlustzeit. Nur im Browser, Fehler sind nicht kritisch.
 */
export async function fetchCircuitInfo(session, fetchImpl = globalThis.fetch) {
  if (typeof document === 'undefined' || !fetchImpl || session?.circuit_key == null) return null;
  const year = new Date(session.date_start).getFullYear();
  for (const y of [year, year - 1, year - 2]) { // Streckenlayout ist meist über Jahre gleich
    try {
      const r = await fetchImpl(`https://api.multiviewer.app/api/v1/circuits/${session.circuit_key}/${y}`);
      if (!r.ok) continue;
      const j = await r.json();
      if (j?.x?.length > 50 && j.x.length === j.y?.length) return j;
    } catch { /* nächstes Jahr */ }
  }
  return null;
}

const iso = (ms) => new Date(ms).toISOString().replace('Z', '+00:00');
const enc = encodeURIComponent;

/** Neueste Zeile je Fahrer aus einer nach Datum sortierten Liste. */
export function latestBy(rows, key = 'driver_number') {
  const m = new Map();
  for (const r of rows) m.set(r[key], r);
  return m;
}

/** Flaggenstatus aus den Race-Control-Meldungen (chronologisch) ableiten. */
/** Overtake-Freigabe (ab 2026) aus Race Control: open true/false, null solange nichts gemeldet wurde. */
export function overtakeFromControl(msgs) {
  let open = null;
  for (const m of msgs) {
    const t = String(m.message || '').toUpperCase();
    if (/^OVERTAKE ENABLED/.test(t)) open = true;
    else if (/^OVERTAKE DISABLED/.test(t)) open = false;
  }
  return { open };
}

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

/**
 * Fasst Vorschau-Daten aus OpenF1 (nächste Session) und Jolpica (Rennen, Wertungen) zusammen.
 * Jolpica-Details zum Rennwochenende werden nur genutzt, wenn sie zur nächsten OpenF1-Session passen.
 */
/** Kennzahlen eines Rennwochenendes aus einem Jolpica-Rennen. */
export function raceFacts(race, total = 0) {
  // Labels sind Schlüssel (fact.*), die Anzeige übersetzt sie; die Werte folgen der aktuellen Sprache
  return [['fact.round', total ? tr('fact.roundOf', { round: race.round, total }) : String(race.round)], ['fact.circuit', race.circuitName], ['fact.place', [race.location, race.country].filter(Boolean).join(', ')], ['fact.date', new Date(race.start).toLocaleDateString(locale(), { day: '2-digit', month: 'long' })]];
}

export function mergeUpcoming(upcoming, extras, now = Date.now()) {
  const next = extras?.races?.find((r) => r.end > now) || null;
  let u = upcoming;
  if (!u && next) u = { startsAt: next.start, nextLabel: 'sess.race', meeting: next.meeting, circuit: `${next.circuitName} · ${next.country}`, schedule: [] };
  if (!u) return null;
  const same = next && Math.abs(u.startsAt - next.start) < 4 * 86400000;
  const out = { ...u };
  if (same) {
    out.meeting = next.meeting;
    out.circuit = `${next.circuitName} · ${next.country}`;
    if (!out.schedule?.length) out.schedule = next.sessions.map(([n, ts]) => [n, ts]); // Zeitpunkte, die Anzeige formatiert sie
    out.facts = raceFacts(next, extras.races.length);
  }
  if (extras?.drivers?.length) out.standings = extras.drivers.slice(0, 10);
  if (extras?.constructors?.length) out.constructors = extras.constructors;
  if (extras?.last) out.lastResult = extras.last;
  return out;
}

export function createOpenF1Source({ token = null, speed = 8, wantType = null, sessionKey = null, jolpica = createJolpica(), client = null, replayOnly = false, circuitInfo = fetchCircuitInfo, cache = createStaticCache() } = {}) {
  let timer = null, stopped = false, onState = null;
  let session = null, upcoming = null, replay = false;
  // Wiederholung: virtuelle Uhr (Start, Tempo, Pause) und Puffer mit den geladenen Zeitfenstern
  let clock = { base: 0, at: 0, speed, paused: false, hold: false };
  let buffer = null, weatherRows = [], pits = [], loadingNow = false;
  const stopSince = new Map(), stopCache = new Map(), stopLoading = new Set();
  let stopBusy = 0; // laufende Einzelabfragen für Standzeiten (die Warteschlange ist knapp: höchstens 28 Anfragen pro Minute) // Ausfälle erkennen, Standzeiten der Boxenstopps
  let lastBuildNow = null;
  const windowLoads = new Map();
  if (replayOnly && !wantType && !sessionKey) wantType = 'race';
  let toTrack = (x, y) => [x, y], drivers = new Map(), carData = new Map(), loc = new Map(), pos = new Map(), intervals = new Map(), laps = [], stints = [], control = [], radioRows = [], weather = null, track = null;
  let epoch = 0, pickedRace = null, pickedMeta = null, lastMedium = 0, lastSlow = 0, lastFast = 0, errors = 0, noteMsg = '', layoutNote = false, nextSession = null, extras = null;

  const rawGet = client || createOpenF1Client({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  // Anfragen gehören zur Session-Epoche, in der sie gestellt wurden; nach einem Wechsel werden wartende Anfragen verworfen
  const pastKeys = new Set(); // Sessions, die lange genug vorbei sind, dass sich ihre Stammdaten nicht mehr ändern
  const get = async (path) => {
    const k = cacheKeyOf(path);
    const cacheable = k != null && pastKeys.has(Number(k));
    if (cacheable) { const hit = cache.read(path); if (hit !== undefined) return hit; }
    const my = epoch;
    const data = await rawGet(path, () => my !== epoch);
    if (cacheable && Array.isArray(data) && data.length) cache.write(path, data);
    return data;
  };
  const vnow = () => (replay ? (clock.paused || clock.hold ? clock.base : clock.base + (Date.now() - clock.at) * clock.speed) : Date.now());
  const rebase = (patch = {}) => { clock = { ...clock, base: vnow(), at: Date.now(), ...patch }; };
  const sessionStart = () => Date.parse(session.date_start);
  const sessionEnd = () => Date.parse(session.date_end);
  /**
   * Echter Start des Rennens (Lights out): Race-Control "SESSION STARTED", sonst der Beginn von Runde 1.
   * Die Daten beginnen schon mit der Einführungsrunde, date_start der Session ist nur der geplante Start.
   */
  const raceStart = () => {
    if (!session || sessionType(session.session_name) !== 'race') return null;
    const m = control.find((c) => c.category === 'SessionStatus' && /SESSION STARTED/i.test(c.message || ''));
    if (m) return Date.parse(m.date);
    const l1 = laps.filter((l) => l.lap_number === 1 && l.date_start).map((l) => Date.parse(l.date_start));
    return l1.length ? Math.min(...l1) : null;
  };
  /**
   * Zeitpunkt des Anrollens: Median der ersten Bewegung aller Fahrer rund um den Start (Reaktionszeit inklusive),
   * damit die Ampel dort erlischt, wo die Autos auf der Karte tatsächlich losfahren. Ohne geladene Telemetrie der Start selbst.
   */
  let launchAt = null;
  const lightsOut = () => {
    const rs = raceStart();
    if (rs == null) return null;
    if (launchAt?.rs === rs) return launchAt.t;
    const ts = buffer ? buffer.firstMoves(rs - 3000, rs + 8000).sort((a, b) => a - b) : [];
    if (ts.length < 5) return rs;
    launchAt = { rs, t: ts[Math.floor(ts.length / 2)] };
    return launchAt.t;
  };
  /** Einstieg in die Wiederholung: Rennen kurz vor dem Start (Autos rollen zur Aufstellung), andere Sessions etwas später. */
  const replayEntry = () => {
    const rs = raceStart();
    if (rs) return Math.max(sessionStart(), Math.min(sessionEnd() - 60000, rs - 40000));
    return Math.min(sessionEnd() - 60000, sessionStart() + (sessionType(session.session_name) === 'race' ? 2 : 10) * 60000);
  };

  /** Rennen ohne OpenF1-Session (künftig oder vor 2023): Vorschau mit dessen Streckenlayout. */
  function previewRace(r) {
    session = null; replay = false;
    nextSession = { circuit_short_name: r.circuit, location: r.location, country_name: r.country, year: r.year, date_start: iso(r.start) };
    const total = extras?.races?.length || 0;
    upcoming = { startsAt: r.start, nextLabel: r.end < Date.now() ? 'sess.raceDone' : 'sess.race', meeting: r.meeting, circuit: `${r.circuitName || r.circuit} · ${r.country}`,
      schedule: (r.sessions || []).map(([n, ts]) => [n, ts]), get facts() { return raceFacts(r, total); } }; // facts als Getter: folgt der Sprache bei jedem Zustand
  }

  async function chooseSession() {
    if (pickedRace) { previewRace(pickedRace); return; }
    const year = new Date().getFullYear();
    let chosen = null;
    if (sessionKey) chosen = (await get(`sessions?session_key=${sessionKey}`))[0] || null;
    // Eine gewählte, schon beendete Session braucht weder die Jahresliste noch das Wochenende (spart 2 der knappen Anfragen)
    let list = chosen && Date.parse(chosen.date_end) < Date.now() ? [chosen] : await get(`sessions?year=${year}`);
    if (chosen && !list.some((s) => s.session_key === chosen.session_key)) list = [...list, chosen];
    if (!list.length) list = await get(`sessions?year=${year - 1}`);
    list.sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
    const now = Date.now();
    const live = list.find((s) => Date.parse(s.date_start) <= now && now <= Date.parse(s.date_end));
    let next = list.find((s) => Date.parse(s.date_start) > now);
    let past = list.filter((s) => Date.parse(s.date_end) < now);
    if (replayOnly && !past.length && !sessionKey) { list = await get(`sessions?year=${year - 1}`); list.sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start)); past = list.filter((s) => Date.parse(s.date_end) < now); }
    let pick = null;
    if (sessionKey) pick = chosen;
    else if (wantType === 'upcoming') pick = null;
    else if (wantType) pick = [...past].reverse().find((s) => sessionType(s.session_name) === wantType) || null;
    else pick = live || (next && Date.parse(next.date_start) - now < 4 * 86400000 ? null : past[past.length - 1]) || null;
    if (pick && Date.parse(pick.date_start) > now) { next = pick; pick = null; } // gewähltes Rennen liegt in der Zukunft
    upcoming = next ? { startsAt: Date.parse(next.date_start), nextLabel: next.session_name, meeting: next.location || next.circuit_short_name, circuit: `${next.circuit_short_name || ''} · ${next.country_name || ''}`.trim() } : null;
    if (upcoming && pickedMeta && next?.session_key === pickedMeta.key) upcoming = { ...upcoming, meeting: pickedMeta.meeting, circuit: `${pickedMeta.circuitName || upcoming.circuit} · ${pickedMeta.country}` };
    const meetingSessions = next ? await get(`sessions?meeting_key=${next.meeting_key}`) : [];
    upcoming = upcoming && { ...upcoming, schedule: meetingSessions.map((s) => [s.session_name, Date.parse(s.date_start)]) };
    session = pick;
    if (pick && Date.parse(pick.date_end) < Date.now() - 3 * 3600000) pastKeys.add(pick.session_key);
    nextSession = next || null;
    if (!session) replay = false;
    if (session) {
      const live2 = Date.parse(session.date_start) <= now && now <= Date.parse(session.date_end);
      replay = replayOnly || !live2;
      if (replay) clock = { base: replayEntry(), at: Date.now(), speed: clock.speed, paused: false, hold: false };
    }
  }

  /** Wertungen, Kalender und letztes Ergebnis aus Jolpica. Fehler sind nicht kritisch. */
  async function loadExtras() {
    const year = new Date().getFullYear();
    const ok = (p) => p.then((v) => v, () => null);
    let [races, drivers, constructors, last] = await Promise.all([ok(jolpica.races(year)), ok(jolpica.driverStandings(year)), ok(jolpica.constructorStandings(year)), ok(jolpica.lastResult(year))]);
    if (!drivers?.length) { // Saisonbeginn: noch keine Wertung, dann die des Vorjahres
      [drivers, constructors, last] = await Promise.all([ok(jolpica.driverStandings(year - 1)), ok(jolpica.constructorStandings(year - 1)), ok(jolpica.lastResult(year - 1))]);
    }
    extras = { races: races || [], drivers: drivers || [], constructors: constructors || [], last };
  }

  async function loadStatic() {
    const k = session.session_key;
    intervals = new Map(); pos = new Map(); carData = new Map(); loc = new Map(); laps = []; stints = []; control = []; radioRows = []; weather = null; weatherRows = []; pits = []; buffer = null; loadingNow = false; windowLoads.clear(); stopCache.clear(); stopLoading.clear(); stopSince.clear();
    const ds = await get(`drivers?session_key=${k}`);
    drivers = new Map(ds.map((d) => [d.driver_number, d]));
    // Streckenlayout: Positionsdaten einer Runde eines Fahrers, auf das Layout aus f1-circuits-svg abgebildet
    toTrack = (x, y) => [x, y];
    layoutNote = false;
    let outline = null;
    try {
      const num = ds[0].driver_number;
      if (replay) laps = await get(`laps?session_key=${k}`); // wird unten für die Wiederholung weiterverwendet
      const ls = replay ? laps.filter((x) => x.driver_number === num && x.lap_number === 3) : await get(`laps?session_key=${k}&driver_number=${num}&lap_number=3`);
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
        else { track = { points: outline }; layoutNote = true; }
      } else { track = { points: pts, rotate: layout.rotate }; }
    } else if (outline) track = { points: outline };
    await addCircuitInfo();
    if (replay) await loadReplayStatic(k);
  }

  /**
   * Zusatzdaten von MultiViewer auf das Streckenlayout abbilden: Marshal-Sektoren (für Sektor-Flaggen), Kurven, Boxenverlustzeit.
   * Die Positionen werden mit derselben Anpassung wie die Fahrzeuge auf das Layout gelegt. Ohne Daten bleibt alles wie es ist.
   */
  async function addCircuitInfo() {
    if (!track?.points?.length) return;
    const info = await circuitInfo(session).catch(() => null);
    if (!info) return;
    const frac = (c) => nearestFraction(track.points, ...toTrack(c.trackPosition.x, -c.trackPosition.y));
    const list = (a) => (a || []).filter((c) => c.trackPosition).map(frac);
    track = { ...track, pitLoss: info.pitLoss || null, marshal: list(info.marshalSectors), turns: list(info.corners) };
  }

  /** Standzeit (Sekunden stehend) eines Boxenstopps aus der Telemetrie; null, solange die Daten fehlen. */
  function stopTime(p) {
    if (typeof p.stop_duration === 'number') return p.stop_duration;
    const id = `${p.driver_number}-${p.date}`;
    if (stopCache.has(id)) return stopCache.get(id);
    const end = Date.parse(p.date), lane = p.lane_duration || p.pit_duration || 22;
    const from = end - (lane + 3) * 1000, to = end + 4000;
    const { rows, covered } = buffer ? buffer.carRows(p.driver_number, from, to) : { rows: [], covered: false };
    if (covered && rows.length) { const v = stationaryTime(rows, from, to); stopCache.set(id, v); return v; }
    if (!stopLoading.has(id) && stopBusy < 2 && Math.abs(vnow() - end) < 10 * 60000) { // Fenster nicht geladen: nur kürzliche Stopps, höchstens 2 gleichzeitig
      stopLoading.add(id); stopBusy++;
      get(`car_data?session_key=${session.session_key}&driver_number=${p.driver_number}&date>${enc(iso(from))}&date<${enc(iso(to))}`)
        .then((r) => stopCache.set(id, r.length ? stationaryTime(r.map((x) => ({ t: Date.parse(x.date), speed: x.speed })), from, to) : null)).catch(() => stopLoading.delete(id)).finally(() => { stopBusy--; });
    }
    return null;
  }

  /** Wiederholung: alles, was nicht zeitfensterweise geladen wird, einmal komplett holen. */
  async function loadReplayStatic(k) {
    if (!laps.length) laps = await get(`laps?session_key=${k}`);
    stints = await get(`stints?session_key=${k}`);
    control = await get(`race_control?session_key=${k}`);
    radioRows = await get(`team_radio?session_key=${k}`);
    weatherRows = await get(`weather?session_key=${k}`);
    pits = await get(`pit?session_key=${k}`);
    clock = { ...clock, base: replayEntry(), at: Date.now() }; // Rennen: jetzt ist der Start bekannt
    buffer = createReplayBuffer({ origin: sessionStart() });
    buffer.setPositions(await get(`position?session_key=${k}`));
  }

  /** Ein Zeitfenster (Telemetrie, Positionen, Abstände aller Fahrer) laden. Mehrfachaufrufe teilen sich die Anfrage. */
  function loadWindow(start) {
    if (windowLoads.has(start)) return windowLoads.get(start);
    const buf = buffer, k = session.session_key;
    const q = (ep) => get(`${ep}?session_key=${k}&date>=${enc(iso(start))}&date<${enc(iso(start + buf.windowMs))}`);
    const p = (async () => {
      const carData = await q('car_data'), location = await q('location'), intervals = await q('intervals');
      if (buf === buffer) buf.add(start, { carData, location, intervals });
    })().finally(() => windowLoads.delete(start));
    windowLoads.set(start, p);
    return p;
  }

  async function pollFast() {
    const k = session.session_key, now = vnow(), a = iso(now - 4000), b = iso(now);
    const [cd, lc] = await Promise.all([
      get(`car_data?session_key=${k}&date>${enc(a)}&date<${enc(b)}`),
      get(`location?session_key=${k}&date>${enc(a)}&date<${enc(b)}`),
    ]);
    carData = latestBy(cd); loc = new Map([...latestBy(lc)].map(([n, p]) => { const [x, y] = toTrack(p.x, -p.y); return [n, { x, y }]; }));
  }

  async function pollMedium() {
    const k = session.session_key, now = vnow(), b = iso(now);
    const iv = await get(`intervals?session_key=${k}&date>${enc(iso(now - (intervals.size ? 20000 : 300000)))}&date<${enc(b)}`);
    for (const [n, r] of latestBy(iv)) intervals.set(n, r);
    const ps = await get(`position?session_key=${k}&date>${enc(iso(now - (pos.size ? 40000 : 900000)))}&date<${enc(b)}`);
    for (const [n, r] of latestBy(ps)) pos.set(n, r);
    control = await get(`race_control?session_key=${k}&date<${enc(b)}`);
  }

  async function pollSlow() {
    const k = session.session_key, b = iso(vnow());
    [laps, stints, radioRows] = await Promise.all([get(`laps?session_key=${k}`), get(`stints?session_key=${k}`), get(`team_radio?session_key=${k}&date<${enc(b)}`)]);
    if (!replay) pits = await get(`pit?session_key=${k}`);
    const w = await get(`weather?session_key=${k}&date<${enc(b)}`);
    const last = w[w.length - 1];
    weather = last ? { air: Math.round(last.air_temperature), track: Math.round(last.track_temperature), rain: !!last.rainfall } : null;
  }

  function build() {
    const now = vnow();
    const note = noteMsg ? tr('src.unreachable', { msg: noteMsg }) : ''; // Fehlertext in der aktuellen Sprache
    if (!session) {
      return { now: Date.now(), flag: 'green', session: { type: 'upcoming', startsAt: upcoming?.startsAt, meeting: upcoming?.meeting }, drivers: [], feed: [], track: track || { points: [] }, weather, upcoming: mergeUpcoming(upcoming, extras) || {}, problem: errors ? note : '', sourceNote: note || tr('src.note.idle') };
    }
    const type = sessionType(session.session_name);
    const ctl = replay ? control.filter((m) => Date.parse(m.date) <= now) : control;
    const radio = replay ? radioRows.filter((r) => Date.parse(r.date) <= now) : radioRows;
    let wx = weather;
    if (replay) { const w = weatherRows.filter((r) => Date.parse(r.date) <= now).pop(); wx = w ? { air: Math.round(w.air_temperature), track: Math.round(w.track_temperature), rain: !!w.rainfall } : null; }
    const { flag, since } = flagFromControl(ctl);
    // Ab 2026 ersetzt der Overtake-Modus das DRS: OpenF1 liefert kein drs mehr und keinen Modus pro Auto,
    // nur die Freigabe der Rennleitung ("OVERTAKE ENABLED/DISABLED"). Pro Auto wird nur die Reichweite abgeleitet.
    const era2026 = new Date(session.date_start).getFullYear() >= 2026;
    const overtake = era2026 ? overtakeFromControl(ctl) : null;
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
    if (lastBuildNow != null && (now < lastBuildNow || now - lastBuildNow > 15000)) stopSince.clear(); // Sprung in der Wiederholung
    lastBuildNow = now;
    const rs = raceStart();
    const raceOn = type === 'race' && (rs != null ? now > rs + 30000 : doneLaps.length > 0) && flag !== 'red' && flag !== 'chequered';
    const rows = [...drivers.values()].map((d) => {
      const n = d.driver_number, o = per.get(n), c = carData.get(n), pitRec = pits.find((p) => p.driver_number === n && Date.parse(p.date) - ((p.lane_duration || p.pit_duration) || 22) * 1000 - 3000 <= now && now <= Date.parse(p.date) + 4000), inPit = !!pitRec, p = loc.get(n), iv = intervals.get(n);
      const stint = stints.filter((s) => s.driver_number === n && s.lap_start <= (o?.lap || 1) + 1).sort((a, b) => b.stint_number - a.stint_number)[0];
      const secs = o?.last ? [o.last.duration_sector_1, o.last.duration_sector_2, o.last.duration_sector_3] : [null, null, null];
      // Ausfall: steht im Rennen (nicht in der Box, keine rote Flagge) -> nach 4 s "steht", nach 30 s "ausgefallen"
      const still = raceOn && !inPit && p && c?.speed != null && c.speed <= 2;
      if (still) { if (!stopSince.has(n)) stopSince.set(n, now); } else stopSince.delete(n);
      const idle = still ? now - stopSince.get(n) : 0;
      const status = idle >= 30000 ? 'out' : idle >= 4000 ? 'stopped' : null;
      return {
        num: n, code: d.name_acronym, name: d.last_name || d.full_name, team: d.team_name || null, color: d.team_colour ? `#${d.team_colour}` : null, photo: safePhoto(d.headshot_url), pos: pos.get(n)?.position ?? 99, gap: iv?.gap_to_leader != null && typeof iv.gap_to_leader === 'number' ? iv.gap_to_leader : null,
        interval: typeof iv?.interval === 'number' ? iv.interval : null, last: o?.last?.lap_duration ?? null, best: o?.best ?? null, sectors: secs,
        sectorCls: secs.map((v, i) => sectorClass(v, o?.bestSec[i], overall[i])), tyre: stint?.compound ? stint.compound[0] : null, stops: stint ? stint.stint_number - 1 : 0,
        speed: c?.speed ?? null, throttle: c?.throttle ?? null, brake: c?.brake ?? null, gear: c?.n_gear ?? null, rpm: c?.rpm ?? null, drs: !era2026 && (c?.drs ?? 0) >= 10, ovt: era2026 && type === 'race' && overtake?.open === true && flag === 'green' && typeof iv?.interval === 'number' && iv.interval <= 1, pit: inPit ? 1 : 0, pitSince: inPit ? Date.parse(pitRec.date) - ((pitRec.lane_duration || pitRec.pit_duration) || 22) * 1000 : null, status, x: p?.x ?? null, y: p?.y ?? null, onTrack: !!p,
      };
    });
    if (type === 'quali') rows.sort((a, b) => (a.best ?? 1e9) - (b.best ?? 1e9)); else rows.sort((a, b) => a.pos - b.pos);
    rows.forEach((r, i) => { if (type === 'quali') r.pos = i + 1; });
    const leaderLap = Math.max(0, ...[...per.values()].map((o) => o.lap));
    const feed = [
      ...ctl.map((m) => ({ id: `rc${m.date}${m.message}`, kind: 'rc', t: Date.parse(m.date), level: m.flag === 'RED' ? 'red' : /YELLOW|SAFETY/i.test(`${m.flag} ${m.category}`) ? 'yellow' : '', tag: String(m.category || 'INFO').toUpperCase(), text: m.message })),
      ...radio.map((r) => ({ id: `rd${r.recording_url || r.date + r.driver_number}`, kind: 'radio', t: Date.parse(r.date), code: drivers.get(r.driver_number)?.name_acronym, tag: 'FUNK', url: r.recording_url })),
    ].sort((a, b) => b.t - a.t);
    const pitStops = pits.filter((p) => Date.parse(p.date) <= now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).map((p) => {
      const d = drivers.get(p.driver_number);
      const after = stints.find((x) => x.driver_number === p.driver_number && x.lap_start === p.lap_number + 1);
      return { id: `${p.driver_number}-${p.date}`, num: p.driver_number, code: d?.name_acronym || String(p.driver_number), color: d?.team_colour ? `#${d.team_colour}` : null, team: d?.team_name || null, photo: safePhoto(d?.headshot_url),
        lap: p.lap_number, lane: p.lane_duration ?? p.pit_duration ?? null, stop: stopTime(p), tyre: after?.compound ? after.compound[0] : null, at: Date.parse(p.date) };
    });
    // Das Safety Car steht nicht in den Positionsdaten: bei SC knapp vor dem Führenden darstellen (Näherung)
    let safetyCar;
    if (flag === 'sc' && track?.points?.length) {
      const lead = rows.find((r) => r.x != null && !r.pit && r.status !== 'out');
      if (lead) safetyCar = aheadOf(track.points, lead.x, lead.y);
    }
    return {
      safetyCar, sectorFlags: track?.marshal?.length ? sectorFlagsFrom(ctl) : undefined, pitStops, pitLoss: track?.pitLoss || null,
      now: replay ? now : Date.now(), flag, weather: wx, feed, track: track || { points: [] }, drivers: rows, overtake, upcoming: mergeUpcoming(upcoming, extras),
      problem: errors ? note : '',
      sourceNote: (replay ? tr('src.note.replay', { who: replayOnly ? 'Demo' : 'OpenF1', speed: clock.speed, session: session.session_name, place: session.location }) : tr('src.note.live', { session: session.session_name, place: session.location })) + (layoutNote ? ' · ' + tr('src.note.layout') : '') + ' · ' + tr('src.note.credits'),
      session: { key: session.session_key, type, name: session.session_name, circuit: session.circuit_short_name, lap: leaderLap || null, totalLaps: null, flagSince: since, phase: replay ? 'replay' : 'live', cutoff: type === 'quali' ? 10 : null,
        remaining: type === 'quali' ? Math.max(0, (Date.parse(session.date_end) - now) / 1000) : null },
      startLights: replay && raceStart() ? { startsAt: lightsOut(), now, speed: clock.paused || clock.hold ? 0 : clock.speed, per: Math.min(clock.speed, 4) } : undefined,
      replay: replay ? { start: sessionStart(), end: sessionEnd(), t: now, speed: clock.speed, paused: clock.paused, loading: loadingNow } : undefined,
    };
  }

  async function tick(my = epoch) {
    if (stopped || my !== epoch) return;
    try {
      if (session) {
        const t = Date.now();
        if (t - lastMedium > 6000) { await pollMedium(); lastMedium = t; }
        if (t - lastSlow > 15000) { await pollSlow(); lastSlow = t; }
        await pollFast();
      }
      if (my !== epoch) return;
      errors = 0; noteMsg = '';
    } catch (e) {
      if (my !== epoch) return; // Fehler einer verlassenen Session betrifft die neue nicht
      errors++; noteMsg = e.message;
    }
    if (my !== epoch) return; // in der Zwischenzeit wurde eine andere Session gewählt
    onState(build());
    timer = setTimeout(() => tick(my), errors ? 5000 : 2000);
  }

  async function tickReplay(my = epoch) {
    if (stopped || my !== epoch) return;
    try {
      let t = vnow();
      if (t > sessionEnd()) { clock = { ...clock, base: replayEntry(), at: Date.now() }; t = vnow(); } // Ende erreicht: von vorn
      if (!buffer.has(t)) {
        rebase({ hold: true }); loadingNow = true;
        onState(build()); // zeigt "Lade Daten …", die Uhr steht solange
        await loadWindow(buffer.startOf(t));
        if (my !== epoch) return;
        rebase({ hold: false }); loadingNow = false; t = vnow();
      } else {
        const next = buffer.startOf(t) + buffer.windowMs;
        if (t > next - buffer.windowMs * 0.65 && next < sessionEnd() && !buffer.has(next)) loadWindow(next).catch(() => {});
      }
      const smp = buffer.sample(t);
      carData = smp.carData; intervals = smp.intervals; pos = smp.position;
      loc = new Map([...smp.location].map(([n, p]) => { const [x, y] = toTrack(p.x, -p.y); return [n, { x, y }]; }));
      buffer.evict(t);
      if (my !== epoch) return;
      errors = 0; noteMsg = '';
    } catch (e) {
      if (my !== epoch) return; // Fehler einer verlassenen Session betrifft die neue nicht
      errors++; noteMsg = e.message;
      if (clock.hold) rebase({ hold: false });
      loadingNow = false;
    }
    if (my !== epoch) return;
    onState(build());
    timer = setTimeout(() => tickReplay(my), errors ? 5000 : 500);
  }

  async function init() {
    const my = ++epoch;
    try {
      if (!extras) await loadExtras();
      await chooseSession();
      if (my !== epoch) return;
      if (session) await loadStatic();
      else if (nextSession) {
        const db = await (await fetch('data/circuits.json')).json();
        const l = findLayout(db, nextSession, new Date(nextSession.date_start).getFullYear());
        if (l) track = { points: samplePath(l.d, 300), rotate: l.rotate };
      }
      if (my !== epoch) return;
    } catch (e) {
      if (my !== epoch) return;
      noteMsg = e.message; errors = 1;
      if (!stopped) { onState(build()); timer = setTimeout(init, 5000); }
      return;
    }
    if (replay && session) tickReplay(my); else tick(my);
  }

  return {
    id: 'openf1', demo: replayOnly, sim: false,
    start(cb) { onState = cb; stopped = false; init(); },
    stop() { stopped = true; clearTimeout(timer); },
    async calendar(year) {
      const [of1, jr] = await Promise.allSettled([
        Promise.all([rawGet(`meetings?year=${year}`), rawGet(`sessions?year=${year}&session_name=Race`)]).then(([m, s]) => buildOpenF1Calendar(m, s)),
        jolpica.races(year),
      ]);
      // Jolpica kennt den vollen Kalender (auch künftige Rennen), OpenF1 liefert die Schlüssel zum Abspielen
      if (jr.status === 'fulfilled' && jr.value.length) return { year, demo: false, source: 'jolpica', races: buildJolpicaCalendar(jr.value, of1.status === 'fulfilled' ? of1.value : []) };
      if (of1.status === 'rejected') throw of1.reason;
      return { year, demo: false, races: of1.value };
    },
    openRace(race) { pickedMeta = race || null; pickedRace = race && race.key == null ? race : null; sessionKey = race?.key ?? null; wantType = null; session = null; track = null; lastSlow = 0; lastMedium = 0; clearTimeout(timer); init(); },
    select(type) { pickedRace = null; pickedMeta = null; sessionKey = null; wantType = type; session = null; track = null; lastSlow = 0; lastMedium = 0; clearTimeout(timer); init(); },
    trigger() {},
    /** Steuerung der Wiederholung: Tempo, Pause, Sprung (Anteil 0..1 der Session). */
    setSpeed(v) { if (replay) rebase({ speed: v }); },
    pause(flag = true) { if (replay) rebase({ paused: !!flag }); },
    seek(frac) { if (!replay || !session) return; clock = { ...clock, base: sessionStart() + Math.min(1, Math.max(0, frac)) * (sessionEnd() - sessionStart()), at: Date.now() }; },
  };
}
