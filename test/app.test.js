import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoEngine } from '../js/sources/demo.js';
import { flagFromControl, latestBy } from '../js/sources/openf1.js';
import { fmtLap, fmtGap, fmtClock, sectorClass, esc, splitCountdown } from '../js/format.js';
import { renderApp } from '../js/views.js';

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
    if (sc === 'race') { for (const f of ['sc', 'vsc', 'yellow', 'red']) { e.trigger(f); run(e, 2); const h = renderApp(e.state(), { sel: 3, demo: true }, new Map(), null); assert.ok(h.includes('banner')); } }
    const st = e.state();
    st.feed.unshift({ kind: 'rc', t: 0, text: '<img src=x onerror=alert(1)>' });
    const html = renderApp(st, { sel: 3, demo: true }, new Map(), null);
    assert.ok(!html.includes('<img src=x'));
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
