import { useCallback, useEffect, useRef, useState } from 'react';
import { detectOvertakes } from '../js/overtakes.js';
import { createCarAnimator } from '../js/track.js';
import { createDemoSource } from '../js/sources/demo.js';
import { createReplayDemoSource } from '../js/sources/replay-demo.js';
import { yearsFor } from '../js/calendar.js';
import { createOpenF1Source } from '../js/sources/openf1.js';

const sessionId = (s) => `${s.session.type}|${s.session.name}|${s.session.circuit}`;

/** ?source=openf1: Echtdaten (live, sonst Wiederholung) · ?source=sim: reine Simulation · sonst: Demo mit echten Renndaten (Wiederholung). */
function makeSource(params) {
  const src = params.get('source');
  const common = { token: params.get('token'), sessionKey: params.get('session'), wantType: params.get('type') };
  if (src === 'openf1') return createOpenF1Source({ ...common, speed: Number(params.get('speed')) || 8 });
  if (src === 'sim') return createDemoSource({ scenario: params.get('scenario') || 'auto' });
  return createReplayDemoSource({ ...common, speed: Number(params.get('speed')) || 2, scenario: params.get('scenario') || 'auto' });
}

/**
 * Hält Datenquelle, Zustand und Oberflächen-Zustand. onOvertake(list, colors) wird bei neuen
 * Überholmanövern aufgerufen, onSessionChange() beim Wechsel der Session.
 */
export function useDashboard({ onOvertake, onSessionChange }) {
  const [params] = useState(() => new URLSearchParams(location.search));
  const core = useRef(null);
  if (!core.current) core.current = { source: makeSource(params), animator: createCarAnimator(), hist: new Map(), prev: null };
  const { source, animator, hist } = core.current;

  const [state, setState] = useState(null);
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState('all');
  const [toasts, setToasts] = useState(true);
  const [view, setView] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [cal, setCal] = useState(null);
  const [db, setDb] = useState(null);
  const [mapMode, setMapMode] = useState(() => { try { const m = params.get('map') || localStorage.getItem('pitwall.map'); return m === 'wide' ? 'wide' : 'normal'; } catch { return 'normal'; } });
  const [feedOpen, setFeedOpen] = useState(() => { try { return localStorage.getItem('pitwall.feed') !== 'closed'; } catch { return true; } });
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;
  const cb = useRef({});
  cb.current = { onOvertake, onSessionChange };

  useEffect(() => {
    fetch('data/circuits.json').then((r) => r.json()).then(setDb).catch(() => {});
  }, []);

  useEffect(() => {
    source.start((s) => {
      const prev = core.current.prev;
      const same = prev && sessionId(prev) === sessionId(s);
      // Sprünge in der Wiederholung (Spulen, Laden) sind keine Überholmanöver
      const jumped = s.replay && (s.replay.loading || prev?.replay?.loading || (prev?.replay && Math.abs(s.replay.t - prev.replay.t) > 3000 * Math.max(1, s.replay.speed)));
      if (same && toastsRef.current && !jumped) {
        const color = new Map(s.drivers.map((d) => [d.code, d.color]));
        const found = detectOvertakes(prev, s).slice(0, 3);
        if (found.length) cb.current.onOvertake(found.map((o) => ({ ...o, byColor: color.get(o.by), overColor: color.get(o.over) })));
      } else if (!same) { cb.current.onSessionChange(); animator.reset(); }
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
  }, [source, animator, hist]);

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
      if (yearRef.current === y) setCal({ year: y, races: [], error: `Kalender konnte nicht geladen werden (${e.message}).` });
    }
  }, [source, db]);

  const yearRef = useRef(year);
  yearRef.current = year;

  const actions = {
    tab(type) {
      if (type === 'calendar') { setView('calendar'); loadCalendar(yearRef.current); }
      else { setView(null); source.select(type); }
    },
    year(y) { yearRef.current = y; setYear(y); loadCalendar(y); },
    openRace(race) { setView(null); source.openRace(race, db); },
    pick: setSel,
    loadSeasons: () => loadSeasons(yearsFor()),
    toggleFeed() { setFeedOpen((o) => { try { localStorage.setItem('pitwall.feed', o ? 'closed' : 'open'); } catch { /* optional */ } return !o; }); },
    mapMode(m) { setMapMode(m); try { localStorage.setItem('pitwall.map', m); } catch { /* optional */ } },
    filter: setFilter,
    toggleToasts() { setToasts((t) => { if (t) cb.current.onSessionChange(); return !t; }); },
    trigger: (ev) => source.trigger(ev),
    replay: { pause: (f) => source.pause?.(f), speed: (v) => source.setSpeed?.(v), seek: (f) => source.seek?.(f) },
    source(id) {
      const p = new URLSearchParams(location.search);
      if (id === 'openf1') p.set('source', 'openf1'); else p.delete('source');
      location.search = p.toString();
    },
  };

  const ui = { seasons, feedOpen, mapMode, cinema: mapMode === 'wide' && view !== 'calendar' && !!state?.track?.points?.length, sel: selected, filter, toasts, demo: source.demo, sim: !!source.sim, view, year, cal, db, pos: animator.sample(performance.now()) };
  return { state, ui, actions, hist, animator, params };
}
