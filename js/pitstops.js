// Boxenstopps aus zwei aufeinanderfolgenden Zuständen erkennen (quellenunabhängig) und für die Anzeige aufbereiten.

/** Sekunden als "2,4 s"; null -> "–". */
export const fmtSecs = (v) => (v == null || Number.isNaN(v) ? '–' : `${v.toFixed(1).replace('.', ',')} s`);

/** Neu abgeschlossene Stopps zwischen zwei Zuständen (state.pitStops, chronologisch). Bei Sprüngen (viele auf einmal) nichts. */
export function detectPitStops(prev, next) {
  if (!prev || !next || next.session.type !== 'race' || prev.session.type !== 'race') return [];
  const had = new Set((prev.pitStops || []).map((p) => p.id));
  const fresh = (next.pitStops || []).filter((p) => !had.has(p.id));
  return fresh.length > 0 && fresh.length <= 3 ? fresh : [];
}

/** Zeitverlust gegenüber einer Runde ohne Stopp ist nicht aus den Daten ableitbar; als Maßstab dient die Boxenverlustzeit der Strecke. */
export const pitLossNote = (pitLoss, sc) => {
  const v = pitLoss && Number(pitLoss[sc ? 'sc' : 'normal']);
  return v ? `Typischer Zeitverlust hier: ${fmtSecs(v)}` : '';
};

/** Fahrer, die zwischen zwei Zuständen neu als ausgefallen (status 'out') gelten. Bei Sprüngen (viele auf einmal) nichts. */
export function detectRetirements(prev, next) {
  if (!prev || !next || next.session.type !== 'race' || prev.session.type !== 'race') return [];
  const was = new Set(prev.drivers.filter((d) => d.status === 'out').map((d) => d.num));
  const fresh = next.drivers.filter((d) => d.status === 'out' && !was.has(d.num));
  return fresh.length > 0 && fresh.length <= 3 ? fresh : [];
}
