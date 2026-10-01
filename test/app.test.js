import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoEngine } from '../js/sources/demo.js';
import { flagFromControl, latestBy } from '../js/sources/openf1.js';
import { fmtLap, fmtGap, fmtClock, sectorClass, esc, splitCountdown } from '../js/format.js';
import { readFileSync } from 'node:fs';
import { samplePath } from '../js/svgpath.js';
import { fitSimilarity } from '../js/fit.js';
import { findLayout, seasonsInclude } from '../js/circuits.js';
import { buildOpenF1Calendar, buildDemoCalendar, yearsFor, raceStatus } from '../js/calendar.js';
import { detectOvertakes } from '../js/overtakes.js';
import { renderChrome, renderMain, renderCalendar } from '../js/views.js';
import { transcribe, audioUrl, enginesFor, _resetForTests } from '../js/transcribe.js';

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
    if (sc === 'race') { for (const f of ['sc', 'vsc', 'yellow', 'red']) { e.trigger(f); run(e, 2); const h = renderChrome(e.state(), { sel: 3, demo: true }) + renderMain(e.state(), { sel: 3, demo: true }, new Map(), null); assert.ok(h.includes('banner')); } }
    const st = e.state();
    const html = renderChrome(st, { sel: 3, demo: true }) + renderMain(st, { sel: 3, demo: true }, new Map(), null);
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

const DB = JSON.parse(readFileSync(new URL('../data/circuits.json', import.meta.url), 'utf8'));

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
  const html = renderCalendar({ year: 2025, demo: true, races: cal }, { year: 2025 }, DB);
  assert.equal((html.match(/class="race/g) || []).length, cal.length);
  assert.ok(html.includes('Nächstes Rennen') && html.includes('<polygon'));
  assert.ok(renderCalendar(null, { year: 2025 }, DB).includes('geladen'));
  assert.ok(renderCalendar({ year: 2025, races: [], error: 'x <b>' }, { year: 2025 }, DB).includes('x &lt;b&gt;'));
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
  assert.ok(renderMain(ps, { sel: 3 }, new Map(), null).includes('Trainingsergebnis'));
  const e = createDemoEngine({ scenario: 'race', seed: 5 });
  e.trigger('rain');
  assert.equal(e.state().weather.rain, true);
  assert.ok(e.state().feed.some((m) => m.tag === 'WETTER'));
  const tags = new Set();
  for (let i = 0; i < 4000; i++) { e.step(0.5); e.state().feed.slice(0, 3).forEach((m) => tags.add(m.tag)); }
  assert.ok(tags.has('BOX') && tags.has('SCHNELLSTE'), [...tags].join());
});
