// Überholmanöver aus zwei aufeinanderfolgenden Zuständen erkennen (quellenunabhängig).

const NEUTRAL = new Set(['sc', 'vsc', 'red', 'chequered']);

/**
 * @param prev, next Zustände ({ flag, session:{type}, drivers:[{num, code, pos, pit}] })
 * @returns [{ by, over, pos }] – by hat over überholt und liegt jetzt auf Position pos
 *
 * Ignoriert: andere Sessions als Rennen, Safety Car/VSC/Rot, Positionswechsel durch Boxenstopps
 * (einer der beiden ist in der Box oder war es im letzten Zustand) und unbekannte Positionen.
 */
export function detectOvertakes(prev, next) {
  if (!prev || !next) return [];
  if (next.session.type !== 'race' || prev.session.type !== 'race') return [];
  if (NEUTRAL.has(prev.flag) || NEUTRAL.has(next.flag)) return [];
  const before = new Map(prev.drivers.filter((d) => d.pos > 0 && d.pos < 99).map((d) => [d.num, d]));
  const out = [];
  for (const x of next.drivers) {
    const px = before.get(x.num);
    if (!px || !(x.pos < px.pos) || x.pos >= 99) continue;
    for (const y of next.drivers) {
      const py = before.get(y.num);
      if (!py || y.num === x.num) continue;
      const wasAhead = py.pos < px.pos, nowBehind = y.pos > x.pos;
      if (!wasAhead || !nowBehind || !(y.pos > py.pos)) continue; // y muss Plätze verloren haben
      if (x.pit || y.pit || px.pit || py.pit) continue;
      out.push({ by: x.code, over: y.code, pos: x.pos });
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}
