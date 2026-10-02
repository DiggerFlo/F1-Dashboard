// Läuft gerade eine echte F1-Session? OpenF1 sperrt dann den Zugriff für alle ohne Zugangsschlüssel (auch auf Wiederholungen).
// Der Browser meldet die Sperre nur als Netzwerk-/CORS-Fehler, deshalb schließen wir aus dem Rennkalender (Jolpica) darauf.
import { sessionId } from './sessions.js';

// Übliche Dauer in Minuten; dazu 5 min Vorlauf und 20 min Nachlauf, in denen OpenF1 die Session noch als laufend führt
const MINUTES = { fp1: 60, fp2: 60, fp3: 60, sprintq: 45, sprint: 45, quali: 60, race: 120 };
const BEFORE = 5, AFTER = 20;

/** Geplante Dauer einer Session in Minuten (Schätzung nach Art der Session). */
export const plannedMinutes = (name) => MINUTES[sessionId(name)] ?? 60;

/**
 * Fokus der Vorschau aus dem Zeitplan [[name, ms], ...]: die laufende Session (live: true) oder die nächste.
 * Liefert Felder, die in die Vorschau gemischt werden: nextLabel, startsAt, live. Leer, wenn der Plan keine Zeitpunkte enthält.
 */
export function focusSession(schedule, now = Date.now()) {
  const list = (schedule || []).filter(([, ts]) => typeof ts === 'number').sort((a, b) => a[1] - b[1]);
  const running = list.find(([n, ts]) => now >= ts && now <= ts + (plannedMinutes(n) + AFTER) * 60000);
  if (running) return { nextLabel: running[0], startsAt: running[1], live: true };
  const next = list.find(([, ts]) => ts > now);
  return next ? { nextLabel: next[0], startsAt: next[1], live: false } : {};
}

/** Die Session des Wochenendes, die jetzt läuft: { name, meeting } oder null. races: Einträge mit sessions [[name, ms], ...]. */
export function liveSessionNow(races, now = Date.now()) {
  for (const r of races || []) {
    for (const [name, ts] of r.sessions || []) {
      const dur = MINUTES[sessionId(name)] ?? 60;
      if (now >= ts - BEFORE * 60000 && now <= ts + (dur + AFTER) * 60000) return { name, meeting: r.meeting || '' };
    }
  }
  return null;
}

/** Fehlertexte, die auf Sperre oder fehlende Verbindung hindeuten (der Browser nennt die Sperre "Failed to fetch"). */
export const looksLikeBlock = (msg) => /fetch|network|CORS|401|403/i.test(String(msg || ''));
