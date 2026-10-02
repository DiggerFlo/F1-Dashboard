// Geplante Rundenzahl eines Rennens aus der Streckenlänge (OpenF1 nennt sie nicht): kleinste Zahl voller Runden, die mindestens
// die Renndistanz ergibt (305 km, Monaco 260 km, Sprint 100 km). Kürzt die Rennleitung das Rennen, weicht die echte Zahl ab.

/** Renndistanz in Metern: Rennen 305 km (Monaco 260 km), Sprint 100 km. */
export function raceDistance(kind, layoutId) {
  if (kind === 'sprint') return 100000;
  return /^monaco(-|$)/.test(String(layoutId || '')) ? 260000 : 305000;
}

/** Geplante Runden, oder null ohne Streckenlänge (len in Metern aus circuit-geo.json). */
export function plannedLaps(len, kind, layoutId) {
  return Number.isFinite(len) && len > 500 ? Math.ceil(raceDistance(kind, layoutId) / len) : null;
}
