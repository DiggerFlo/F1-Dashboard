// Teamfarben (Saison 2025/26) und Reifenfarben. Live-Daten liefern eigene Farben, diese dienen als Ersatz
// (z. B. für Wertungen aus Jolpica, die nur Teamnamen kennen).
import { norm } from './circuits.js';

// Reihenfolge zählt: spezifischere Namen vor allgemeinen ("racing bulls" vor "red bull").
const TEAM_COLORS = [
  ['racing bulls', '#6692ff'], ['rb f1', '#6692ff'], ['alphatauri', '#6692ff'], ['toro rosso', '#6692ff'],
  ['red bull', '#3671c6'], ['mclaren', '#ff8000'], ['ferrari', '#e8002d'], ['mercedes', '#27f4d2'], ['williams', '#64c4ff'],
  ['aston martin', '#229971'], ['alpine', '#ff87bc'], ['haas', '#b6babd'], ['sauber', '#52e252'], ['audi', '#ff2d55'], ['cadillac', '#9aa0aa'],
];

export function teamColor(name) {
  const n = norm(name);
  if (!n) return null;
  return TEAM_COLORS.find(([k]) => n.includes(k))?.[1] || null;
}

// Pirelli-Reifenfarben. Schlüssel: erster Buchstabe der Mischung (OpenF1: SOFT, MEDIUM, HARD, INTERMEDIATE, WET).
export const TYRES = {
  S: { name: 'Soft', color: '#e8112d' },
  M: { name: 'Medium', color: '#ffd12e' },
  H: { name: 'Hard', color: '#f5f5f3' },
  I: { name: 'Intermediate', color: '#2fbf4a' },
  W: { name: 'Wet', color: '#2f7cff' },
};

export const tyreInfo = (c) => TYRES[String(c || '?')[0].toUpperCase()] || null;
