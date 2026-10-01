import { test } from 'vitest';
import assert from 'node:assert/strict';
import { sectorFlagsFrom, stationaryTime, arcPoints } from '../js/pit.js';
import { detectPitStops, fmtSecs } from '../js/pitstops.js';
import { lightsFor, isRaceLabel } from '../js/startlights.js';
import { detectRetirements } from '../js/pitstops.js';
import { createDemoEngine, createDemoSource } from '../js/sources/demo.js';
import { flagFromControl, overtakeFromControl, latestBy, mergeUpcoming, createOpenF1Client, createOpenF1Source } from '../js/sources/openf1.js';
import { createReplayBuffer, lastAtOrBefore } from '../js/sources/replay-buffer.js';
import { createReplayDemoSource } from '../js/sources/replay-demo.js';
import { mapDriverStandings, mapConstructorStandings, mapRaces, mapLastResult, buildJolpicaCalendar, createJolpica } from '../js/sources/jolpica.js';
import { fmtLap, fmtGap, fmtClock, sectorClass, esc, splitCountdown } from '../js/format.js';
import { readFileSync } from 'node:fs';
import { samplePath } from '../js/svgpath.js';
import { fitSimilarity } from '../js/fit.js';
import { findLayout, seasonsInclude } from '../js/circuits.js';
import { buildOpenF1Calendar, buildDemoCalendar, yearsFor, raceStatus } from '../js/calendar.js';
import { detectOvertakes } from '../js/overtakes.js';
import { createCarAnimator, nearestFraction, pointAt, trackSvg, aheadOf } from '../js/track.js';
import { safeColor } from '../js/format.js';
import { teamColor, tyreInfo } from '../js/teams.js';
import { peaksFromSamples, peaksFromText, pseudoPeaks, fmtDur, estimateSpeech, loadPeaks } from '../js/waveform.js';
import { Feed } from '../src/components/Feed.jsx';
import { renderToStaticMarkup } from 'react-dom/server';
import { Chrome } from '../src/components/Chrome.jsx';
import { Main } from '../src/components/Main.jsx';
import { Calendar } from '../src/components/Calendar.jsx';
import { transcribe, audioUrl, enginesFor, _resetForTests } from '../js/transcribe.js';

const html = (el) => renderToStaticMarkup(el);
const chrome = (state, ui) => html(<Chrome state={state} ui={ui} />);
const main = (state, ui) => html(<Main state={state} ui={ui} hist={new Map()} refHist={null} />);
const viewCal = (c, ui) => html(<Calendar cal={c} ui={ui} db={DB} />);

const run = (e, secs) => { for (let i = 0; i < secs * 2; i++) e.step(0.5); };

test('format helpers', () => {
  assert.equal(fmtLap(92.418), '1:32.418');
  assert.equal(fmtLap(null), '—');
  assert.equal(fmtGap(3.4), '+3.400');
  assert.equal(fmtClock(125), '02:05');
  assert.equal(sectorClass(30, 30, 29), 'g');
  assert.equal(sectorClass(29, 30, 29), 'p');
  assert.equal(sectorClass(31, 30, 29), 'y');
  assert.equal(esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  assert.deepEqual(splitCountdown(90061), { d: 1, h: 1, m: 1, s: 1 });
});

test('race: positions sorted, 20 drivers, telemetry present', () => {
  const e = createDemoEngine({ scenario: 'race', seed: 3 });
  run(e, 30);
  const s = e.state();
  assert.equal(s.session.type, 'race');
  assert.equal(s.drivers.length, 20);
  s.drivers.forEach((d, i) => assert.equal(d.pos, i + 1));
  assert.ok(s.drivers.every((d, i) => i === 0 || d.gap >= s.drivers[i - 1].gap - 1e-9));
  assert.ok(s.drivers[0].speed > 0);
});

test('safety car: flag, marker, slower field; green clears', () => {
  const e = createDemoEngine({ scenario: 'race', seed: 3 });
  run(e, 10);
  e.trigger('sc');
  run(e, 30);
  const s = e.state();
  assert.equal(s.flag, 'sc');
  assert.ok(s.safetyCar);
  assert.ok(s.drivers.every((d) => d.speed < 160), 'Safety-Car-Tempo');
  assert.ok(s.feed.some((m) => /SAFETY CAR/.test(m.text)));
  assert.ok(s.feed.some((m) => m.kind === 'radio' && m.speech && !m.text), 'Funk ohne Text, mit speech');
  assert.equal(new Set(s.feed.map((m) => m.id)).size, s.feed.length, 'eindeutige IDs');
  e.trigger('green');
  assert.equal(e.state().flag, 'green');
});

test('red flag stops all cars', () => {
  const e = createDemoEngine({ scenario: 'race', seed: 3 });
  run(e, 10);
  e.trigger('red');
  run(e, 10);
  const s = e.state();
  assert.equal(s.flag, 'red');
  assert.ok(s.drivers.every((d) => d.speed === 0));
});

test('quali: timer runs, best laps ranked', () => {
  const e = createDemoEngine({ scenario: 'quali', seed: 5 });
  run(e, 120);
  const s = e.state();
  assert.equal(s.session.type, 'quali');
  assert.ok(s.session.remaining < 900);
  const timed = s.drivers.filter((d) => d.best != null);
  assert.ok(timed.length > 3);
  timed.forEach((d, i) => i && assert.ok(d.best >= timed[i - 1].best));
});

test('upcoming has countdown and schedule', () => {
  const s = createDemoEngine({ scenario: 'upcoming' }).state();
  assert.equal(s.session.type, 'upcoming');
  assert.ok(s.upcoming.startsAt > s.now);
  assert.equal(s.upcoming.schedule.length, 5);
});

test('auto scenario cycles through safety car and red flag', () => {
  const e = createDemoEngine({ scenario: 'auto', seed: 2 });
  const seen = new Set();
  for (let i = 0; i < 500; i++) { e.step(0.5); const st = e.state(); seen.add(`${st.session.type}:${st.flag}`); }
  for (const k of ['race:green', 'race:sc', 'race:red', 'quali:green', 'upcoming:green']) assert.ok(seen.has(k), k);
});

test('every view renders without throwing and escapes content', () => {
  for (const sc of ['race', 'quali', 'upcoming']) {
    const e = createDemoEngine({ scenario: sc, seed: 4 });
    run(e, 20);
    if (sc === 'race') { for (const f of ['sc', 'vsc', 'yellow', 'red']) { e.trigger(f); run(e, 2); const h = chrome(e.state(), { sel: 3, demo: true, sim: true }) + main(e.state(), { sel: 3, demo: true, sim: true }); assert.ok(h.includes('banner')); } }
    const st = e.state();
    const html = chrome(st, { sel: 3, demo: true, sim: true }) + main(st, { sel: 3, demo: true, sim: true });
    assert.ok(html.length > 100);
  }
});

test('openf1 flag derivation', () => {
  const m = (category, flag, message, date, scope = 'Track') => ({ category, flag, message, date, scope });
  const msgs = [
    m('SafetyCar', null, 'SAFETY CAR DEPLOYED', '2025-01-01T10:00:00+00:00'),
    m('Flag', 'GREEN', 'GREEN LIGHT', '2025-01-01T10:05:00+00:00'),
    m('Flag', 'RED', 'RED FLAG', '2025-01-01T10:10:00+00:00'),
  ];
  assert.equal(flagFromControl(msgs.slice(0, 1)).flag, 'sc');
  assert.equal(flagFromControl(msgs.slice(0, 2)).flag, 'green');
  assert.equal(flagFromControl(msgs).flag, 'red');
  assert.equal(flagFromControl([...msgs, m('Other', null, 'GREEN LIGHT - PIT EXIT OPEN', '2025-01-01T10:20:00+00:00')]).flag, 'green');
  assert.equal(latestBy([{ driver_number: 1, v: 1 }, { driver_number: 1, v: 2 }]).get(1).v, 2);
});

test('transcribe: demo returns the spoken text', async () => {
  assert.equal(await transcribe('demo', { speech: 'Box, Box.' }, { delay: 0 }), 'Box, Box.');
  assert.deepEqual(enginesFor({ speech: 'x' }).map((e) => e.id), ['demo']);
  assert.deepEqual(enginesFor({ url: 'x' }).map((e) => e.id), ['local', 'openai']);
});

test('transcribe: audioUrl proxy template', () => {
  assert.equal(audioUrl('https://a/b.mp3'), 'https://a/b.mp3');
  assert.equal(audioUrl('https://a/b.mp3', 'https://p/?u={url}'), 'https://p/?u=https%3A%2F%2Fa%2Fb.mp3');
});

test('transcribe: openai posts audio with bearer key', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    return url.includes('openai.com') ? { ok: true, json: async () => ({ text: ' Box this lap. ' }) } : { ok: true, blob: async () => new Blob(['x']) };
  };
  const text = await transcribe('openai', { url: 'https://r/a.mp3' }, { fetchImpl, getKey: () => 'sk-test' });
  assert.equal(text, 'Box this lap.');
  assert.equal(calls[1][0], 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls[1][1].headers.Authorization, 'Bearer sk-test');
  await assert.rejects(transcribe('openai', { url: 'u' }, { fetchImpl, getKey: () => null }), /API-Key/);
});

test('transcribe: local uses the loaded pipeline, errors are readable', async () => {
  _resetForTests();
  const seen = [];
  const loader = async () => ({ pipeline: async () => async (u) => { seen.push(u); return { text: ' Push now. ' }; } });
  assert.equal(await transcribe('local', { url: 'https://r/a.mp3' }, { loader }), 'Push now.');
  assert.deepEqual(seen, ['https://r/a.mp3']);
  _resetForTests();
  await assert.rejects(transcribe('local', { url: 'u' }, { loader: async () => { throw new TypeError('Failed to fetch'); } }), /Netzwerk/);
  await assert.rejects(transcribe('openai', {}, {}), /kein Audio/);
});

const DB = JSON.parse(readFileSync(new URL('../public/data/circuits.json', import.meta.url), 'utf8'));

test('circuits: layouts found by OpenF1 names and season', () => {
  assert.equal(findLayout(DB, { circuit_short_name: 'Monza', location: 'Monza', year: 2025 }).id, 'monza-7');
  assert.equal(findLayout(DB, { circuit_short_name: 'Sakhir', location: 'Sakhir', year: 2025 }).id, 'bahrain-1');
  assert.equal(findLayout(DB, { circuit_short_name: 'Catalunya', year: 2022 }).id, 'catalunya-5');
  assert.equal(findLayout(DB, { circuit_short_name: 'Catalunya', year: 2025 }).id, 'catalunya-6');
  assert.equal(findLayout(DB, { circuit_short_name: 'Marina Bay', location: 'Singapore', year: 2018 }).id, 'marina-bay-3');
  assert.equal(findLayout(DB, { circuit_short_name: 'Nirgendwo', year: 2025 }), null);
  assert.ok(seasonsInclude('1958,1960-1962', 1961) && !seasonsInclude('1958,1960-1962', 1959));
});

test('svg path sampling gives closed, evenly spaced points', () => {
  const pts = samplePath(DB.monza.layouts.at(-1).d, 200);
  assert.equal(pts.length, 200);
  const gaps = pts.map((p, i) => Math.hypot(p[0] - pts[(i + 1) % 200][0], p[1] - pts[(i + 1) % 200][1]));
  assert.ok(Math.max(...gaps) < 3 * Math.min(...gaps.filter((g) => g > 0)) + 25);
  for (const c of Object.values(DB)) for (const l of c.layouts) assert.equal(samplePath(l.d, 50).length, 50, l.id);
});

test('fit: recovers rotation, mirror, scale and offset of a track outline', () => {
  const dst = samplePath(DB.spa ? DB.spa.layouts.at(-1).d : DB['spa-francorchamps'].layouts.at(-1).d, 240);
  const ang = (137 * Math.PI) / 180, k = 17;
  const rnd = (i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.6; // deterministisches Rauschen
  const all = dst.filter((_, i) => i % 2 === 0).map(([x, y], i) => {
    const mx = x, my = -y; // gespiegelt
    return [(mx * Math.cos(ang) - my * Math.sin(ang)) * k + 4000 + rnd(i), (mx * Math.sin(ang) + my * Math.cos(ang)) * k - 9000 + rnd(i + 7)];
  });
  const src = all.slice(40).concat(all.slice(0, 40)); // anderer Startpunkt
  const fit = fitSimilarity(src, dst);
  assert.ok(fit.error < 0.03, `Fehler ${fit.error}`);
  // Zuordnung: jeder abgebildete Punkt liegt auf dem Layout (< 4 Einheiten von 500)
  const maxd = Math.max(...src.map(([x, y]) => { const [a, b] = fit.map(x, y); return Math.min(...dst.map((q) => Math.hypot(a - q[0], b - q[1]))); }));
  assert.ok(maxd < 4, `max Abstand ${maxd}`);
  // Kein Layout einer anderen Strecke passt
  const wrong = fitSimilarity(src, samplePath(DB.monza.layouts.at(-1).d, 240));
  assert.ok(wrong.error > fit.error * 2, 'falsches Layout wird schlechter bewertet');
});

test('calendar: OpenF1 meetings/sessions -> rounds, status, next race', () => {
  const now = Date.parse('2025-06-10T12:00:00Z');
  const sess = (k, m, name, start, end) => ({ session_key: k, meeting_key: m, session_name: name, date_start: start, date_end: end, location: `Ort${m}`, country_name: 'Land', circuit_short_name: `C${m}`, year: 2025 });
  const sessions = [
    sess(3, 3, 'Race', '2025-07-06T13:00:00Z', '2025-07-06T15:00:00Z'),
    sess(1, 1, 'Race', '2025-03-16T04:00:00Z', '2025-03-16T06:00:00Z'),
    sess(2, 2, 'Race', '2025-06-01T13:00:00Z', '2025-06-01T15:00:00Z'),
    sess(9, 3, 'Qualifying', '2025-07-05T14:00:00Z', '2025-07-05T15:00:00Z'),
    sess(8, 0, 'Race', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z').constructor === Object ? sess(7, 4, 'Practice 1', '2025-03-01T00:00:00Z', '2025-03-01T01:00:00Z') : null,
  ];
  const meetings = [{ meeting_key: 1, meeting_name: 'Erster GP' }, { meeting_key: 2, meeting_name: 'Zweiter GP' }, { meeting_key: 3, meeting_name: 'Dritter GP' }];
  const cal = buildOpenF1Calendar(meetings, sessions, now);
  assert.deepEqual(cal.map((r) => [r.round, r.meeting, r.status, r.next]), [[1, 'Erster GP', 'done', false], [2, 'Zweiter GP', 'done', false], [3, 'Dritter GP', 'upcoming', true]]);
  assert.equal(raceStatus(10, 20, 15), 'live');
  assert.ok(yearsFor(Date.parse('2026-01-01')).join() === '2026,2025,2024,2023');
});

test('calendar: demo uses circuits of the season and renders cards', () => {
  const cal = buildDemoCalendar(DB, 2025, Date.parse('2025-06-10T12:00:00Z'));
  assert.ok(cal.length >= 20);
  assert.equal(cal.filter((r) => r.next).length, 1);
  assert.ok(!cal.some((r) => r.circuit === 'madring'), 'Madring fährt erst 2026');
  assert.ok(buildDemoCalendar(DB, 2026).some((r) => r.circuit === 'madring'));
  const html = viewCal({ year: 2025, demo: true, races: cal }, { year: 2025 }, DB);
  assert.equal((html.match(/data-race=/g) || []).length, cal.length);
  assert.ok(html.includes('Nächstes Rennen') && html.includes('<polygon'));
  assert.ok(viewCal(null, { year: 2025 }, DB).includes('geladen'));
  assert.ok(viewCal({ year: 2025, races: [], error: 'x <b>' }, { year: 2025 }, DB).includes('x &lt;b&gt;'));
});

const snap = (order, extra = {}) => ({ flag: 'green', session: { type: 'race' }, drivers: order.map((code, i) => ({ num: code.charCodeAt(0), code, pos: i + 1, pit: 0, ...(extra[code] || {}) })) });

test('overtakes: detects who passes whom', () => {
  assert.deepEqual(detectOvertakes(snap(['AAA', 'BBB', 'CCC']), snap(['BBB', 'AAA', 'CCC'])), [{ by: 'BBB', over: 'AAA', pos: 1 }]);
  // Auto gewinnt zwei Plätze: zwei Überholte
  const two = detectOvertakes(snap(['AAA', 'BBB', 'CCC']), snap(['CCC', 'AAA', 'BBB']));
  assert.deepEqual(two.map((o) => `${o.by}>${o.over}`).sort(), ['CCC>AAA', 'CCC>BBB']);
  assert.deepEqual(detectOvertakes(snap(['AAA', 'BBB']), snap(['AAA', 'BBB'])), []);
});

test('overtakes: ignores pit stops, safety car, other sessions', () => {
  const a = snap(['AAA', 'BBB', 'CCC']);
  assert.deepEqual(detectOvertakes(a, snap(['BBB', 'AAA', 'CCC'], { AAA: { pit: 5 } })), []);
  assert.deepEqual(detectOvertakes(snap(['AAA', 'BBB'], { AAA: { pit: 5 } }), snap(['BBB', 'AAA'])), []);
  assert.deepEqual(detectOvertakes(a, { ...snap(['BBB', 'AAA', 'CCC']), flag: 'sc' }), []);
  assert.deepEqual(detectOvertakes({ ...a, flag: 'red' }, snap(['BBB', 'AAA', 'CCC'])), []);
  assert.deepEqual(detectOvertakes({ ...a, session: { type: 'quali' } }, { ...snap(['BBB', 'AAA', 'CCC']), session: { type: 'quali' } }), []);
  assert.deepEqual(detectOvertakes(null, a), []);
  const unknown = snap(['AAA', 'BBB']); unknown.drivers[1].pos = 99;
  assert.deepEqual(detectOvertakes(snap(['AAA', 'BBB']), unknown), []);
});

test('demo race produces a plausible number of overtakes, none under safety car', () => {
  const e = createDemoEngine({ scenario: 'race', seed: 11 });
  let prev = e.state(), count = 0;
  for (let i = 0; i < 400; i++) { e.step(0.5); const s = e.state(); count += detectOvertakes(prev, s).length; prev = s; } // 200 s echt = 20 Minuten Rennzeit
  console.log('ÜBERHOLUNGEN', count);
  assert.ok(count >= 3 && count <= 120, `Überholungen: ${count}`);
  e.trigger('sc');
  let sc = 0;
  for (let i = 0; i < 100; i++) { e.step(0.5); const s = e.state(); sc += detectOvertakes(prev, s).length; prev = s; }
  assert.equal(sc, 0);
});

test('demo has practice scenario, weather event and race-control extras', () => {
  const p = createDemoEngine({ scenario: 'practice', seed: 2 });
  for (let i = 0; i < 200; i++) p.step(0.5);
  const ps = p.state();
  assert.equal(ps.session.type, 'practice');
  assert.ok(ps.session.remaining < 3600 && ps.drivers.some((d) => d.best != null));
  assert.ok(main(ps, { sel: 3 }).includes('Trainingsergebnis'));
  const e = createDemoEngine({ scenario: 'race', seed: 5 });
  e.trigger('rain');
  assert.equal(e.state().weather.rain, true);
  assert.ok(e.state().feed.some((m) => m.tag === 'WETTER'));
  const tags = new Set();
  for (let i = 0; i < 4000; i++) { e.step(0.5); e.state().feed.slice(0, 3).forEach((m) => tags.add(m.tag)); }
  assert.ok(tags.has('BOX') && tags.has('SCHNELLSTE'), [...tags].join());
});

const LOOP = samplePath(DB.monza.layouts.at(-1).d, 300);
const distToLoop = (p) => Math.min(...LOOP.map((q, i) => { const r = LOOP[(i + 1) % LOOP.length]; const dx = r[0] - q[0], dy = r[1] - q[1], l = dx * dx + dy * dy || 1; const k = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / l)); return Math.hypot(p[0] - q[0] - dx * k, p[1] - q[1] - dy * k); }));
const stateAt = (f, extra = {}) => { const [x, y] = pointAt(LOOP, f); return { track: { points: LOOP }, drivers: [{ num: 1, code: 'AAA', x, y, onTrack: true, ...extra }] }; };

test('nearestFraction inverts pointAt', () => {
  for (const f of [0.02, 0.3, 0.55, 0.97]) {
    const [x, y] = pointAt(LOOP, f);
    const g = nearestFraction(LOOP, x + 0.2, y - 0.2);
    assert.ok(Math.min(Math.abs(g - f), 1 - Math.abs(g - f)) < 0.01, `${f} -> ${g}`);
  }
});

test('animator: moves along the track between updates, also across the start line', () => {
  const a = createCarAnimator();
  a.update(stateAt(0.90), 0);
  a.update(stateAt(0.98), 500); // 8 % einer Runde in 500 ms
  for (const t of [500, 600, 750, 900, 1000]) {
    const p = a.sample(t).get(1);
    assert.ok(distToLoop(p) < 1.5, `liegt auf der Strecke bei t=${t}`);
  }
  const mid = a.sample(750).get(1);
  const [ex, ey] = pointAt(LOOP, 0.94);
  assert.ok(Math.hypot(mid[0] - ex, mid[1] - ey) < 3, 'Mitte entspricht Streckenmitte, nicht der Sehne');
  a.update(stateAt(0.04), 1000); // über Start/Ziel
  const wrap = a.sample(1250).get(1);
  const [wx, wy] = pointAt(LOOP, 0.01);
  assert.ok(Math.hypot(wrap[0] - wx, wrap[1] - wy) < 4, 'läuft über die Ziellinie statt rückwärts');
});

test('animator: snaps on big jumps, drops cars that leave, handles no track', () => {
  const a = createCarAnimator();
  a.update(stateAt(0.1), 0); a.update(stateAt(0.6), 500);
  const [sx, sy] = pointAt(LOOP, 0.6);
  const p = a.sample(500).get(1);
  assert.ok(Math.hypot(p[0] - sx, p[1] - sy) < 1, 'Sprung wird nicht überblendet');
  a.update({ track: { points: LOOP }, drivers: [] }, 1000);
  assert.equal(a.sample(1000).size, 0);
  a.update({ track: { points: [] }, drivers: [{ num: 1, x: 1, y: 1 }] }, 1500);
  assert.equal(a.sample(1500).size, 0);
});

test('safeColor only lets valid hex colors through', () => {
  assert.equal(safeColor('#FF7A1A'), '#ff7a1a');
  assert.equal(safeColor('e8112d'), '#e8112d');
  for (const bad of ['red', '#fff', 'url(javascript:alert(1))', '#12345g', '"><img>', null, undefined, 5]) assert.equal(safeColor(bad), null);
});

test('demo drivers have teams and colors that render safely', () => {
  const st = createDemoEngine({ scenario: 'race', seed: 1 }).state();
  assert.ok(st.drivers.every((d) => d.team && safeColor(d.color)));
  assert.equal(new Set(st.drivers.map((d) => d.color)).size, 10);
  const html = main({ ...st, drivers: st.drivers.map((d, i) => (i === 0 ? { ...d, color: 'red;background:url(x)' } : d)) }, { sel: 3 });
  assert.ok(!html.includes('url(x)'));
});

test('jolpica: maps standings, races and last result', () => {
  const st = { MRData: { StandingsTable: { StandingsLists: [{ DriverStandings: [{ position: '1', points: '423', wins: '7', Driver: { code: 'NOR', givenName: 'Lando', familyName: 'Norris' }, Constructors: [{ name: 'McLaren' }] }] }] } } };
  assert.deepEqual(mapDriverStandings(st), [{ pos: 1, code: 'NOR', name: 'Lando Norris', team: 'McLaren', points: 423, wins: 7 }]);
  assert.deepEqual(mapConstructorStandings({ MRData: { StandingsTable: { StandingsLists: [{ ConstructorStandings: [{ position: '1', points: '800', wins: '9', Constructor: { name: 'McLaren' } }] }] } } }), [{ pos: 1, team: 'McLaren', points: 800, wins: 9 }]);
  assert.deepEqual(mapDriverStandings({}), []);
  const races = { MRData: { RaceTable: { Races: [
    { season: '2025', round: '2', raceName: 'B-GP', date: '2025-03-23', time: '07:00:00Z', Circuit: { circuitId: 'shanghai', circuitName: 'Shanghai', Location: { locality: 'Shanghai', country: 'China' } }, Qualifying: { date: '2025-03-22', time: '07:00:00Z' } },
    { season: '2025', round: '1', raceName: 'A-GP', date: '2025-03-16', time: '04:00:00Z', Circuit: { circuitId: 'albert_park', circuitName: 'Albert Park', Location: { locality: 'Melbourne', country: 'Australia' } } },
  ] } } };
  const mapped = mapRaces(races);
  assert.equal(mapped[0].sessions.at(-1)[0], 'Rennen');
  assert.equal(mapped[0].sessions[0][0], 'Qualifying');
  const cal = buildJolpicaCalendar(mapped, [{ key: 77, start: Date.parse('2025-03-16T04:00:00Z') + 3600000, end: 0 }], Date.parse('2025-03-20T00:00:00Z'));
  assert.deepEqual(cal.map((r) => [r.round, r.meeting, r.status, r.key, r.next]), [[1, 'A-GP', 'done', 77, false], [2, 'B-GP', 'upcoming', null, true]]);
  assert.equal(mapLastResult({ MRData: { RaceTable: { Races: [{ raceName: 'X', round: '1', Results: [{ position: '1', Driver: { code: 'NOR' }, Constructor: { name: 'McLaren' }, Time: { time: '1:23:45.000' } }] }] } } }).podium[0].code, 'NOR');
  assert.equal(mapLastResult({}), null);
});

test('jolpica client caches responses and reports HTTP errors', async () => {
  let calls = 0;
  const j = createJolpica({ fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ MRData: {} }) }; } });
  await j.driverStandings(2025); await j.driverStandings(2025);
  assert.equal(calls, 1);
  const bad = createJolpica({ fetchImpl: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(bad.races(2025), /Jolpica 429/);
});

test('upcoming merges OpenF1 session with Jolpica weekend, standings and result', () => {
  const now = Date.parse('2025-03-10T00:00:00Z');
  const extras = { races: mapRaces({ MRData: { RaceTable: { Races: [{ season: '2025', round: '1', raceName: 'A-GP', date: '2025-03-16', time: '04:00:00Z', Circuit: { circuitId: 'albert_park', circuitName: 'Albert Park', Location: { locality: 'Melbourne', country: 'Australia' } }, FirstPractice: { date: '2025-03-14', time: '01:30:00Z' } }] } } }),
    drivers: [{ pos: 1, code: 'NOR', points: 1, wins: 0 }], constructors: [{ pos: 1, team: 'McLaren', points: 1, wins: 0 }], last: { name: 'Z', podium: [{ pos: 1, code: 'NOR', team: 'McLaren', time: '1:30:00.000' }] } };
  const near = mergeUpcoming({ startsAt: Date.parse('2025-03-14T01:30:00Z'), meeting: 'Melbourne', schedule: [] }, extras, now);
  assert.equal(near.schedule[0][0], 'Training 1');
  assert.equal(near.facts[0][1], '1 von 1');
  assert.equal(near.standings[0].code, 'NOR');
  assert.equal(near.constructors[0].team, 'McLaren');
  assert.equal(mergeUpcoming(null, extras, now).meeting, 'A-GP');
  const far = mergeUpcoming({ startsAt: Date.parse('2025-06-14T01:30:00Z'), meeting: 'X', schedule: [] }, extras, now);
  assert.equal(far.facts, undefined);
  assert.equal(mergeUpcoming(null, null, now), null);
  const html = main({ session: { type: 'upcoming' }, flag: 'green', now, drivers: [], track: null, upcoming: { ...near, startsAt: now + 1000 } }, {});
  assert.ok(html.includes('Konstrukteurswertung') && html.includes('Letztes Rennen'));
});

const distToLoopOf = (loop, p) => Math.min(...loop.map((q, i) => { const r = loop[(i + 1) % loop.length]; const dx = r[0] - q[0], dy = r[1] - q[1], l = dx * dx + dy * dy || 1; const k = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / l)); return Math.hypot(p[0] - q[0] - dx * k, p[1] - q[1] - dy * k); }));

test('demo: opening a calendar race loads that circuit, selecting a tab keeps it as default Monza only after reset', () => {
  const src = createDemoSource({ scenario: 'race' });
  let last = null;
  src.start((s) => { last = s; }, 10000);
  const monza = last.track.points;
  const race = buildDemoCalendar(DB, 2025).find((r) => r.circuit === 'spa-francorchamps');
  src.openRace(race, DB);
  assert.notEqual(last.track.points, monza);
  assert.ok(/Spa/i.test(last.session.circuit), last.session.circuit);
  assert.ok(last.drivers.every((d) => d.x == null || distToLoopOf(last.track.points, [d.x, d.y]) < 1));
  src.openRace(null, DB);
  assert.equal(last.track.points, monza);
  src.stop();
});

test('teams: real team colors by name, tyre colors by compound letter', () => {
  assert.equal(teamColor('McLaren'), '#ff8000');
  assert.equal(teamColor('Red Bull Racing'), '#3671c6');
  assert.equal(teamColor('Racing Bulls'), '#6692ff', 'Racing Bulls vor Red Bull');
  assert.equal(teamColor('RB F1 Team'), '#6692ff');
  assert.equal(teamColor('Kick Sauber'), '#52e252');
  assert.equal(teamColor('Unbekannt'), null);
  assert.equal(tyreInfo('SOFT').color, '#e8112d');
  assert.equal(tyreInfo('MEDIUM').name, 'Medium');
  assert.equal(tyreInfo('?'), null);
  const st = createDemoEngine({ scenario: 'race', seed: 1 }).state();
  assert.ok(st.drivers.some((d) => d.code === 'VER' && d.team === 'Red Bull Racing'));
  assert.ok(st.drivers.every((d) => teamColor(d.team) === d.color), 'Demo-Farben entsprechen den Teamfarben');
});

test('waveform: peaks from samples, text and seed are normalised and stable', () => {
  const samples = new Float32Array(4400).map((_, i) => (i > 2200 && i < 2600 ? 0.9 * Math.sin(i) : 0.05 * Math.sin(i)));
  const p = peaksFromSamples(samples, 44);
  assert.equal(p.length, 44);
  assert.ok(Math.max(...p) === 1 && Math.min(...p) >= 0.08);
  assert.ok(p[22] > p[2] * 3, 'laute Stelle ragt heraus');
  assert.equal(peaksFromSamples(new Float32Array(0), 10).length, 10);
  const t = peaksFromText('Reifen halten gut, aber hinten wird es langsam heiß.', 44);
  assert.equal(t.length, 44);
  assert.ok(Math.max(...t) <= 1 && Math.min(...t) >= 0.1);
  assert.deepEqual(t, peaksFromText('Reifen halten gut, aber hinten wird es langsam heiß.', 44));
  assert.deepEqual(pseudoPeaks('rd1', 20), pseudoPeaks('rd1', 20));
  assert.notDeepEqual(pseudoPeaks('rd1', 20), pseudoPeaks('rd2', 20));
  assert.equal(fmtDur(75.4), '1:15');
  assert.equal(fmtDur(null), '0:00');
  assert.ok(estimateSpeech('eins zwei drei vier fünf sechs sieben acht') > estimateSpeech('ja'));
});

test('waveform: loadPeaks decodes once, caches and reports HTTP errors', async () => {
  let fetched = 0;
  const fetchImpl = async () => { fetched++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
  const audioContext = { decodeAudioData: async () => ({ duration: 7, getChannelData: () => new Float32Array([0, 0.5, -1, 0.2]) }) };
  const a = await loadPeaks('http://x/a.mp3', 4, { fetchImpl, audioContext });
  const b = await loadPeaks('http://x/a.mp3', 4, { fetchImpl, audioContext });
  assert.equal(fetched, 1);
  assert.equal(a.duration, 7);
  assert.deepEqual(a.peaks, b.peaks);
  await assert.rejects(loadPeaks('http://x/bad.mp3', 4, { fetchImpl: async () => ({ ok: false, status: 403 }), audioContext }), /403/);
});

test('feed: radio messages render a player with team color, race control does not', () => {
  const drivers = [{ code: 'NOR', team: 'McLaren', color: '#ff8000' }];
  const items = [
    { id: 'rd1', kind: 'radio', t: 0, code: 'NOR', tag: 'TEAM', speech: 'Reifen halten gut.' },
    { id: 'rd2', kind: 'radio', t: 0, code: 'NOR', tag: 'FUNK', url: 'https://example.com/a.mp3' },
    { id: 'rc1', kind: 'rc', t: 0, tag: 'INFO', text: 'Gelb in Sektor 2' },
  ];
  const out = html(<Feed items={items} drivers={drivers} filter="all" sub="Live" />);
  assert.equal((out.match(/class="rp[ "]/g) || []).length, 2);
  assert.ok(out.includes('--team:#ff8000') && out.includes('McLaren') && out.includes('src="https://example.com/a.mp3"'));
  assert.ok(out.includes('Gelb in Sektor 2'));
  assert.equal((html(<Feed items={items} drivers={drivers} filter="rc" sub="Live" />).match(/class="rp[ "]/g) || []).length, 0);
});

test('openf1 client: spaces requests, retries on 429, treats 404 as empty, reports other errors', async () => {
  let t = 0;
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); t += ms; };
  const answers = [{ status: 200, body: [1] }, { status: 404 }, { status: 429, retryAfter: '2' }, { status: 200, body: [2] }, { status: 429 }, { status: 429 }, { status: 500 }];
  const urls = [];
  const fetchImpl = async (u) => { urls.push(u); const a = answers.shift(); return { ok: a.status === 200, status: a.status, headers: { get: () => a.retryAfter ?? null }, json: async () => a.body }; };
  const get = createOpenF1Client({ fetchImpl, sleep, now: () => t, minGap: 400 });
  assert.deepEqual(await get('a'), [1]);
  assert.deepEqual(await get('b'), []);
  assert.deepEqual(await get('c'), [2]);
  assert.ok(sleeps.includes(2000), 'Retry-After wird beachtet');
  assert.ok(sleeps.filter((ms) => ms > 0 && ms <= 400).length >= 1, 'Mindestabstand');
  await assert.rejects(get('d'), /OpenF1 500/);
  assert.equal(urls.length, 7);
  const always429 = createOpenF1Client({ fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => null } }), sleep, now: () => t, retries: 2 });
  await assert.rejects(always429('x'), /OpenF1 429/);
});

test('demo: real radio clips are used for random radio, bundled data covers every driver', () => {
  const data = JSON.parse(readFileSync(new URL('../public/data/radio.json', import.meta.url), 'utf8'));
  const codes = new Set(createDemoEngine({ scenario: 'race', seed: 1 }).state().drivers.map((d) => d.code));
  assert.ok(data.length >= 20 && [...codes].every((c) => data.some((x) => x.code === c)), 'Clip für jeden Fahrer');
  assert.ok(data.every((c) => /^https:\/\/livetiming\.formula1\.com\/.+\.mp3$/.test(c.url) && c.peaks.length === 44 && c.duration >= 3 && c.duration <= 30));
  const e = createDemoEngine({ scenario: 'race', seed: 5 });
  e.setClips(data);
  const seen = [];
  for (let i = 0; i < 3000; i++) { e.step(0.5); for (const m of e.state().feed) if (m.kind === 'radio' && !seen.some((s) => s.id === m.id)) seen.push(m); }
  const real = seen.filter((m) => m.url);
  assert.ok(real.length > 3, `echte Clips: ${real.length}`);
  assert.ok(real.every((m) => m.peaks.length === 44 && m.duration > 0 && data.some((c) => c.url === m.url && c.code === m.code)), 'Clip gehört zum Fahrer');
  const out = html(<Feed items={real.slice(0, 1)} drivers={e.state().drivers} filter="all" sub="Live" />);
  assert.ok(out.includes('Original-Funk') && out.includes(real[0].url));
});

test('replay buffer: windows, latest sample per driver, eviction', () => {
  const o = Date.parse('2026-01-01T12:00:00Z'), W = 60000;
  const row = (n, s, speed) => ({ driver_number: n, date: new Date(o + s * 1000).toISOString(), speed });
  const b = createReplayBuffer({ origin: o, windowMs: W });
  assert.equal(b.has(o + 10000), false);
  b.add(o, { carData: [row(1, 20, 200), row(1, 10, 100), row(2, 5, 50)], location: [], intervals: [] });
  assert.equal(b.has(o + 59000), true);
  assert.equal(b.has(o + 61000), false);
  const s = b.sample(o + 15000);
  assert.equal(s.carData.get(1).speed, 100, 'letzter Wert vor t, auch bei unsortierten Daten');
  assert.equal(s.carData.get(2).speed, 50);
  b.add(o + W, { carData: [row(1, 70, 300)], location: [], intervals: [] });
  assert.equal(b.sample(o + W + 1000).carData.get(1).speed, 200, 'ohne neuere Messung gilt der Wert aus dem Fenster davor');
  assert.equal(b.sample(o + W + 20000).carData.get(1).speed, 300);
  b.setPositions([{ driver_number: 1, date: new Date(o + 1000).toISOString(), position: 3 }, { driver_number: 1, date: new Date(o + 90000).toISOString(), position: 1 }]);
  assert.equal(b.sample(o + 30000).position.get(1).position, 3);
  assert.equal(b.sample(o + 100000).position.get(1).position, 1);
  b.add(o + 5 * W, { carData: [row(1, 310, 1)] });
  b.evict(o + 5 * W);
  assert.equal(b.has(o), false);
  assert.equal(b.has(o + 5 * W), true);
  assert.equal(lastAtOrBefore([], 5), -1);
  assert.equal(lastAtOrBefore([{ t: 1 }, { t: 3 }, { t: 7 }], 6), 1);
});

const fakeRace = () => {
  const now = Date.now();
  const start = Date.UTC(2025, 8, 21, 11); // fest in 2025: DRS-Ära (ab 2026 gilt der Overtake-Modus)
  const session = { session_key: 1, meeting_key: 1, session_name: 'Race', date_start: new Date(start).toISOString(), date_end: new Date(start + 2 * 3600000).toISOString(), circuit_short_name: 'Monza', location: 'Monza', country_name: 'Italy', year: new Date(start).getFullYear() };
  const t0 = start + 2 * 60000;
  const at = (s) => new Date(t0 + s * 1000).toISOString();
  const calls = [];
  const client = async (path) => {
    calls.push(path);
    const ep = path.split('?')[0];
    switch (ep) {
      case 'sessions': return path.includes('meeting_key') ? [] : [session];
      case 'drivers': return [{ driver_number: 1, name_acronym: 'NOR', last_name: 'Norris', team_name: 'McLaren', team_colour: 'FF8000' }, { driver_number: 16, name_acronym: 'LEC', last_name: 'Leclerc', team_name: 'Ferrari', team_colour: 'E8002D' }];
      case 'car_data': return [{ driver_number: 1, date: at(-5), speed: 280, throttle: 100, brake: 0, n_gear: 8, rpm: 11000, drs: 12 }, { driver_number: 16, date: at(-5), speed: 150, throttle: 20, brake: 80, n_gear: 3, rpm: 7000, drs: 0 }];
      case 'location': return [{ driver_number: 1, date: at(-5), x: 100, y: 200 }, { driver_number: 16, date: at(-5), x: 110, y: 210 }];
      case 'position': return [{ driver_number: 16, date: at(-60), position: 1 }, { driver_number: 1, date: at(-60), position: 2 }];
      case 'intervals': return [{ driver_number: 1, date: at(-5), gap_to_leader: 1.2, interval: 1.2 }];
      case 'race_control': return [{ date: at(-30), category: 'Flag', flag: 'GREEN', message: 'GREEN LIGHT', scope: 'Track' }, { date: at(3600), category: 'Flag', flag: 'RED', message: 'RED FLAG', scope: 'Track' }];
      case 'team_radio': return [{ driver_number: 1, date: at(-10), recording_url: 'https://livetiming.formula1.com/x/early.mp3' }, { driver_number: 1, date: at(5000), recording_url: 'https://livetiming.formula1.com/x/late.mp3' }];
      case 'weather': return [{ date: at(-100), air_temperature: 25.2, track_temperature: 40.1, rainfall: 0 }];
      default: return [];
    }
  };
  const jolpica = { races: async () => [], driverStandings: async () => [], constructorStandings: async () => [], lastResult: async () => null };
  return { client, jolpica, calls, session };
};
const waitFor = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await new Promise((r) => setTimeout(r, 25)); } throw new Error('Zeitüberschreitung'); };

test('replay source: plays a past race from bulk-loaded data without per-tick API calls', async () => {
  const { client, jolpica, calls } = fakeRace();
  const src = createOpenF1Source({ client, jolpica, replayOnly: true, speed: 1 });
  assert.equal(src.demo, true);
  const states = [];
  src.start((s) => states.push(s));
  await waitFor(() => states.some((s) => s.drivers.length && s.drivers[0].speed != null));
  const s = states.at(-1);
  assert.equal(s.session.type, 'race');
  assert.equal(s.session.phase, 'replay');
  assert.deepEqual(s.drivers.map((d) => d.code), ['LEC', 'NOR'], 'sortiert nach Position');
  assert.equal(s.drivers[1].speed, 280);
  assert.equal(s.drivers[1].drs, true);
  assert.equal(s.drivers[1].color, '#FF8000');
  assert.equal(s.drivers[1].gap, 1.2);
  assert.ok(s.replay && s.replay.speed === 1 && !s.replay.loading && s.replay.end > s.replay.start);
  assert.equal(s.weather.air, 25);
  assert.ok(s.feed.some((m) => m.url?.endsWith('early.mp3')) && !s.feed.some((m) => m.url?.endsWith('late.mp3')), 'Funk erst ab seinem Zeitpunkt');
  assert.equal(s.flag, 'green');
  await new Promise((r) => setTimeout(r, 700)); // das nächste Zeitfenster wird einmal vorgeladen
  const n = calls.length;
  assert.ok(calls.filter((c) => c.startsWith('car_data')).length <= 2, 'höchstens aktuelles und nächstes Fenster');
  await new Promise((r) => setTimeout(r, 1300)); // weitere Takte brauchen keine Anfragen
  assert.equal(calls.length, n, 'keine API-Aufrufe während der Wiedergabe');
  // Sprung: Zeit läuft nicht mehr zurück zum Eintrag, Rote Flagge aus der Zukunft erscheint erst dann
  src.pause(true); src.seek(0.99);
  await waitFor(() => states.at(-1).flag === 'red' && !states.at(-1).replay.loading);
  const t = states.at(-1).replay.t;
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(states.at(-1).replay.t, t, 'Pause hält die Uhr an');
  assert.equal(states.at(-1).replay.paused, true);
  src.stop();
});

test('replay demo falls back to the simulation when OpenF1 cannot be reached', async () => {
  const jolpica = { races: async () => [], driverStandings: async () => [], constructorStandings: async () => [], lastResult: async () => null };
  const src = createReplayDemoSource({ client: async () => { throw new Error('OpenF1 429'); }, jolpica, failAfter: 150 });
  const states = [];
  src.start((s) => states.push(s));
  await waitFor(() => src.sim && states.some((s) => s.drivers.length === 20), 3000);
  assert.ok(states.at(-1).problem.includes('simulierten'));
  assert.equal(src.demo, true);
  src.stop();
});

test('chrome: replay bar offers a race dropdown with replayable races only', () => {
  const st = createDemoEngine({ scenario: 'race', seed: 1 }).state();
  const replay = { start: 0, end: 7200000, t: 600000, speed: 2, paused: false, loading: false };
  const seasons = { 2026: [{ round: 1, meeting: 'Australian Grand Prix', key: 11, status: 'done' }, { round: 2, meeting: 'Zukunfts-GP', key: 12, status: 'upcoming' }, { round: 3, meeting: 'Ohne Daten GP', key: null, status: 'done' }], 2025: [{ round: 1, meeting: 'Altes Rennen', key: 5, status: 'done' }] };
  const out = html(<Chrome state={{ ...st, replay, session: { ...st.session, key: 11 } }} ui={{ sel: 3, demo: true, seasons }} />);
  assert.ok(out.includes('Rennen wählen') && out.includes('replaybar') && out.includes('1×') && out.includes('8×'));
  assert.ok(!out.includes('Demo-Ereignis'), 'Simulations-Knöpfe nur ohne Wiederholung');
});

test('openf1 client: stays within the per-minute budget instead of running into 429', async () => {
  let t = 0;
  const sleep = async (ms) => { t += ms; };
  const times = [];
  const fetchImpl = async () => { times.push(t); return { ok: true, status: 200, headers: { get: () => null }, json: async () => [] }; };
  const get = createOpenF1Client({ fetchImpl, sleep, now: () => t, minGap: 0, maxPerMinute: 3 });
  for (let i = 0; i < 7; i++) await get('x');
  assert.equal(times.length, 7);
  for (let i = 3; i < 7; i++) assert.ok(times[i] - times[i - 3] >= 60000, `Anfrage ${i} kommt erst nach 60 s Abstand zur drittletzten`);
});

test('start lights: one red light per second, all out at the start', () => {
  assert.equal(lightsFor(60).visible, false);
  assert.equal(lightsFor(5.5).lit, 0);
  assert.deepEqual([5, 4, 3, 2, 1].map((s) => lightsFor(s - 0.1).lit), [1, 2, 3, 4, 5]);
  assert.deepEqual(lightsFor(0.2), { visible: true, lit: 5, go: false });
  assert.deepEqual(lightsFor(0), { visible: true, lit: 0, go: true });
  assert.equal(lightsFor(-5).visible, false);
  assert.ok(isRaceLabel('Nächstes Rennen') && isRaceLabel('Race') && !isRaceLabel('Qualifying'));
});

test('demo race holds the field for the start lights, then lights out releases it', () => {
  const e = createDemoEngine({ scenario: 'race', startGrid: 6 });
  const p0 = e.state().drivers[0].prog;
  for (let i = 0; i < 10; i++) e.step(0.5); // 5 s: Ampel läuft, Feld steht
  assert.ok(e.state().startLights);
  assert.equal(e.state().drivers[0].prog, p0);
  for (let i = 0; i < 4; i++) e.step(0.5); // Start bei 6 s
  assert.ok(e.state().drivers[0].prog > p0);
  for (let i = 0; i < 12; i++) e.step(0.5);
  assert.equal(e.state().startLights, undefined);
  assert.equal(createDemoEngine({ scenario: 'race' }).state().startLights, undefined);
});

test('nearestFraction with a hint stays on its own road where two sections are close', () => {
  const NARROW = [[0, 0], [100, 0], [100, 4], [0, 4]]; // zwei Straßen nur 4 Einheiten auseinander
  const own = 50 / 208;                                // Mitte der unteren Geraden
  assert.ok(Math.abs(nearestFraction(NARROW, 50, 2.5) - (100 + 4 + 50) / 208) < 1e-6, 'ohne Hinweis springt es auf die obere Straße');
  assert.ok(Math.abs(nearestFraction(NARROW, 50, 2.5, own) - own) < 1e-6);
  assert.ok(Math.abs(nearestFraction(NARROW, 50, 20, own) - (100 + 4 + 50) / 208) < 1e-6, 'weit neben der Strecke: Fallback auf die ganze Strecke');
  const car = createCarAnimator();
  const st = (y) => ({ track: { points: NARROW }, drivers: [{ num: 1, x: 50, y }] });
  car.update(st(0.2), 0); car.update(st(2.5), 500); car.update(st(2.5), 1000);
  const [, y] = car.sample(1500).get(1);
  assert.ok(y < 0.5, `Auto bleibt auf der unteren Straße (y=${y})`);
});

test('car animator: new cars next to a known car stay on the same road, and a clearly wrong road is corrected', () => {
  const NARROW = [[0, 0], [100, 0], [100, 4], [0, 4]];
  const car = createCarAnimator();
  const st = (ds) => ({ track: { points: NARROW }, drivers: ds.map(([num, x, y]) => ({ num, x, y })) });
  car.update(st([[1, 50, 0.2], [2, 51, 2.5]]), 0); // Auto 2 ist näher an der oberen Straße, steht aber im Pulk von Auto 1
  assert.ok(car.sample(0).get(2)[1] < 0.5, 'Auto 2 übernimmt die Straße von Auto 1');
  car.update(st([[1, 52, 0.2], [2, 52, 3.5]]), 500);  // jetzt klar an der oberen Straße
  assert.ok(car.sample(5000).get(2)[1] > 3.5, 'klar falsche Straße wird korrigiert');
});

test('replay source: enters shortly before the real race start and exposes it for the start lights', async () => {
  const { client, jolpica, session } = fakeRace();
  const rs = Date.parse(session.date_start) + 5 * 60000; // Einführungsrunde zuerst, Lights out erst nach 5 min
  const withStart = async (path) => (path.startsWith('race_control') ? [{ date: new Date(rs).toISOString(), category: 'SessionStatus', flag: null, message: 'SESSION STARTED' }] : client(path));
  const src = createOpenF1Source({ client: withStart, jolpica, replayOnly: true, speed: 1 });
  const states = [];
  src.start((s) => states.push(s));
  await waitFor(() => states.some((s) => s.drivers.length && s.startLights));
  const s = states.at(-1);
  assert.equal(s.startLights.startsAt, rs);
  assert.ok(s.replay.t >= rs - 41000 && s.replay.t < rs - 30000, 'Einstieg ca. 40 s vor dem Start');
  src.stop();
});

// ---------- Boxengasse, Sektor-Flaggen, Ausfälle ----------
const BOX = [[0, 0], [2000, 0], [2000, 1000], [0, 1000]];
test('sector flags: only flagged marshal sectors are coloured, clear and green remove them', () => {
  const msg = (flag, sector, scope = 'Sector') => ({ category: 'Flag', flag, scope, sector });
  assert.deepEqual(sectorFlagsFrom([msg('YELLOW', 3), msg('DOUBLE YELLOW', 5), msg('YELLOW', 3), msg('CLEAR', 5)]), [{ n: 3, level: 'yellow' }]);
  assert.deepEqual(sectorFlagsFrom([msg('YELLOW', 3), msg('GREEN', null, 'Track')]), []);
  const state = (flags, flag = 'yellow') => ({ flag, session: { type: 'race' }, drivers: [], sectorFlags: flags, track: { points: BOX, marshal: [0, 0.25, 0.5, 0.75] } });
  const svg = trackSvg(state([{ n: 2, level: 'yellow' }]), null);
  assert.equal((svg.match(/data-flag=/g) || []).length, 1, 'nur Sektor 2');
  assert.ok(!svg.includes('<polygon points') || (svg.match(/stroke="#ffcc00"/g) || []).length === 1, 'nicht die ganze Strecke gelb');
  const legacy = trackSvg({ ...state(undefined), sectorFlags: undefined }, null);
  assert.ok(legacy.includes('<polygon') && (legacy.match(/stroke="#ffcc00"/g) || []).length >= 1, 'ohne Sektoren: wie bisher ganze Strecke');
  const arc = arcPoints(BOX, 0.25, 0.5).map((p) => p.map(Math.round));
  assert.deepEqual(arc, [[1500, 0], [2000, 0], [2000, 1000]], 'Teilstück der Strecke zwischen zwei Marshal-Sektoren');
});

test('cars in the pit are not drawn on the map, they come back on the track when they leave', () => {
  const car = createCarAnimator();
  const state = (pit) => ({ session: { type: 'race' }, flag: 'green', track: { points: BOX }, drivers: [{ num: 1, code: 'NOR', pos: 1, x: 900, y: 2, pit }, { num: 2, code: 'LEC', pos: 2, x: 1500, y: 2 }] });
  car.update(state(1), 0);
  assert.ok(!car.sample(0).has(1) && car.sample(0).has(2), 'Auto in der Box fehlt, das andere bleibt');
  assert.ok(!trackSvg(state(1), null, car.sample(0)).includes('data-car="1"'), 'auch nicht im SVG');
  car.update(state(0), 500);
  assert.ok(car.sample(500).has(1) && trackSvg(state(0), null, car.sample(500)).includes('data-car="1"'), 'nach der Boxengasse wieder da');
});

test('pit stops: new stops are detected once, jumps are ignored; timing helpers format German numbers', () => {
  const stop = (id) => ({ id, code: 'SAI', lap: 20, stop: 2.4, lane: 20.6 });
  const s = (n) => ({ session: { type: 'race' }, pitStops: Array.from({ length: n }, (_, i) => stop('s' + i)) });
  assert.deepEqual(detectPitStops(s(1), s(2)).map((p) => p.id), ['s1']);
  assert.deepEqual(detectPitStops(s(2), s(2)), []);
  assert.deepEqual(detectPitStops(s(0), s(9)), [], 'Sprung in der Wiederholung: keine Meldungsflut');
  assert.equal(fmtSecs(2.44), '2,4 s');
  assert.equal(fmtSecs(null), '–');
  assert.equal(stationaryTime([{ t: 0, speed: 80 }, { t: 1000, speed: 0 }, { t: 2000, speed: 0 }, { t: 3500, speed: 1 }, { t: 4000, speed: 70 }], 0, 5000), 2.5);
});

test('race view shows the pit stop table and DNF/STEHT badges', () => {
  const drivers = [{ num: 1, code: 'NOR', pos: 1, gap: 0, sectors: [null, null, null], sectorCls: ['', '', ''], x: 0, y: 0 }, { num: 2, code: 'STR', pos: 2, status: 'out', sectors: [null, null, null], sectorCls: ['', '', ''] }, { num: 3, code: 'ALO', pos: 3, status: 'stopped', sectors: [null, null, null], sectorCls: ['', '', ''] }];
  const html = main({ session: { type: 'race', name: 'Race', lap: 20 }, flag: 'green', now: Date.now(), drivers, track: null, pitLoss: { normal: '21.80', sc: '13.81', vsc: '15.77' },
    pitStops: [{ id: 'a', num: 1, code: 'NOR', lap: 20, lane: 20.6, stop: 2.4, tyre: 'H', color: '#FF8000' }, { id: 'b', num: 3, code: 'ALO', lap: 21, lane: 22.1, stop: null, tyre: 'M' }] }, {});
  assert.ok(html.includes('Boxenstopps') && html.includes('2,4 s') && html.includes('20,6 s'), 'Tabelle mit Standzeit und Boxengasse');
  assert.ok(html.includes('Typischer Zeitverlust hier: 21,8 s'), 'Referenz Boxenverlustzeit');
  assert.ok(html.includes('DNF') && html.includes('STEHT'), 'Status-Badges');
});

test('2026 overtake mode: release comes from race control, none before any message', () => {
  assert.equal(overtakeFromControl([]).open, null);
  const m = (message, min) => ({ message, date: new Date(Date.UTC(2026, 8, 26, 11, min)).toISOString() });
  assert.equal(overtakeFromControl([m('OVERTAKE DISABLED', 0), m('OVERTAKE ENABLED', 5)]).open, true);
  assert.equal(overtakeFromControl([m('OVERTAKE ENABLED', 5), m('OVERTAKE DISABLED', 58)]).open, false);
  assert.equal(overtakeFromControl([m('LAPPED CARS MAY NOW OVERTAKE THE SAFETY CAR: 77', 3)]).open, null);
});

test('driver photos: only https URLs from the official F1 media server are used', async () => {
  const { safePhoto } = await import('../js/format.js');
  assert.ok(safePhoto('https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LANNOR01_Lando_Norris/lannor01.png.transform/1col/image.png'));
  for (const bad of ['http://media.formula1.com/x.png', 'https://evil.example/x.png', 'javascript:alert(1)', 'https://media.formula1.com.evil.example/x.png', '', null, undefined]) assert.equal(safePhoto(bad), null, String(bad));
});

test('retired cars are hidden on the map and announced once', () => {
  const mk = (st) => ({ session: { type: 'race' }, flag: 'green', now: 0, track: { points: [[0, 0], [100, 0], [100, 100], [0, 100]] }, drivers: [{ num: 1, code: 'NOR', pos: 1, x: 10, y: 0 }, { num: 2, code: 'STR', pos: 2, x: 50, y: 0, status: st }] });
  const a = mk('stopped'), b = mk('out');
  assert.ok(trackSvg(a, null).includes('data-car="2"'), 'stehendes Auto bleibt sichtbar');
  assert.ok(!trackSvg(b, null).includes('data-car="2"'), 'ausgefallenes Auto ist ausgeblendet');
  assert.ok(trackSvg(b, null).includes('data-car="1"'));
  assert.deepEqual(detectRetirements(a, b).map((d) => d.code), ['STR']);
  assert.deepEqual(detectRetirements(b, b), []);
});

test('country flags: names from OpenF1, Jolpica and the demo all resolve, unknown ones do not', async () => {
  const { flagUrl, countryOf } = await import('../src/flags.js');
  for (const c of ['Azerbaijan', 'United States', 'USA', 'UK', 'United Kingdom', 'UAE', 'United Arab Emirates', 'Netherlands', 'Saudi Arabia', 'Monaco', 'Italy', 'Japan', 'Brazil', 'Qatar', 'Mexico', 'Austria', 'Hungary', 'Belgium', 'Singapore', 'Canada', 'Spain', 'Australia', 'China', 'Bahrain', ' united-states '])
    assert.ok(flagUrl(c), c);
  assert.equal(flagUrl('Atlantis'), null);
  assert.equal(flagUrl(''), null);
  assert.equal(flagUrl(undefined), null);
  assert.equal(countryOf('Baku · Azerbaijan'), 'Azerbaijan');
  assert.equal(countryOf('Monza'), 'Monza');
});

test('loading overlay names the target view and is an accessible status', async () => {
  const { LoadingOverlay } = await import('../src/components/Loader.jsx');
  const out = html(<LoadingOverlay label="Qualifying" />);
  assert.ok(out.includes('Qualifying wird geladen') && out.includes('bereitgemacht'));
  assert.ok(out.includes('role="status"') && out.includes('aria-live="polite"'));
  assert.ok(out.includes('lwheel') && out.includes('lcar'), 'Auto ist da');
});

test('feed: the radio filter shows every radio message, even when it is older than the newest 40 entries', async () => {
  const { Feed } = await import('../src/components/Feed.jsx');
  const rc = Array.from({ length: 45 }, (_, i) => ({ id: `rc${i}`, kind: 'rc', t: 1e12 - i * 1000, tag: 'INFO', text: `Meldung ${i}` }));
  const radio = { id: 'rd1', kind: 'radio', t: 1e12 - 99000, code: 'HAM', tag: 'FUNK', speech: 'Test' };
  const out = html(<Feed items={[...rc, radio]} drivers={[]} filter="radio" onFilter={() => {}} />);
  assert.ok(out.includes('HAM'), 'ältere Funknachricht ist sichtbar');
  assert.ok(!out.includes('Meldung 0'), 'Race Control ist gefiltert');
});

test('calendar: season bar has one segment per race and marks done and next', async () => {
  const { Calendar } = await import('../src/components/Calendar.jsx');
  const mk = (round, status, next = false) => ({ round, meeting: `GP ${round}`, location: 'X', country: 'Italy', circuit: `c${round}`, year: 2026, start: Date.UTC(2026, round, 1), end: Date.UTC(2026, round, 2), status, next });
  const cal = { year: 2026, races: [mk(1, 'done'), mk(2, 'done'), mk(3, 'upcoming', true), mk(4, 'upcoming')] };
  const out = html(<Calendar cal={cal} ui={{ year: 2026 }} db={null} />);
  assert.equal((out.match(/class="sseg /g) || []).length, 4);
  assert.equal((out.match(/sseg done/g) || []).length, 2);
  assert.ok(out.includes('sseg upcoming next') && out.includes('2 von 4 Rennen beendet') && out.includes('50 %'));
});

test('events: overtakes, pit stops and retirements become feed entries and respect the switches', async () => {
  const { eventsFrom } = await import('../js/events.js');
  const { Feed } = await import('../src/components/Feed.jsx');
  const color = new Map([['NOR', '#FF8000'], ['VER', '#3671C6']]);
  const ev = eventsFrom({ found: [{ by: 'NOR', over: 'VER', pos: 2 }], stops: [{ id: 'a', code: 'ALO', lap: 20, lane: 20.6, stop: 2.4, tyre: 'H', at: 500 }], out: [{ num: 3, code: 'STR' }], now: 1000, color });
  assert.deepEqual(ev.map((e) => e.kind).sort(), ['dnf', 'overtake', 'pit']);
  assert.ok(ev.every((e) => e.id && e.t <= 1000));
  const items = [...ev, { id: 'rc1', kind: 'rc', t: 900, tag: 'INFO', text: 'Meldung A' }, { id: 'rd1', kind: 'radio', t: 800, code: 'HAM', speech: 'x' }];
  const all = html(<Feed items={items} show={{}} drivers={[]} filter="all" onFilter={() => {}} />);
  assert.ok(all.includes('überholt') && all.includes('Boxenstopp') && all.includes('2,4 s') && all.includes('ausgefallen') && all.includes('Meldung A'));
  const off = html(<Feed items={items} show={{ overtake: false, pit: false, radio: false }} drivers={[]} filter="all" onFilter={() => {}} />);
  assert.ok(!off.includes('überholt') && !off.includes('Standzeit') && off.includes('ausgefallen') && off.includes('Meldung A') && !off.includes('HAM'), 'ausgeschaltete Arten fehlen unter Alle');
  const act = html(<Feed items={items} show={{ overtake: false }} drivers={[]} filter="actions" onFilter={() => {}} />);
  assert.ok(act.includes('überholt') && !act.includes('Meldung A'), 'Reiter Aktionen zeigt alle Aktionen, unabhängig von den Schaltern');
  assert.ok(all.includes('Ereignisse'));
});

test('race control messages get a German headline, a tone and driver chips; unknown and German texts stay intact', async () => {
  const { describeRc, sentence } = await import('../js/racecontrol.js');
  const d = (text, extra = {}) => describeRc({ text, ...extra });
  assert.deepEqual([d('DOUBLE YELLOW IN TRACK SECTOR 3').title, d('DOUBLE YELLOW IN TRACK SECTOR 3').tone], ['Doppelgelb · Sektor 3', 'yellow']);
  assert.equal(d('CLEAR IN TRACK SECTOR 3').tone, 'green');
  assert.equal(d('OVERTAKE DISABLED').title, 'Overtake gesperrt');
  assert.equal(d('RISK OF RAIN FOR THE F1 RACE IS 10 %').title, 'Regenrisiko 10 %');
  assert.equal(d('GREEN LIGHT - PIT EXIT OPEN').title, 'Boxenausfahrt offen');
  assert.equal(d('RECOVERY VEHICLE ON TRACK AT TURN 6').title, 'Bergungsfahrzeug · Kurve 6');
  const pen = d('FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 81 (PIA) - FALSE START - MOVING BEFORE SIGNAL');
  assert.equal(pen.title, 'Strafe für Frühstart');
  assert.deepEqual(pen.codes, ['PIA']);
  assert.ok(pen.detail.includes('(PIA)') && pen.detail.startsWith('5 second time penalty'));
  const inc = d('INCIDENT INVOLVING CAR 55 (SAI) NOTED - FAILING TO FOLLOW RACE DIRECTORS INSTRUCTIONS');
  assert.equal(inc.title, 'Vorfall notiert');
  assert.deepEqual(inc.codes, ['SAI']);
  assert.ok(inc.detail.startsWith('Incident involving car 55 (SAI) noted'));
  // Fallback: deutsche Demo-Meldung bleibt wie sie ist
  const de = d('Regen auf der Strecke. Reifenwahl beachten.', { tag: 'WETTER' });
  assert.deepEqual([de.title, de.tone], ['Regen auf der Strecke. Reifenwahl beachten.', 'blue']);
  assert.equal(sentence('Schon normal geschrieben.'), 'Schon normal geschrieben.');
  assert.equal(d('SOMETHING UNKNOWN HAPPENED').title, 'Something unknown happened');
});

test('safety car is placed just ahead of the leader on the track', () => {
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const sc = aheadOf(sq, 50, 0); // Führender mitten auf der unteren Geraden
  assert.ok(sc.x > 50 && sc.x < 60 && Math.abs(sc.y) < 1e-6, `SC liegt knapp dahinter in Fahrtrichtung (x=${sc.x})`);
  const wrap = aheadOf(sq, 0, 5); // kurz vor der Ziellinie: läuft über den Umlauf
  assert.ok(wrap.y < 5 && wrap.x < 5);
});

test('openf1 client: requests of an abandoned session are dropped without using the rate limit', async () => {
  let sent = 0;
  const get = createOpenF1Client({ fetchImpl: async () => { sent++; return { ok: true, json: async () => [1] }; }, minGap: 0, sleep: async () => {}, now: () => 0 });
  let gone = false;
  assert.deepEqual(await get('a', () => gone), [1]);
  gone = true;
  await assert.rejects(get('b', () => gone), /abgebrochen/);
  assert.equal(sent, 1, 'die abgebrochene Anfrage wurde nicht gesendet');
});
