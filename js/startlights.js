/** Startampel: fünf Lichter, je eine Sekunde, alle aus beim Start. */
export const LIGHTS = 5;
const SHOW_BEFORE = LIGHTS + 1; // Sekunden vor dem Start, ab denen die Ampel erscheint
const SHOW_AFTER = 4;           // Sekunden nach dem Start, die sie dunkel stehen bleibt

/** Race-Session erkennen (Demo: „Nächstes Rennen“, OpenF1: „Race“/„Sprint“). */
export const isRaceLabel = (label) => /rennen|race|sprint/i.test(label || '');

/**
 * Ampelzustand für die Restzeit bis zum Start in Sekunden.
 * lit: Anzahl roter Lichter, visible: Ampel zeigen, go: Start ist erfolgt (alle aus).
 */
export function lightsFor(secs) {
  if (secs == null || Number.isNaN(secs) || secs > SHOW_BEFORE || secs < -SHOW_AFTER) return { visible: false, lit: 0, go: false };
  if (secs <= 0) return { visible: true, lit: 0, go: true };
  return { visible: true, lit: Math.max(0, Math.min(LIGHTS, Math.floor(SHOW_BEFORE - secs))), go: false };
}
