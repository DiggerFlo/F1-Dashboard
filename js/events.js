// Rennereignisse (Überholung, Boxenstopp, Ausfall) als Einträge für die Ereignisliste.

/**
 * found: [{ by, over, pos }], stops: pitStops-Einträge, out: ausgefallene Fahrer, now: Zeit des Zustands (ms),
 * color: Map(Kürzel -> Teamfarbe). Gibt die Einträge neueste zuerst zurück, mit stabilen ids.
 */
export function eventsFrom({ found = [], stops = [], out = [], now, color = new Map() }) {
  const ov = found.map((o) => ({ id: `ov${now}${o.by}${o.over}`, kind: 'overtake', t: now, code: o.by, over: o.over, pos: o.pos, color: color.get(o.by) || null, overColor: color.get(o.over) || null }));
  const pit = stops.map((p) => ({ id: `pit${p.id}`, kind: 'pit', t: Math.min(p.at || now, now), code: p.code, color: p.color || null, lap: p.lap, stop: p.stop, lane: p.lane, tyre: p.tyre }));
  const dnf = out.map((d) => ({ id: `dnf${d.num}`, kind: 'dnf', t: now, code: d.code, color: d.color || null }));
  return [...dnf, ...pit, ...ov];
}
