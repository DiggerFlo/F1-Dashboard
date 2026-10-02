// Simulierte Datenquelle: Rennen, Safety Car, Rote Flagge, Qualifying und Vorschau.
// Die Engine ist ohne Timer nutzbar (step/trigger/state), damit sie testbar bleibt.
import { sectorClass, clamp } from '../format.js';
import { pointAt } from '../track.js';
import { findLayout } from '../circuits.js';
import { samplePath } from '../svgpath.js';

import { DEMO_TRACK } from './demo-track.js';
import { buildDemoCalendar } from '../calendar.js';
import { fmtLap } from '../format.js';
import { t as tr } from '../i18n.js';

const MONZA = { name: DEMO_TRACK.name, points: DEMO_TRACK.points, rotate: DEMO_TRACK.rotate, layoutId: 'demo-monza' };
const SECTORS = [0, 0.34, 0.68]; // Sektorgrenzen der Simulation (Anteil der Runde)
const DRIVERS = [['NOR', 'Norris'], ['PIA', 'Piastri'], ['LEC', 'Leclerc'], ['HAM', 'Hamilton'], ['VER', 'Verstappen'], ['TSU', 'Tsunoda'], ['RUS', 'Russell'], ['ANT', 'Antonelli'], ['ALB', 'Albon'], ['SAI', 'Sainz'],
  ['LAW', 'Lawson'], ['HAD', 'Hadjar'], ['ALO', 'Alonso'], ['STR', 'Stroll'], ['OCO', 'Ocon'], ['BEA', 'Bearman'], ['HUL', 'Hülkenberg'], ['BOR', 'Bortoleto'], ['GAS', 'Gasly'], ['COL', 'Colapinto']];
// Teams der Saison 2025 (zwei Fahrer je Team) in ungefährer Leistungsreihenfolge, mit den echten Teamfarben.
const TEAMS = [['McLaren', '#ff8000'], ['Ferrari', '#e8002d'], ['Red Bull Racing', '#3671c6'], ['Mercedes', '#27f4d2'], ['Williams', '#64c4ff'],
  ['Racing Bulls', '#6692ff'], ['Aston Martin', '#229971'], ['Haas', '#b6babd'], ['Kick Sauber', '#52e252'], ['Alpine', '#ff87bc']];
const COMPOUNDS = ['M', 'H', 'M', 'S', 'H', 'M', 'H', 'M', 'S', 'H', 'M', 'H', 'M', 'H', 'S', 'M', 'H', 'M', 'H', 'M'];
const BASE_LAP = 92.4;
const TOTAL_LAPS = 57;
const GAP_SC = 0.012; // Zielabstand hinter dem Vordermann in Runden

const RADIO_TAGS = ['TEAM', 'TEAM', 'BOX', 'TEAM', 'TECH', 'TEAM', 'TEAM', 'BOX-INFO'];
const radioLines = () => RADIO_TAGS.map((tag, i) => [tag, tr(`demo.radio.${i + 1}`)]); // Texte nach der aktuellen Sprache

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const secOf = (fr) => (fr < SECTORS[1] ? 0 : fr < SECTORS[2] ? 1 : 2);
const frac = (p) => p - Math.floor(p);

function speedProfile(f, num) {
  const ph = num * 0.37;
  return clamp(215 + 95 * Math.sin(2 * Math.PI * 3 * f + ph) + 45 * Math.sin(2 * Math.PI * 7 * f + 1), 70, 330);
}

export function createDemoEngine({ scenario = 'auto', seed = 7, now = Date.now(), startGrid = 0 } = {}) {
  const rnd = mulberry32(seed);
  const baseNow = now;
  let circuit = MONZA, meetingLabel = null;
  const meetingName = () => `${meetingLabel || tr('demo.italianGp')} (Demo)`;
  let clips = new Map(); // code -> echte Funksprüche aus public/data/radio.json
  const clipPos = new Map();
  let gridLeft = null; // Startampel: Sekunden bis zum Start (negativ = Lichter aus, noch kurz sichtbar)
  let seq = 0, bestLapAll = null, sprint = false, kind, simT, realT, flag, flagSince, feed, drivers, overall, remaining, upcomingEnd, autoIdx, weather, lastNow;

  const AUTO = [
    [0, () => setKind('race')], [40, () => trigger('sc')], [75, () => trigger('green')], [95, () => trigger('red')],
    [130, () => trigger('green')], [150, () => setKind('quali')], [215, () => setKind('upcoming')], [235, () => { realT = 0; autoIdx = 0; }],
  ];

  function speedFactor() { return kind === 'upcoming' ? 1 : 6; }

  function newDriver(i) {
    return { num: i + 1, code: DRIVERS[i][0], name: DRIVERS[i][1], team: TEAMS[i >> 1][0], color: TEAMS[i >> 1][1], skill: i * 0.09, prog: 0, v: 0, secStart: 0, secT: [], bestSec: [null, null, null], sectors: [null, null, null], sectorCls: ['', '', ''],
      best: null, last: null, stops: 0, tyre: COMPOUNDS[i], tyreAge: 8 + (i % 7), pit: 0, onTrack: true, speed: 0, throttle: 0, brake: 0, gear: 1, rpm: 0, drs: false, gap: 0, interval: 0, pos: i + 1, x: null, y: null, wait: 0 };
  }

  const totalLaps = () => (sprint ? 19 : TOTAL_LAPS);
  function setKind(k0) {
    sprint = k0 === 'sprint' || k0 === 'sprintquali'; // Sprint: kurzes Rennen ohne Stopps, Sprint-Quali: kürzere Segmente
    const k = k0 === 'sprint' ? 'race' : k0 === 'sprintquali' ? 'quali' : k0;
    kind = k; simT = 0; flag = 'green'; flagSince = null; feed = []; overall = [null, null, null]; bestLapAll = null;
    weather = { air: 24, track: 38, rain: false };
    drivers = DRIVERS.map((_, i) => newDriver(i));
    gridLeft = k === 'race' && startGrid > 0 ? startGrid : null;
    if (k === 'race') {
      drivers.forEach((d, i) => { d.prog = (sprint ? 13 : 31) - i * 0.008; d.secStart = 0; });
    } else if (k === 'quali' || k === 'practice') {
      remaining = k === 'quali' ? (sprint ? 600 : 900) : 3600;
      drivers.forEach((d, i) => {
        d.onTrack = false; d.tyre = k === 'quali' ? 'S' : ['S', 'M', 'H'][i % 3]; d.tyreAge = 3; d.wait = Math.floor(rnd() * 30);
        if (i < 16) { // Q2 läuft bereits: erste Zeiten stehen
          d.sectors = [28.2 + i * 0.03 + rnd() * 0.1, 31.1 + i * 0.05 + rnd() * 0.1, 28.1 + i * 0.04 + rnd() * 0.1];
          d.bestSec = [...d.sectors]; d.last = d.best = d.sectors[0] + d.sectors[1] + d.sectors[2];
          d.sectors.forEach((v, k) => { if (overall[k] == null || v < overall[k]) overall[k] = v; });
        }
      });
      drivers.forEach((d) => { d.sectorCls = d.sectors.map((v, k) => sectorClass(v, d.bestSec[k], overall[k])); });
    } else if (k === 'upcoming') {
      upcomingEnd = baseNow + realT * 1000 + (2 * 86400 + 14 * 3600 + 36 * 60 + 9) * 1000;
    }
    refreshPositions();
  }

  const nowMs = () => (kind === 'upcoming' ? baseNow + realT * 1000 : baseNow + simT * 1000);

  function say(level, tag, text) { feed.unshift({ id: `rc${++seq}`, kind: 'rc', t: nowMs(), level, tag, text }); }
  // Funk kommt wie bei echten Daten ohne Text; der gesprochene Inhalt steckt in `speech`.
  // Gibt es echte Aufnahmen des Fahrers (und real = true), kommt reihum eine davon, sonst der gesprochene Demo-Text.
  function radio(code, tag, speech, real = false) {
    const pool = real ? clips.get(code) : null;
    if (pool?.length) {
      const i = clipPos.get(code) || 0; clipPos.set(code, i + 1);
      const c = pool[i % pool.length];
      feed.unshift({ id: `rd${++seq}`, kind: 'radio', t: nowMs(), code, tag: 'FUNK', url: c.url, duration: c.duration, peaks: c.peaks, origin: c.session });
      return;
    }
    feed.unshift({ id: `rd${++seq}`, kind: 'radio', t: nowMs(), code, tag, speech });
  }
  function setClips(list) {
    clips = new Map();
    for (const c of list || []) { if (!clips.has(c.code)) clips.set(c.code, []); clips.get(c.code).push(c); }
  }

  function trigger(ev) {
    if (kind !== 'race') return;
    const prev = flag;
    if (ev === 'rain') { weather.rain = !weather.rain; say('yellow', 'WEATHER', weather.rain ? tr('demo.rainOn') : tr('demo.rainOff')); return; }
    if (ev === 'green') {
      if (prev === 'green') return;
      flag = 'green'; flagSince = null;
      say('', 'FLAG', prev === 'red' ? tr('demo.restart') : tr('demo.greenOn'));
      radio('NOR', 'TEAM', tr('demo.r.green'));
      return;
    }
    if (ev === prev) return;
    flag = ev; flagSince = nowMs();
    if (ev === 'sc') { say('yellow', 'SC', tr('demo.scMsg')); radio('LEC', 'BOX', tr('demo.r.scIn')); radio('HAM', 'TEAM', tr('demo.r.scStay')); }
    if (ev === 'vsc') { say('yellow', 'VSC', tr('demo.vscMsg')); }
    if (ev === 'yellow') { say('yellow', 'YELLOW', tr('demo.yellowMsg')); }
    if (ev === 'red') { say('red', 'RED', tr('demo.redMsg')); radio('NOR', 'BOX-INFO', tr('demo.r.red')); radio('LEC', 'TEAM', tr('demo.r.ok')); }
  }

  function refreshPositions() {
    const sorted = [...drivers];
    if (kind === 'quali' || kind === 'practice') {
      sorted.sort((a, b) => (a.best ?? 1e9) - (b.best ?? 1e9) || a.num - b.num);
    } else {
      sorted.sort((a, b) => b.prog - a.prog);
    }
    sorted.forEach((d, i) => { d.pos = i + 1; });
    drivers = sorted;
    if (kind === 'quali' || kind === 'practice') {
      const pole = drivers.find((d) => d.best != null)?.best;
      drivers.forEach((d) => { d.gap = d.best != null && pole != null ? d.best - pole : null; d.interval = d.gap; });
    } else if (kind === 'race') {
      const lead = drivers[0];
      drivers.forEach((d, i) => {
        d.gap = i === 0 ? 0 : (lead.prog - d.prog) * (BASE_LAP + d.skill);
        d.interval = i === 0 ? 0 : (drivers[i - 1].prog - d.prog) * (BASE_LAP + d.skill);
      });
    }
  }

  function telemetry(d) {
    const f = frac(d.prog);
    const slow = flag === 'sc' ? 0.42 : flag === 'vsc' ? 0.55 : 1;
    let sp = d.pit ? 80 : speedProfile(f, d.num) * slow;
    if (flag === 'red') sp = d.speed * 0.6 < 3 ? 0 : d.speed * 0.6;
    const slope = speedProfile(f + 0.004, d.num) - speedProfile(f, d.num);
    d.speed = sp;
    d.throttle = flag === 'red' || sp === 0 ? 0 : clamp(slope >= 0 ? 100 : 55 + slope * 6, 0, 100) * (slow < 1 ? 0.3 : 1);
    d.brake = flag === 'red' || slow < 1 ? 0 : slope < -6 ? clamp(-slope * 9, 0, 100) : 0;
    d.gear = sp === 0 ? 0 : clamp(Math.floor(sp / 45) + 1, 1, 8);
    d.rpm = sp === 0 ? 4000 : 6000 + (sp % 45) * 140;
    d.drs = kind === 'race' && flag === 'green' && d.pos > 1 && d.interval < 1 && sp > 250;
    [d.x, d.y] = pointAt(circuit.points, d.prog);
  }

  function completeSector(d, prevSec, dur) {
    d.secT[prevSec] = dur;
    if (prevSec !== 2) return;
    if (d.secT[0] == null || d.secT[1] == null) { d.secT = []; return; } // angefangene Runde zählt nicht
    const lap = d.secT.reduce((a, b) => a + b, 0);
    d.sectors = [...d.secT];
    d.last = lap;
    d.secT.forEach((v, k) => {
      if (d.bestSec[k] == null || v < d.bestSec[k]) d.bestSec[k] = v;
      if (overall[k] == null || v < overall[k]) overall[k] = v;
    });
    d.sectorCls = d.sectors.map((v, k) => sectorClass(v, d.bestSec[k], overall[k]));
    if (flag === 'green' && (d.best == null || lap < d.best)) d.best = lap;
    if (kind === 'race' && flag === 'green' && (bestLapAll == null || lap < bestLapAll)) {
      if (bestLapAll != null) say('', 'FASTEST', tr('demo.fastest', { code: d.code, time: fmtLap(lap) }));
      bestLapAll = lap;
    }
    d.secT = [];
    d.tyreAge++;
  }

  // Sektorzeiten in Sim-Sekunden: eigene Uhr pro Fahrer.
  function advanceDriver(d, dt, vLaps) {
    const before = d.prog;
    d.prog += vLaps * dt;
    d.clock = (d.clock || 0) + dt;
    const a = secOf(frac(before)), b = secOf(frac(d.prog));
    if (a !== b || Math.floor(before) !== Math.floor(d.prog)) {
      completeSector(d, a, d.clock - (d.secClock || 0));
      d.secClock = d.clock;
    }
  }

  function stepRace(dt) {
    const sorted = [...drivers].sort((x, y) => b2(y) - b2(x));
    const lead = sorted[0];
    sorted.forEach((d, i) => {
      if (flag === 'red') { telemetry(d); return; }
      const lapTime = BASE_LAP + d.skill;
      // Tagesform (langsame Schwankung) und Windschatten/DRS hinter dem Vordermann erzeugen Überholmanöver
      const ahead0 = sorted[i - 1];
      const gapAhead = ahead0 ? (ahead0.prog - d.prog) * lapTime : 99;
      const form = 0.013 * Math.sin(simT / 25 + d.num * 1.7);
      const draft = flag === 'green' && gapAhead < 1.0 ? 0.013 : 0;
      let rate = (1 / lapTime) * (1 + form + draft + (rnd() - 0.5) * 0.006);
      if (flag === 'sc' || flag === 'vsc') {
        const ahead = sorted[i - 1];
        const gap = ahead ? ahead.prog - d.prog : 1;
        rate = (i === 0 ? 0.55 : gap > GAP_SC * 1.6 ? 0.8 : 0.55) / lapTime;
        if (ahead && gap < GAP_SC * 0.5) rate = 0.3 / lapTime;
      }
      if (d.pit > 0) { rate *= 0.35; d.pit -= dt; if (d.pit <= 0) { d.pit = 0; } }
      else if (!sprint && flag === 'green' && d.tyreAge > 20 && rnd() < 0.002 * dt && d.stops < 2) { d.pit = 20; d.stops++; d.tyre = d.tyre === 'S' ? 'M' : 'H'; d.tyreAge = 0; say('', 'PIT', tr('demo.pitMsg', { code: d.code, n: d.stops, tyre: d.tyre === 'M' ? 'Medium' : 'Hard' })); }
      else if (!sprint && flag === 'sc' && d.tyreAge > 12 && d.stops < 2 && rnd() < 0.01 * dt) { d.pit = 20; d.stops++; d.tyre = 'H'; d.tyreAge = 0; }
      advanceDriver(d, dt, rate);
      telemetry(d);
    });
    function b2(d) { return d.prog; }
    // Nachziehen verhindern: kein Auto fährt in das vor ihm (nur unter SC/VSC).
    if (flag === 'sc' || flag === 'vsc') {
      for (let i = 1; i < sorted.length; i++) {
        const lim = sorted[i - 1].prog - 0.004;
        if (sorted[i].prog > lim) sorted[i].prog = lim;
      }
    }
    if (lead.prog >= totalLaps() + 1 && flag !== 'chequered') { flag = 'chequered'; say('', 'FINISH', tr('demo.finish')); }
  }

  function stepQuali(dt) {
    remaining = Math.max(0, remaining - dt);
    const onCount = drivers.filter((d) => d.onTrack).length;
    drivers.forEach((d) => {
      if (!d.onTrack) {
        d.wait -= dt;
        if (d.wait <= 0 && onCount < 6 && remaining > 100 && rnd() < 0.15) { d.onTrack = true; d.prog = 0; d.clock = 0; d.secClock = 0; d.secT = []; d.tyreAge = 0; }
        d.speed = 0; d.throttle = 0; d.brake = 0; d.drs = false; d.x = d.y = null;
        return;
      }
      const lapTime = 87.4 + d.skill * 0.9 + rnd() * 0.5;
      const before = Math.floor(d.prog);
      advanceDriver(d, dt, 1 / lapTime);
      telemetry(d);
      if (Math.floor(d.prog) > before) { d.onTrack = false; d.wait = 25 + rnd() * 40; d.prog = 0; d.sectors = [...d.sectors]; }
    });
  }

  function step(dtReal) {
    realT += dtReal;
    if (kind === 'race' && gridLeft != null) {
      gridLeft -= dtReal;
      if (gridLeft <= -4.5) gridLeft = null;
      else if (gridLeft > 0) return; // Feld steht, das Rennen wartet auf Lights out
    }
    const dt = dtReal * speedFactor();
    simT += dt;
    if (scenario === 'auto') {
      while (autoIdx < AUTO.length && realT >= AUTO[autoIdx][0]) { const fn = AUTO[autoIdx][1]; autoIdx++; fn(); }
    }
    if (kind === 'race') {
      stepRace(dt);
      if (flag === 'green' && rnd() < 0.004 * dtReal) {
        const v = drivers[Math.floor(rnd() * drivers.length)];
        say('yellow', 'PENALTY', tr('demo.penalty', { num: v.num, code: v.code }));
      }
      if (rnd() < 0.01 * dtReal) { weather.air = clamp(weather.air + (rnd() - 0.5), 21, 28); weather.track = clamp(weather.track + (rnd() - 0.5) * 2, 32, 44); }
      if (flag === 'green' && rnd() < 0.05 * dtReal) {
        const d = drivers[Math.floor(rnd() * 8)]; const lines = radioLines(); const r = lines[Math.floor(rnd() * lines.length)];
        radio(d.code, r[0], r[1], true);
      }
    } else if (kind === 'quali' || kind === 'practice') {
      stepQuali(dt);
      if (rnd() < 0.04 * dtReal) { const d = drivers[Math.floor(rnd() * 10)]; radio(d.code, 'TEAM', tr('demo.r.traffic'), true); }
    }
    if (kind !== 'upcoming') refreshPositions();
    if (feed.length > 60) feed.length = 60;
  }

  function state() {
    const base = {
      now: nowMs(), flag, sourceNote: tr('src.note.sim'),
      weather: { air: Math.round(weather.air), track: Math.round(weather.track), rain: weather.rain }, track: { points: circuit.points, rotate: circuit.rotate, layoutId: circuit.layoutId }, feed: [...feed],
    };
    if (kind === 'upcoming') {
      return { ...base, flag: 'green', session: { type: 'upcoming', name: 'Rennen', meeting: meetingName(), circuit: circuit.name, startsAt: upcomingEnd }, drivers: [],
        upcoming: { startsAt: upcomingEnd, nextLabel: 'sess.nextRace', meeting: meetingName(), circuit: circuit.name,
          facts: circuit === MONZA ? [['fact.lapLength', '5.793 km'], ['fact.raceDistance', tr('fact.laps', { n: 53 })], ['fact.layout', tr('fact.since', { year: 2000 })], ['fact.drsZones', '2']] : [['fact.circuit', circuit.name], ['fact.raceDistance', tr('fact.laps', { n: TOTAL_LAPS })]],
          schedule: [['Training 1', tr('wd.fri', { time: '11:30' })], ['Training 2', tr('wd.fri', { time: '15:00' })], ['Training 3', tr('wd.sat', { time: '11:30' })], ['Qualifying', tr('wd.sat', { time: '15:00' })], ['Rennen', tr('wd.sun', { time: '14:00' })]],
          weather: [['wx.air', '24 °C'], ['wx.track', '38 °C'], ['wx.rainChance', '10 %'], ['wx.wind', '12 km/h SW']],
          standings: DRIVERS.slice(0, 10).map(([code], i) => ({ code, points: 310 - i * 21, wins: Math.max(0, 7 - i) })) },
        feed: [{ id: 'rc0', kind: 'rc', t: baseNow - 3600000, tag: 'INFO', text: tr('demo.radioNext') }] };
    }
    const leader = drivers[0];
    const session = kind === 'race'
      ? { type: 'race', kind: sprint ? 'sprint' : 'race', name: sprint ? 'Sprint' : 'Rennen', circuit: circuit.name, lap: Math.min(totalLaps(), Math.floor(leader.prog)), totalLaps: totalLaps(), flagSince }
      : kind === 'practice'
        ? { type: 'practice', kind: 'practice', name: 'Training 2', circuit: circuit.name, remaining, cutoff: null, flagSince }
        : { type: 'quali', kind: sprint ? 'sprintquali' : 'quali', name: sprint ? 'SQ2' : 'Q2', circuit: circuit.name, remaining, cutoff: 10, flagSince };
    const out = { ...base, startLights: kind === 'race' && gridLeft != null ? { startsAt: Date.now() + gridLeft * 1000, now: Date.now() } : undefined, session, drivers: drivers.map((d) => ({ ...d, onTrack: kind === 'quali' || kind === 'practice' ? d.onTrack : true })) };
    if (flag === 'sc') { const [x, y] = pointAt(circuit.points, leader.prog + 0.03); out.safetyCar = { x, y }; }
    return out;
  }

  function setScenario(name) {
    if (name === 'auto') { scenario = 'auto'; realT = 0; autoIdx = 0; return; }
    scenario = name; setKind(name);
  }

  realT = 0; autoIdx = 0;
  if (scenario === 'auto') { AUTO[0][1](); autoIdx = 1; } else setKind(scenario);

  /** Strecke wechseln (Punkte und Ausrichtung aus dem Layout-Datensatz); null = Standard (Monza). */
  function setCircuit(c, meeting = null) { circuit = c || MONZA; meetingLabel = c ? meeting : null; if (drivers) drivers.forEach((d) => { [d.x, d.y] = pointAt(circuit.points, d.prog); }); }

  return { step, trigger, setScenario, setCircuit, setClips, state, get kind() { return kind; } };
}

export function createDemoSource(opts = {}) {
  const engine = createDemoEngine({ startGrid: 6, ...opts });
  let timer = null, emit = null;
  return {
    id: 'demo',
    demo: true,
    sim: true,
    start(onState, tickMs = 500) {
      // Echte Funksprüche (OpenF1, mit vorberechneter Wellenform) nachladen; ohne die Datei spricht die Demo synthetisch
      if (typeof fetch === 'function' && typeof location !== 'undefined') fetch('data/radio.json').then((r) => (r.ok ? r.json() : [])).then((c) => engine.setClips(c)).catch(() => {});
      const push = () => onState(engine.state());
      emit = push;
      push();
      timer = setInterval(() => { engine.step(tickMs / 1000); push(); }, tickMs);
    },
    stop() { clearInterval(timer); },
    select(type) { engine.setScenario(['practice', 'quali', 'sprint', 'sprintquali', 'upcoming'].includes(type) ? type : 'race'); },
    trigger(ev) { engine.trigger(ev); },
    async calendar(year, db) { return { year, demo: true, races: buildDemoCalendar(db, year) }; },
    /** Rennen aus dem Kalender: dessen Streckenlayout laden und ein Demo-Rennen darauf starten. */
    openRace(race, db) {
      const l = race && db && findLayout(db, { circuit_short_name: race.circuit, location: race.location, country_name: race.country, year: race.year }, race.year);
      engine.setCircuit(l ? { name: l.circuit, points: samplePath(l.d, 300), rotate: l.rotate, layoutId: l.id } : null, race?.meeting);
      engine.setScenario('race');
      emit?.(); // sofort anzeigen, nicht erst beim nächsten Takt
    },
  };
}
