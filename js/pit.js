// Hilfsfunktionen für Sektor-Flaggen und Boxenstopps. Alle Funktionen sind rein (keine Zeit, kein Netz).

/** Teilstück von Anteil f0 bis f1 (0..1, mit Umlauf über die Ziellinie) einer geschlossenen Polylinie als Punktliste. */
export function arcPoints(points, f0, f1) {
  const n = points.length;
  const cum = [0];
  for (let i = 0; i < n; i++) { const a = points[i], b = points[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = cum[n];
  const at = (t) => {
    const u = ((t % total) + total) % total;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= u) lo = mid; else hi = mid - 1; }
    const a = points[lo], b = points[(lo + 1) % n];
    const seg = cum[lo + 1] - cum[lo];
    const k = seg ? (u - cum[lo]) / seg : 0;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const len = ((((f1 - f0) % 1) + 1) % 1 || 1) * total;
  const t0 = (((f0 % 1) + 1) % 1) * total;
  const out = [at(t0)];
  for (const lap of [0, total]) for (let j = 0; j < n; j++) { const t = cum[j] + lap; if (t > t0 && t < t0 + len) out.push(points[j]); }
  out.push(at(t0 + len));
  return out;
}

/** Sektorzustand aus den Race-Control-Meldungen (chronologisch) bis jetzt: [{ n, level: 'yellow' | 'double' }]. */
export function sectorFlagsFrom(msgs) {
  const m = new Map();
  for (const x of msgs) {
    const f = String(x.flag || '').toUpperCase();
    if (x.category !== 'Flag') continue;
    if (x.scope === 'Sector' && x.sector != null) {
      if (f === 'YELLOW') m.set(x.sector, 'yellow');
      else if (f === 'DOUBLE YELLOW') m.set(x.sector, 'double');
      else if (f === 'CLEAR' || f === 'GREEN') m.delete(x.sector);
    } else if ((f === 'GREEN' || f === 'CLEAR') && (x.scope === 'Track' || x.scope == null)) m.clear();
  }
  return [...m].map(([n, level]) => ({ n, level })).sort((a, b) => a.n - b.n);
}

/** Längste zusammenhängende Standzeit (Sekunden) mit Geschwindigkeit <= maxSpeed in [from, to] aus car_data-Zeilen { t, speed }. */
export function stationaryTime(rows, from, to, maxSpeed = 2) {
  let best = 0, start = null, last = null;
  for (const r of rows) {
    if (r.t < from || r.t > to) continue;
    if (r.speed <= maxSpeed) { if (start == null) start = r.t; last = r.t; }
    else { if (start != null) best = Math.max(best, last - start); start = null; }
  }
  if (start != null) best = Math.max(best, last - start);
  return best / 1000;
}
