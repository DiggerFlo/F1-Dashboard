// Namen von Sessions vereinheitlichen: OpenF1 liefert englische Namen ("Practice 1", "Race"), Jolpica und die Demo deutsche ("Training 1", "Rennen").
import { t } from './i18n.js';

/** Kurzschlüssel einer Session (fp1, quali, race, ...) aus einem Namen in beliebiger Sprache, sonst null. */
export function sessionId(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  if (n.startsWith('sess.')) return Object.keys(IDS).find((k) => k.toLowerCase() === n.slice(5)) ?? null;
  if (/beendet|finished/.test(n) && /rennen|race/.test(n)) return 'raceDone';
  if (/^(nächstes|next) (rennen|race)/.test(n)) return 'nextRace';
  const fp = n.match(/^(?:practice|training|fp)\s*(\d)/);
  if (fp) return `fp${fp[1]}`;
  if (/sprint.*(qualifying|shootout)/.test(n)) return 'sprintq';
  if (/^sprint/.test(n)) return 'sprint';
  if (/qualifying|^quali/.test(n)) return 'quali';
  if (/^(race|rennen)$/.test(n)) return 'race';
  return null;
}

const IDS = { fp1: 1, fp2: 1, fp3: 1, sprintq: 1, sprint: 1, quali: 1, race: 1, raceDone: 1, nextRace: 1 };

/** Name in der Sprache der Oberfläche; unbekannte Namen (z. B. "Q2") bleiben unverändert. */
export function sessionLabel(name) {
  const id = sessionId(name);
  return id ? t(`sess.${id}`) : String(name ?? '');
}

/** Gleiche Session? (z. B. Zeitplan-Eintrag "Qualifying" gegen nextLabel "Qualifying"). */
export function sameSession(a, b) {
  const canon = (id) => (id === 'nextRace' || id === 'raceDone' ? 'race' : id);
  const x = canon(sessionId(a)), y = canon(sessionId(b));
  return x != null ? x === y : String(a) === String(b);
}
