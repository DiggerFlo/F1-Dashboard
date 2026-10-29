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

// ---------- Ganze Session in Spaltenform ----------
// Eine komplette Session hat bei Telemetrie und Positionen einige hunderttausend Zeilen. Als Objekte wären das über 50 MB;
// je Fahrer in Float64Array (Zeit) und Float32Array (Werte) sind es rund ein Drittel, und die Suche nach "letzter Wert bis t" bleibt binär.

export const CAR_FIELDS = ['speed', 'throttle', 'brake', 'n_gear', 'rpm', 'drs'];
export const LOC_FIELDS = ['x', 'y'];
export const IV_FIELDS = ['gap_to_leader', 'interval'];

const num = (v) => (typeof v === 'number' ? v : NaN); // Text wie "+1 LAP" wird zu NaN und später zu null

/** Rohzeilen -> Map(Fahrer -> { t: Float64Array, <Feld>: Float32Array (oder Type), ... }), nach Zeit sortiert. Abstände brauchen Float64 (Sekundenbruchteile). */
export function toColumns(rows, fields, Type = Float32Array) {
  const per = new Map();
  for (const r of rows) {
    const t = time(r);
    if (!isFinite(t)) continue;
    const a = per.get(r.driver_number);
    if (a) a.push(r, t); else per.set(r.driver_number, [r, t]);
  }
  const out = new Map();
  for (const [n, flat] of per) {
    const len = flat.length / 2;
    const idx = Array.from({ length: len }, (_, i) => i);
    let sorted = true;
    for (let i = 1; i < len; i++) if (flat[2 * i + 1] < flat[2 * i - 1]) { sorted = false; break; }
    if (!sorted) idx.sort((a, b) => flat[2 * a + 1] - flat[2 * b + 1]);
    const c = { t: new Float64Array(len) };
    for (const f of fields) c[f] = new Type(len);
    idx.forEach((src, i) => { c.t[i] = flat[2 * src + 1]; for (const f of fields) c[f][i] = num(flat[2 * src][f]); });
    out.set(n, c);
  }
  return out;
}

/** Letzter Index mit t <= x in einem sortierten Float64Array, sonst -1. */
export function indexAtOrBefore(t, x) {
  let lo = 0, hi = t.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (t[mid] <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

const rowAt = (c, i, fields, n, t = c.t[i], mixed = null) => {
  const r = { driver_number: n, t };
  const j = mixed && i + 1 < c.t.length && t > c.t[i] && c.t[i + 1] - c.t[i] <= MAX_GAP ? i + 1 : -1;
  const k = j >= 0 ? (t - c.t[i]) / (c.t[j] - c.t[i]) : 0;
  for (const f of fields) {
    const v = c[f][i];
    r[f] = Number.isNaN(v) ? null : j >= 0 && mixed.includes(f) && !Number.isNaN(c[f][j]) ? v + (c[f][j] - v) * k : v;
  }
  return r;
};

/** Spalten für den Browser-Cache: Typed Arrays -> normale Arrays (JSON) und zurück. */
export const columnsToJSON = (cols, fields) => Object.fromEntries([...cols].map(([n, c]) => [n, { t: Array.from(c.t), ...Object.fromEntries(fields.map((f) => [f, Array.from(c[f], (v) => (Number.isNaN(v) ? null : v))])) }]));
export const columnsFromJSON = (obj, fields, Type = Float32Array) => new Map(Object.entries(obj).map(([n, c]) => [Number(n), { t: Float64Array.from(c.t), ...Object.fromEntries(fields.map((f) => [f, Type.from(c[f], (v) => (v == null ? NaN : v))])) }]));

// Zwischen zwei Messungen wird linear überblendet (Geschwindigkeit, Gas, Bremse, Drehzahl, Position), damit der Wert zum Zeitpunkt t stimmt
// und nicht der Messwert von bis zu einer Messung früher gilt. Gang und DRS bleiben beim letzten Wert. Über Lücken hinweg wird nicht überblendet.
const INTERP = { carData: ['speed', 'throttle', 'brake', 'rpm'], location: ['x', 'y'] };
const MAX_GAP = 1500; // ms

const mix = (a, b, k) => (typeof a === 'number' && typeof b === 'number' ? a + (b - a) * k : a);

/** Zeile zum Zeitpunkt t aus einer sortierten Liste, zwischen Vorgänger und Nachfolger überblendet. */
function interpRow(arr, t, fields) {
  const i = lastAtOrBefore(arr, t);
  if (i < 0) return undefined;
  const a = arr[i], b = arr[i + 1];
  if (!fields || !b || t <= a.t || b.t - a.t > MAX_GAP) return a;
  const k = (t - a.t) / (b.t - a.t);
  const r = { ...a, t };
  for (const f of fields) r[f] = mix(a[f], b[f], k);
  return r;
}

const latest = (byDriver, t, fields) => {
  const out = new Map();
  for (const [n, arr] of byDriver) { const r = interpRow(arr, t, fields); if (r) out.set(n, r); }
  return out;
};

export function createReplayBuffer({ origin, windowMs = 4 * 60000, maxAge = 1.5 }) {
  const windows = new Map(); // Fensterstart -> { carData, location, intervals } (je Map: Fahrer -> Zeilen)
  let positions = new Map();
  // Ganze Session je Datenstrom (Spaltenform); solange ein Strom hier fehlt, kommt er aus den Zeitfenstern
  const bulk = { carData: null, location: null, intervals: null };
  const FIELDS = { carData: CAR_FIELDS, location: LOC_FIELDS, intervals: IV_FIELDS };
  const STALE = { carData: 60000, location: 60000, intervals: Infinity }; // älter als das gilt ein Wert nicht mehr als aktuell
  const bulkLatest = (kind, t) => {
    const out = new Map();
    for (const [n, c] of bulk[kind]) { const i = indexAtOrBefore(c.t, t); if (i >= 0 && t - c.t[i] <= STALE[kind]) out.set(n, rowAt(c, i, FIELDS[kind], n, t, INTERP[kind])); }
    return out;
  };

  const startOf = (t) => origin + Math.floor((t - origin) / windowMs) * windowMs;

  return {
    windowMs,
    startOf,
    has: (t) => Boolean(bulk.carData && bulk.location) || windows.has(startOf(t)),
    /** Eine ganze Session für einen Datenstrom ('carData' | 'location' | 'intervals') ablegen. */
    setBulk(kind, cols) { bulk[kind] = cols; if (bulk.carData && bulk.location) windows.clear(); },
    hasBulk: (kind) => bulk[kind] != null,
    /** Rohdaten eines Fensters ablegen. */
    add(start, { carData = [], location = [], intervals = [] }) {
      windows.set(start, { carData: groupByDriver(carData), location: groupByDriver(location), intervals: groupByDriver(intervals) });
    },
    setPositions(rows) { positions = groupByDriver(rows); },
    /** Telemetriezeilen { t, speed, ... } eines Fahrers in [from, to] aus den geladenen Fenstern; covered: alle betroffenen Fenster waren geladen. */
    carRows(num, from, to) {
      if (bulk.carData) {
        const c = bulk.carData.get(num), rows = [];
        if (c) for (let i = Math.max(0, indexAtOrBefore(c.t, from - 1) + 1); i < c.t.length && c.t[i] <= to; i++) rows.push(rowAt(c, i, CAR_FIELDS, num));
        return { rows, covered: true };
      }
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
      if (bulk.carData) {
        for (const c of bulk.carData.values()) {
          for (let i = Math.max(0, indexAtOrBefore(c.t, from - 1) + 1); i < c.t.length && c.t[i] <= to; i++) if (c.speed[i] >= minSpeed) { out.push(c.t[i]); break; }
        }
        return out;
      }
      for (const [start, w] of windows) {
        if (start > to || start + windowMs < from) continue;
        for (const arr of w.carData.values()) {
          const r = arr.find((x) => x.t >= from && x.t <= to && x.speed >= minSpeed);
          if (r) out.push(r.t);
        }
      }
      return out;
    },
    /**
     * Hat sich der Fahrer in [from, to] mit mindestens minSpeed bewegt? null, wenn der Zeitraum nicht vollständig geladen ist oder es keine Daten zum Fahrer gibt.
     */
    moved(driver, from, to, minSpeed = 3) {
      if (bulk.carData) {
        const c = bulk.carData.get(driver);
        if (!c) return null;
        let any = false;
        for (let i = Math.max(0, indexAtOrBefore(c.t, from - 1) + 1); i < c.t.length && c.t[i] <= to; i++) { any = true; if (c.speed[i] >= minSpeed) return true; }
        return any ? false : null;
      }
      for (let w = startOf(from); w <= to; w += windowMs) if (!windows.has(w)) return null;
      let any = false;
      for (const [start, w] of windows) {
        if (start > to || start + windowMs < from) continue;
        const arr = w.carData.get(driver);
        if (!arr) continue;
        any = true;
        if (arr.some((x) => x.t >= from && x.t <= to && x.speed >= minSpeed)) return true;
      }
      return any ? false : null;
    },
    /** Zustand zum Zeitpunkt t: je Fahrer die letzten Messwerte (aus dem Fenster von t, sonst dem davor). */
    sample(t) {
      const out = { carData: new Map(), location: new Map(), intervals: new Map(), position: latest(positions, t) };
      for (const w of [windows.get(startOf(t) - windowMs), windows.get(startOf(t))]) {
        if (!w) continue; // das ältere zuerst, das aktuelle überschreibt
        for (const k of ['carData', 'location', 'intervals']) if (!bulk[k]) for (const [n, r] of latest(w[k], t, INTERP[k])) out[k].set(n, r);
      }
      for (const k of ['carData', 'location', 'intervals']) if (bulk[k]) out[k] = bulkLatest(k, t);
      return out;
    },
    /** Fenster verwerfen, die mehr als maxAge Fensterlängen zurückliegen. */
    evict(t) { for (const s of windows.keys()) if (s < startOf(t) - windowMs * maxAge) windows.delete(s); },
    clear() { windows.clear(); bulk.carData = bulk.location = bulk.intervals = null; },
    get size() { return windows.size; },
  };
}
