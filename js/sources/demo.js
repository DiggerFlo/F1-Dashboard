// Simulierte Datenquelle: Rennen, Safety Car, Rote Flagge, Qualifying und Vorschau.
// Die Engine ist ohne Timer nutzbar (step/trigger/state), damit sie testbar bleibt.
import { sectorClass, clamp } from '../format.js';
import { pointAt } from '../track.js';

const POINTS = [[70, 200], [70, 120], [110, 70], [200, 60], [250, 100], [310, 70], [390, 60], [450, 100], [460, 160], [420, 200], [360, 190], [320, 230], [260, 250], [190, 240], [140, 210]];
const SECTORS = [0, 0.34, 0.68];
const TURNS = [0.06, 0.13, 0.2, 0.28, 0.37, 0.45, 0.55, 0.63, 0.72, 0.8, 0.9];
const DRIVERS = [['VAL', 'Valdor'], ['KRN', 'Kernes'], ['MOR', 'Moretti'], ['LUN', 'Lund'], ['BEC', 'Becker'], ['OSA', 'Osaki'], ['ROU', 'Rouvel'], ['TAN', 'Tanaka'], ['HAR', 'Harlow'], ['SIL', 'Silva'],
  ['DUP', 'Dupont'], ['NOV', 'Novak'], ['BRA', 'Braga'], ['KEL', 'Keller'], ['ANS', 'Ansel'], ['FAR', 'Farrow'], ['MEN', 'Mendez'], ['WIE', 'Wieland'], ['ZAN', 'Zanetti'], ['COL', 'Colby']];
const COMPOUNDS = ['M', 'H', 'M', 'S', 'H', 'M', 'H', 'M', 'S', 'H', 'M', 'H', 'M', 'H', 'S', 'M', 'H', 'M', 'H', 'M'];
const BASE_LAP = 92.4;
const TOTAL_LAPS = 57;
const GAP_SC = 0.012; // Zielabstand hinter dem Vordermann in Runden

const RADIO = [
  ['TEAM', 'Reifen halten gut, aber hinten wird es langsam heiß.'],
  ['TEAM', 'Gap nach vorne 1.8, halte den Abstand.'],
  ['BOX', 'Wir stoppen diese Runde. Reifen Medium.'],
  ['TEAM', 'Ich bin schneller als der Vordermann, lasst mich DRS nutzen.'],
  ['TECH', 'Frontflügel scheint beschädigt, kannst du das bestätigen?'],
  ['TEAM', 'Verstanden, ich schone die Bremsen.'],
  ['TEAM', 'Balance ist gut, Untersteuern in den langsamen Kurven.'],
  ['BOX-INFO', 'Hinter dir ist ein Gelber Reifen im Windschatten.'],
];

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

export function createDemoEngine({ scenario = 'auto', seed = 7, now = Date.now() } = {}) {
  const rnd = mulberry32(seed);
  const baseNow = now;
  let seq = 0, kind, simT, realT, flag, flagSince, feed, drivers, overall, remaining, upcomingEnd, autoIdx, weather, lastNow;

  const AUTO = [
    [0, () => setKind('race')], [40, () => trigger('sc')], [75, () => trigger('green')], [95, () => trigger('red')],
    [130, () => trigger('green')], [150, () => setKind('quali')], [215, () => setKind('upcoming')], [235, () => { realT = 0; autoIdx = 0; }],
  ];

  function speedFactor() { return kind === 'upcoming' ? 1 : 6; }

  function newDriver(i) {
    return { num: i + 1, code: DRIVERS[i][0], name: DRIVERS[i][1], skill: i * 0.09, prog: 0, v: 0, secStart: 0, secT: [], bestSec: [null, null, null], sectors: [null, null, null], sectorCls: ['', '', ''],
      best: null, last: null, stops: 0, tyre: COMPOUNDS[i], tyreAge: 8 + (i % 7), pit: 0, onTrack: true, speed: 0, throttle: 0, brake: 0, gear: 1, rpm: 0, drs: false, gap: 0, interval: 0, pos: i + 1, x: null, y: null, wait: 0 };
  }

  function setKind(k) {
    kind = k; simT = 0; flag = 'green'; flagSince = null; feed = []; overall = [null, null, null];
    weather = { air: 24, track: 38, rain: false };
    drivers = DRIVERS.map((_, i) => newDriver(i));
    if (k === 'race') {
      drivers.forEach((d, i) => { d.prog = 31 - i * 0.008; d.secStart = 0; });
    } else if (k === 'quali') {
      remaining = 900;
      drivers.forEach((d, i) => {
        d.onTrack = false; d.tyre = 'S'; d.tyreAge = 3; d.wait = Math.floor(rnd() * 30);
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
  function radio(code, tag, speech) { feed.unshift({ id: `rd${++seq}`, kind: 'radio', t: nowMs(), code, tag, speech }); }

  function trigger(ev) {
    if (kind !== 'race') return;
    const prev = flag;
    if (ev === 'green') {
      if (prev === 'green') return;
      flag = 'green'; flagSince = null;
      say('', 'FLAGGE', prev === 'red' ? 'Restart. Strecke frei, Grüne Flagge.' : 'Strecke frei, Grüne Flagge.');
      radio('VAL', 'TEAM', 'Grün, Grün. Wir greifen an.');
      return;
    }
    if (ev === prev) return;
    flag = ev; flagSince = nowMs();
    if (ev === 'sc') { say('yellow', 'SC', 'SAFETY CAR EINGESETZT. Fahrzeug 16 (FAR) in Kurve 7 gestoppt.'); radio('MOR', 'BOX', 'Ich will reinkommen, günstiger Stopp. Bestätigen?'); radio('LUN', 'TEAM', 'Wir bleiben draußen. Halte Delta.'); }
    if (ev === 'vsc') { say('yellow', 'VSC', 'VIRTUAL SAFETY CAR EINGESETZT.'); }
    if (ev === 'yellow') { say('yellow', 'GELB', 'Gelbe Flagge Sektor 2.'); }
    if (ev === 'red') { say('red', 'ROT', 'ROTE FLAGGE. Session unterbrochen. Alle Fahrzeuge in die Boxengasse.'); radio('VAL', 'BOX-INFO', 'Rote Flagge, wir fahren in die Boxengasse. Reifenwechsel möglich?'); radio('MOR', 'TEAM', 'Sind alle okay?'); }
  }

  function refreshPositions() {
    const sorted = [...drivers];
    if (kind === 'quali') {
      sorted.sort((a, b) => (a.best ?? 1e9) - (b.best ?? 1e9) || a.num - b.num);
    } else {
      sorted.sort((a, b) => b.prog - a.prog);
    }
    sorted.forEach((d, i) => { d.pos = i + 1; });
    drivers = sorted;
    if (kind === 'quali') {
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
    [d.x, d.y] = pointAt(POINTS, d.prog);
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
      let rate = (1 / lapTime) * (1 + (rnd() - 0.5) * 0.012);
      if (flag === 'sc' || flag === 'vsc') {
        const ahead = sorted[i - 1];
        const gap = ahead ? ahead.prog - d.prog : 1;
        rate = (i === 0 ? 0.55 : gap > GAP_SC * 1.6 ? 0.8 : 0.55) / lapTime;
        if (ahead && gap < GAP_SC * 0.5) rate = 0.3 / lapTime;
      }
      if (d.pit > 0) { rate *= 0.35; d.pit -= dt; if (d.pit <= 0) { d.pit = 0; } }
      else if (flag === 'green' && d.tyreAge > 20 && rnd() < 0.002 * dt && d.stops < 2) { d.pit = 20; d.stops++; d.tyre = d.tyre === 'S' ? 'M' : 'H'; d.tyreAge = 0; }
      else if (flag === 'sc' && d.tyreAge > 12 && d.stops < 2 && rnd() < 0.01 * dt) { d.pit = 20; d.stops++; d.tyre = 'H'; d.tyreAge = 0; }
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
    if (lead.prog >= TOTAL_LAPS + 1 && flag !== 'chequered') { flag = 'chequered'; say('', 'ZIEL', 'Zielflagge. Das Rennen ist beendet.'); }
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
    const dt = dtReal * speedFactor();
    simT += dt;
    if (scenario === 'auto') {
      while (autoIdx < AUTO.length && realT >= AUTO[autoIdx][0]) { const fn = AUTO[autoIdx][1]; autoIdx++; fn(); }
    }
    if (kind === 'race') {
      stepRace(dt);
      if (flag === 'green' && rnd() < 0.05 * dtReal) {
        const d = drivers[Math.floor(rnd() * 8)]; const r = RADIO[Math.floor(rnd() * RADIO.length)];
        radio(d.code, r[0], r[1]);
      }
    } else if (kind === 'quali') {
      stepQuali(dt);
      if (rnd() < 0.04 * dtReal) { const d = drivers[Math.floor(rnd() * 10)]; radio(d.code, 'TEAM', 'Verkehr in Kurve 4, ich musste aufmachen.'); }
    }
    if (kind !== 'upcoming') refreshPositions();
    if (feed.length > 60) feed.length = 60;
  }

  function state() {
    const base = {
      now: nowMs(), flag, sourceNote: 'Simulierte Demo-Daten. Echte Daten: ?source=openf1',
      weather, track: { points: POINTS, sectors: SECTORS, turns: TURNS }, feed: [...feed],
    };
    if (kind === 'upcoming') {
      return { ...base, flag: 'green', session: { type: 'upcoming', name: 'Rennen', meeting: 'Beispiel-GP', circuit: 'Circuit Demo', startsAt: upcomingEnd }, drivers: [],
        upcoming: { startsAt: upcomingEnd, nextLabel: 'Nächstes Rennen', meeting: 'Beispiel-GP', circuit: 'Circuit Demo · Runde 18 von 24',
          facts: [['Rundenlänge', '5.412 km'], ['Renndistanz', '57 Runden'], ['Rundenrekord', '1:32.418'], ['DRS-Zonen', '2']],
          schedule: [['Training 1', 'Fr 11:30'], ['Training 2', 'Fr 15:00'], ['Training 3', 'Sa 11:30'], ['Qualifying', 'Sa 15:00'], ['Rennen', 'So 14:00']],
          weather: [['Lufttemperatur', '24 °C'], ['Streckentemperatur', '38 °C'], ['Regenwahrscheinlichkeit', '10 %'], ['Wind', '12 km/h SW']],
          standings: DRIVERS.slice(0, 10).map(([code], i) => ({ code, points: 310 - i * 21, wins: Math.max(0, 7 - i) })) },
        feed: [{ id: 'rc0', kind: 'rc', t: baseNow - 3600000, tag: 'INFO', text: 'Der Funk startet mit der nächsten Session.' }] };
    }
    const leader = drivers[0];
    const session = kind === 'race'
      ? { type: 'race', name: 'Rennen', circuit: 'Circuit Demo', lap: Math.min(TOTAL_LAPS, Math.floor(leader.prog)), totalLaps: TOTAL_LAPS, flagSince }
      : { type: 'quali', name: 'Q2', circuit: 'Circuit Demo', remaining, cutoff: 10, flagSince };
    const out = { ...base, session, drivers: drivers.map((d) => ({ ...d, onTrack: kind === 'quali' ? d.onTrack : true })) };
    if (flag === 'sc') { const [x, y] = pointAt(POINTS, leader.prog + 0.03); out.safetyCar = { x, y }; }
    return out;
  }

  function setScenario(name) {
    if (name === 'auto') { scenario = 'auto'; realT = 0; autoIdx = 0; return; }
    scenario = name; setKind(name);
  }

  realT = 0; autoIdx = 0;
  if (scenario === 'auto') { AUTO[0][1](); autoIdx = 1; } else setKind(scenario);

  return { step, trigger, setScenario, state, get kind() { return kind; } };
}

export function createDemoSource(opts = {}) {
  const engine = createDemoEngine(opts);
  let timer = null;
  return {
    id: 'demo',
    demo: true,
    start(onState, tickMs = 500) {
      const push = () => onState(engine.state());
      push();
      timer = setInterval(() => { engine.step(tickMs / 1000); push(); }, tickMs);
    },
    stop() { clearInterval(timer); },
    select(type) { engine.setScenario(type === 'practice' ? 'race' : type === 'quali' ? 'quali' : type === 'upcoming' ? 'upcoming' : 'race'); },
    trigger(ev) { engine.trigger(ev); },
  };
}
