// Reifen-Auswertung je Fahrer: Stints (Länge, Alter) und Reifenabbau pro Runde aus den Rundenzeiten.
// Quellenunabhängig: Demo und OpenF1 liefern Runden und Stints, die Auswertung ist dieselbe.

export const FUEL_GAIN = 0.05; // s pro Runde, die das Auto durch den Spritverbrauch schneller wird (Näherung, wird aus dem Abbau herausgerechnet)
export const MIN_LAPS = 4;     // so viele saubere Runden braucht ein Stint für eine Abbau-Angabe
export const SLOW_FACTOR = 1.07; // Runden langsamer als 107 % des Stint-Medians gelten als Ausreißer (Verkehr, Fehler)

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

/** Steigung der Ausgleichsgeraden y = a + b·x (kleinste Quadrate). */
export function slope(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p[0], 0) / n, my = points.reduce((s, p) => s + p[1], 0) / n;
  let num = 0, den = 0;
  for (const [x, y] of points) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den ? num / den : null;
}

/**
 * Zeiträume [von, bis] (ms), in denen die Strecke neutralisiert war (Safety Car, VSC, rote Flagge), aus den Race-Control-Meldungen.
 * Runden in diesen Zeiträumen sagen nichts über den Reifen.
 */
export function neutralWindows(msgs, endMs = Infinity) {
  const out = [];
  let from = null;
  const stop = (t) => { if (from != null) { out.push([from, t]); from = null; } };
  for (const m of msgs) {
    const text = String(m.message || '').toUpperCase();
    const t = Date.parse(m.date);
    const flag = String(m.flag || '').toUpperCase();
    if (m.category === 'SafetyCar' && text.includes('DEPLOYED')) { if (from == null) from = t; }
    else if (m.category === 'SafetyCar' && text.includes('ENDING') && text.includes('VIRTUAL')) stop(t);
    else if (m.category === 'Flag' && flag === 'RED') { if (from == null) from = t; }
    else if (m.category === 'Flag' && (flag === 'GREEN' || flag === 'CLEAR') && (m.scope === 'Track' || m.scope == null)) stop(t);
    else if (text.includes('PIT EXIT OPEN')) stop(t);
  }
  if (from != null) out.push([from, endMs]);
  return out;
}

/**
 * @param laps   abgeschlossene Runden des Fahrers: [{ lap, time (s), start (ms) }]
 * @param stints [{ n, compound, from (erste Runde), to (letzte Runde oder null = läuft noch), ageAtStart }]
 * @param opts   { windows: neutralisierte Zeiträume, race: Spritgewicht herausrechnen, fuel }
 * @returns { stints: [...], cur } – je Stint: Länge, Alter, Rundenzeiten mit Markierung (ok/Grund), Abbau (s pro Runde, null wenn zu wenig saubere Runden)
 */
export function analyzeTyres(laps, stints, { windows = [], race = true, fuel = FUEL_GAIN } = {}) {
  const byLap = new Map(laps.map((l) => [l.lap, l]));
  const sorted = [...stints].sort((a, b) => a.n - b.n);
  const done = laps.length ? Math.max(...laps.map((l) => l.lap)) : 0;
  const out = sorted.map((s, i) => {
    const next = sorted[i + 1];
    const to = s.to ?? (next ? next.from - 1 : null);
    const last = to != null ? Math.min(to, done) : done;
    const rows = [];
    for (let lap = s.from; lap <= last; lap++) {
      const l = byLap.get(lap);
      if (!l) continue;
      let why = null;
      if (lap === 1) why = 'start';
      else if (lap === s.from && i > 0) why = 'out';
      else if (next && lap === to) why = 'in';
      else if (windows.some(([a, b]) => l.start < b && l.start + l.time * 1000 > a)) why = 'neutral';
      rows.push({ lap, n: lap - s.from + 1, t: l.time, why, ok: why == null });
    }
    const med = median(rows.filter((r) => r.ok).map((r) => r.t));
    if (med != null) for (const r of rows) if (r.ok && r.t > med * SLOW_FACTOR) { r.ok = false; r.why = 'slow'; }
    const good = rows.filter((r) => r.ok);
    const sl = good.length >= MIN_LAPS ? slope(good.map((r) => [r.n, r.t])) : null;
    const length = Math.max(0, last - s.from + 1);
    return {
      n: s.n, compound: s.compound, from: s.from, to, current: !next, length, ageAtStart: s.ageAtStart || 0, age: (s.ageAtStart || 0) + length,
      times: rows, deg: sl == null ? null : sl + (race ? fuel : 0), best: good.length ? Math.min(...good.map((r) => r.t)) : null, avg: good.length ? good.reduce((a, r) => a + r.t, 0) / good.length : null,
    };
  });
  return { stints: out, cur: out.at(-1) || null };
}
