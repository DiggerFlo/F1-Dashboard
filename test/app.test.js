import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoEngine } from '../js/sources/demo.js';
import { flagFromControl, latestBy } from '../js/sources/openf1.js';
import { fmtLap, fmtGap, fmtClock, sectorClass, esc, splitCountdown } from '../js/format.js';
import { readFileSync } from 'node:fs';
import { samplePath } from '../js/svgpath.js';
import { fitSimilarity } from '../js/fit.js';
import { findLayout, seasonsInclude } from '../js/circuits.js';
import { renderChrome, renderMain } from '../js/views.js';
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
