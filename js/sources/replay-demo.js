// Demo mit echten Renndaten: Wiederholung einer beendeten Session aus OpenF1 (Telemetrie, Positionen, Funk, Race Control).
// Ist OpenF1 nicht erreichbar, springt die Demo auf die Simulation (demo.js) zurück.
import { createOpenF1Source } from './openf1.js';
import { createDemoSource } from './demo.js';
import { t } from '../i18n.js';

export function createReplayDemoSource({ failAfter = 30000, scenario = 'auto', speed = 2, ...opts } = {}) {
  const real = createOpenF1Source({ ...opts, speed, replayOnly: true });
  const sim = createDemoSource({ scenario });
  let active = real, timer = null, out = null, seen = false;

  function fallBack() {
    if (seen || active === sim) return;
    real.stop();
    active = sim;
    sim.start((s) => out({ ...s, problem: t('src.fallback') }));
  }

  return {
    id: 'replay-demo',
    demo: true,
    get sim() { return active === sim; },
    start(cb) {
      out = cb;
      real.start((s) => {
        if (s.drivers.length || (s.session.type === 'upcoming' && !s.problem)) { seen = true; clearTimeout(timer); }
        cb(s);
      });
      timer = setTimeout(fallBack, failAfter);
    },
    stop() { clearTimeout(timer); real.stop(); sim.stop(); },
    select: (t) => active.select(t),
    openRace: (race, db) => active.openRace(race, db),
    calendar: (year, db) => active.calendar(year, db),
    trigger: (ev) => active.trigger(ev),
    setSpeed: (v) => active.setSpeed?.(v),
    pause: (f) => active.pause?.(f),
    seek: (f) => active.seek?.(f),
  };
}
