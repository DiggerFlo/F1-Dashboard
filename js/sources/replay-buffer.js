// Zwischenspeicher für die Wiederholung einer echten Session (OpenF1): Telemetrie und Positionen werden in
// Zeitfenstern geladen und im Speicher gehalten, die Wiedergabe fragt nur noch den Puffer ab (keine API-Aufrufe pro Takt).

const time = (r) => Date.parse(r.date);

/** Index des letzten Eintrags mit t <= x in einer nach t sortierten Liste, sonst -1. */
export function lastAtOrBefore(arr, x) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Zeilen ({date, driver_number, ...}) je Fahrer gruppieren, mit t in ms, nach Zeit sortiert. */
export function groupByDriver(rows) {
  const m = new Map();
  for (const r of rows) {
    const t = time(r);
    if (!isFinite(t)) continue;
    const a = m.get(r.driver_number);
    if (a) a.push({ ...r, t }); else m.set(r.driver_number, [{ ...r, t }]);
  }
  for (const a of m.values()) a.sort((x, y) => x.t - y.t);
  return m;
}

const latest = (byDriver, t) => {
  const out = new Map();
  for (const [n, arr] of byDriver) { const i = lastAtOrBefore(arr, t); if (i >= 0) out.set(n, arr[i]); }
  return out;
};

export function createReplayBuffer({ origin, windowMs = 4 * 60000, maxAge = 1.5 }) {
  const windows = new Map(); // Fensterstart -> { carData, location, intervals } (je Map: Fahrer -> Zeilen)
  let positions = new Map();

  const startOf = (t) => origin + Math.floor((t - origin) / windowMs) * windowMs;

  return {
    windowMs,
    startOf,
    has: (t) => windows.has(startOf(t)),
    /** Rohdaten eines Fensters ablegen. */
    add(start, { carData = [], location = [], intervals = [] }) {
      windows.set(start, { carData: groupByDriver(carData), location: groupByDriver(location), intervals: groupByDriver(intervals) });
    },
    setPositions(rows) { positions = groupByDriver(rows); },
    /** Telemetriezeilen { t, speed, ... } eines Fahrers in [from, to] aus den geladenen Fenstern; covered: alle betroffenen Fenster waren geladen. */
    carRows(num, from, to) {
      const rows = [];
      let covered = true;
      for (let st = startOf(from); st <= to; st += windowMs) {
        const w = windows.get(st);
        if (!w) { covered = false; continue; }
        for (const r of w.carData.get(num) || []) if (r.t >= from && r.t <= to) rows.push(r);
      }
      return { rows, covered };
    },
    /** Je Fahrer der Zeitpunkt, an dem er in [from, to] erstmals schneller als minSpeed fährt (nur aus geladenen Fenstern). */
    firstMoves(from, to, minSpeed = 3) {
      const out = [];
      for (const [start, w] of windows) {
        if (start > to || start + windowMs < from) continue;
        for (const arr of w.carData.values()) {
          const r = arr.find((x) => x.t >= from && x.t <= to && x.speed >= minSpeed);
          if (r) out.push(r.t);
        }
      }
      return out;
    },
    /** Zustand zum Zeitpunkt t: je Fahrer die letzten Messwerte (aus dem Fenster von t, sonst dem davor). */
    sample(t) {
      const out = { carData: new Map(), location: new Map(), intervals: new Map(), position: latest(positions, t) };
      for (const w of [windows.get(startOf(t) - windowMs), windows.get(startOf(t))]) {
        if (!w) continue; // das ältere zuerst, das aktuelle überschreibt
        for (const k of ['carData', 'location', 'intervals']) for (const [n, r] of latest(w[k], t)) out[k].set(n, r);
      }
      return out;
    },
    /** Fenster verwerfen, die mehr als maxAge Fensterlängen zurückliegen. */
    evict(t) { for (const s of windows.keys()) if (s < startOf(t) - windowMs * maxAge) windows.delete(s); },
    clear() { windows.clear(); },
    get size() { return windows.size; },
  };
}
