import { useCallback, useEffect, useRef, useState } from 'react';
import { detectOvertakes } from '../js/overtakes.js';
import { detectPitStops, detectRetirements } from '../js/pitstops.js';
import { plannedLaps } from '../js/laps.js';
import { eventsFrom } from '../js/events.js';
import { createCarAnimator } from '../js/track.js';
import { createDemoSource } from '../js/sources/demo.js';
import { yearsFor } from '../js/calendar.js';
import { createOpenF1Source } from '../js/sources/openf1.js';

const sessionId = (s) => `${s.session.type}|${s.session.name}|${s.session.circuit}`;
const TAB_LABEL = { upcoming: 'tab.upcoming', session: 'tab.session', race: 'tab.race', sprint: 'tab.sprint', quali: 'tab.quali', sprintquali: 'tab.sprintquali', practice: 'tab.practice', calendar: 'tab.calendar' }; // Schlüssel, übersetzt erst die Ladeanzeige
const DEFAULT_SHOW = { radio: true, rc: true, overtake: true, pit: true, dnf: true }; // was unter "Alle" in der Ereignisliste steht
const PENDING_MAX_MS = 30000; // spätestens dann verschwindet die Ladeanzeige, auch wenn nie Daten der Zielansicht kommen

/** ?source=sim: Demo (Simulation) · sonst: Live-Daten aus OpenF1 (live mit Token, sonst Wiederholung der letzten Session bzw. Vorschau). */
function makeSource(params) {
  const src = params.get('source');
  const common = { token: params.get('token'), sessionKey: params.get('session'), wantType: params.get('type') };
  if (src === 'sim') return createDemoSource({ scenario: params.get('scenario') || 'auto' });
  return createOpenF1Source({ ...common, speed: Number(params.get('speed')) || 2 });
}

/**
 * Hält Datenquelle, Zustand und Oberflächen-Zustand. onOvertake(list, colors) wird bei neuen
 * Überholmanövern aufgerufen, onSessionChange() beim Wechsel der Session.
 */
export function useDashboard() {
  const [params] = useState(() => new URLSearchParams(location.search));
  const core = useRef(null);
  if (!core.current) core.current = { source: makeSource(params), animator: createCarAnimator(), hist: new Map(), prev: null };
  const { source, animator, hist } = core.current;

  const [state, setState] = useState(null);
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState('all');
  const [events, setEvents] = useState([]); // Überholungen, Boxenstopps, Ausfälle der laufenden Session
  const [show, setShow] = useState(() => { try { return { ...DEFAULT_SHOW, ...JSON.parse(localStorage.getItem('pitwall.show') || '{}') }; } catch { return DEFAULT_SHOW; } });
  const [view, setView] = useState(null);
  const viewRef = useRef(view); // im Kalender laufen Hinweise nicht weiter
  viewRef.current = view;
  const [year, setYear] = useState(new Date().getFullYear());
  const [cal, setCal] = useState(null);
  const [db, setDb] = useState(null);
  const [geo, setGeo] = useState(null); // Ausrichtung der Layouts auf die Weltkarte (circuit-geo.json)
  const [basemap, setBasemap] = useState(() => { try { const v = params.get('base') || localStorage.getItem('pitwall.basemap'); return v === 'off' || v === 'sat' ? v : 'map'; } catch { return 'map'; } }); // 'off' | 'map' | 'sat'
  // Seitenwechsel, der noch auf Daten wartet: { type, label }. type null = bestimmte Session (Kalender), dann entscheidet der Wechsel der Session.
  const [pending, setPending] = useState(null);
  const pendRef = useRef(null), pendTimer = useRef(null);
  const clearPending = useCallback(() => { clearTimeout(pendTimer.current); pendRef.current = null; setPending(null); }, []);
  const startPending = (p) => {
    clearTimeout(pendTimer.current);
    pendRef.current = { ...p, startId: core.current.prev ? sessionId(core.current.prev) : null };
    setPending({ type: p.type || null, label: p.label });
    pendTimer.current = setTimeout(clearPending, PENDING_MAX_MS);
  };
  useEffect(() => () => clearTimeout(pendTimer.current), []);
  const [mapMode, setMapMode] = useState(() => { try { const m = params.get('map') || localStorage.getItem('pitwall.map'); return m === 'wide' ? 'wide' : 'normal'; } catch { return 'normal'; } });
  const [feedOpen, setFeedOpen] = useState(() => { try { return localStorage.getItem('pitwall.feed') !== 'closed'; } catch { return true; } });

  useEffect(() => {
    fetch('data/circuits.json').then((r) => r.json()).then(setDb).catch(() => {});
    fetch('data/circuit-geo.json').then((r) => r.json()).then(setGeo).catch(() => {}); // ohne die Datei gibt es einfach keinen Kartenhintergrund
  }, []);

  const geoRef = useRef(null);
  geoRef.current = geo;

  useEffect(() => {
    source.start((s0) => {
      // OpenF1 nennt die Rundenzahl nicht: aus Streckenlänge und Renndistanz schätzen (nie weniger als die gefahrene Runde)
      let s = s0;
      const ss = s0.session;
      if (ss.type === 'race' && ss.totalLaps == null) {
        const planned = plannedLaps(geoRef.current?.[s0.track?.layoutId]?.len, ss.kind, s0.track?.layoutId);
        if (planned) s = { ...s0, session: { ...ss, totalLaps: Math.max(planned, ss.lap || 0) } };
      }
      const prev = core.current.prev;
      const same = prev && sessionId(prev) === sessionId(s);
      const pd = pendRef.current; // Zielansicht ist da, sobald Typ bzw. Session passen und nichts mehr lädt
      if (pd && (s.liveLock || s.problem || (!s.replay?.loading && (pd.type ? (s.session.kind || s.session.type) === pd.type : sessionId(s) !== pd.startId)))) clearPending(); // auch bei Fehler/Sperre: die Zielansicht kommt so bald nicht
      // Sprünge in der Wiederholung (Spulen, Laden) sind keine Überholmanöver
      const jumped = s.replay && (s.replay.loading || prev?.replay?.loading || (prev?.replay && Math.abs(s.replay.t - prev.replay.t) > 3000 * Math.max(1, s.replay.speed)));
      if (same && !jumped && viewRef.current !== 'calendar') {
        const color = new Map(s.drivers.map((d) => [d.code, d.color]));
        const found = detectOvertakes(prev, s).slice(0, 3);
        const stops = detectPitStops(prev, s);
        const out = detectRetirements(prev, s);
        const fresh = eventsFrom({ found, stops, out, now: s.now, color });
        if (fresh.length) setEvents((e) => [...fresh.filter((f) => !e.some((x) => x.id === f.id)), ...e].slice(0, 150));
      } else if (!same) { animator.reset(); setEvents([]); }
      setEvents((e) => (e.some((x) => x.t > s.now) ? e.filter((x) => x.t <= s.now) : e)); // zurückgespult: Ereignisse aus der Zukunft entfernen
      animator.update(s, performance.now());
      for (const d of s.drivers) {
        if (d.speed == null) continue;
        const h = hist.get(d.num) || [];
        h.push({ speed: d.speed, throttle: d.throttle || 0, brake: d.brake || 0 });
        if (h.length > 120) h.shift();
        hist.set(d.num, h);
      }
      core.current.prev = s;
      setState(s);
    });
    return () => source.stop();
  }, [source, animator, hist, clearPending]);

  // Auswahl gültig halten: Standard ist der dritte Fahrer, sonst der erste
  const selected = state?.drivers.some((d) => d.num === sel) ? sel : state?.drivers[2]?.num ?? state?.drivers[0]?.num ?? null;

  // Rennen für die Auswahl in der Wiederholung: Saison -> Rennen. Die laufende Saison wird sofort geladen, ältere beim Öffnen des Dropdowns.
  const [seasons, setSeasons] = useState({});
  const seasonLoads = useRef(new Set());
  const loadSeasons = useCallback(async (years) => {
    for (const y of years) {
      if (seasonLoads.current.has(y)) continue;
      seasonLoads.current.add(y);
      try {
        const c = await source.calendar(y, null);
        setSeasons((s) => ({ ...s, [y]: c.races }));
      } catch { seasonLoads.current.delete(y); }
    }
  }, [source]);
  useEffect(() => {
    if (state?.replay && !source.sim) loadSeasons([new Date().getFullYear()]);
  }, [!!state?.replay, source, loadSeasons]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCalendar = useCallback(async (y) => {
    setCal(null);
    try {
      const data = await source.calendar(y, db || (await (await fetch('data/circuits.json')).json()));
      if (yearRef.current === y) setCal(data);
    } catch (e) {
      if (yearRef.current === y) setCal({ year: y, races: [], error: e.message }); // Text übersetzt die Anzeige
    }
  }, [source, db]);

  const yearRef = useRef(year);
  yearRef.current = year;

  const actions = {
    /** Eine Session des Wochenendes öffnen: key aus state.weekend (OpenF1), ohne key nach Art (Demo, unbekanntes Wochenende). */
    session(kind, key = null) {
      startPending({ type: kind, label: TAB_LABEL[kind] || 'tab.session' });
      setView(null);
      if (key != null && source.openSession) source.openSession(key); else source.select(kind);
    },
    tab(type) {
      if (type === 'session') { // Sammelpunkt für Rennen, Sprint, Quali, Sprint-Quali, Training: zurück zur zuletzt gesehenen Session, sonst Rennen
        const prev = core.current.prev?.session;
        const same = prev && prev.type !== 'upcoming' ? prev : null;
        if (same && viewRef.current !== 'calendar') return;
        actions.session(same ? same.kind || same.type : 'race', same && !source.sim ? same.key ?? null : null);
        return;
      }
      if (type === 'calendar') { clearPending(); source.pause?.(true); setView('calendar'); loadCalendar(yearRef.current); } // Wiederholung anhalten
      else {
        if (type !== (core.current.prev?.session.kind || core.current.prev?.session.type)) startPending({ type, label: TAB_LABEL[type] || 'tab.race' });
        setView(null); source.select(type);
      }
    },
    year(y) { yearRef.current = y; setYear(y); loadCalendar(y); },
    openRace(race) { startPending({ type: null, label: race?.meeting || 'tab.race' }); setView(null); source.openRace(race, db); },
    pick: setSel,
    loadSeasons: () => loadSeasons(yearsFor()),
    toggleFeed() { setFeedOpen((o) => { try { localStorage.setItem('pitwall.feed', o ? 'closed' : 'open'); } catch { /* optional */ } return !o; }); },
    basemap(id) { setBasemap(id); try { localStorage.setItem('pitwall.basemap', id); } catch { /* optional */ } },
    mapMode(m) { setMapMode(m); try { localStorage.setItem('pitwall.map', m); } catch { /* optional */ } },
    filter: setFilter,
    showKind(k, v) { setShow((cur) => { const n = { ...cur, [k]: v }; try { localStorage.setItem('pitwall.show', JSON.stringify(n)); } catch { /* optional */ } return n; }); },
    trigger: (ev) => source.trigger(ev),
    replay: { pause: (f) => source.pause?.(f), speed: (v) => source.setSpeed?.(v), seek: (f) => source.seek?.(f) },
    source(id) {
      const p = new URLSearchParams(location.search);
      if (id === 'demo') p.set('source', 'sim'); else p.delete('source'); // Demo = Simulation, Live-Daten (OpenF1) sind der Standard
      location.search = p.toString();
    },
  };

  const loading = pending ? { label: pending.label } : view === 'calendar' && !cal ? { label: TAB_LABEL.calendar } : null;
  const ui = { geo, basemap, events, show, loading, pendingType: pending?.type || null, seasons, feedOpen, mapMode, cinema: mapMode === 'wide' && view !== 'calendar' && !!state?.track?.points?.length, sel: selected, filter, demo: source.demo, sim: !!source.sim, view, year, cal, db, pos: animator.sample(performance.now()) };
  return { state, ui, actions, hist, animator, params };
}
