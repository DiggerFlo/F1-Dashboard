// Formatierung und kleine Helfer, ohne DOM-Abhängigkeit (testbar).

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Sekunden -> "1:32.418" */
export function fmtLap(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function fmtSector(sec) {
  return sec == null || !isFinite(sec) ? '—' : sec.toFixed(3);
}

/** Abstand in Sekunden -> "+3.412" bzw. "Leader" */
export function fmtGap(sec, leader = false) {
  if (leader) return 'Leader';
  if (sec == null || !isFinite(sec)) return '—';
  return `+${sec.toFixed(3)}`;
}

/** Dauer in Sekunden -> "mm:ss" oder "h:mm:ss" */
export function fmtClock(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '—';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtTime(ms) {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

export function splitCountdown(sec) {
  sec = Math.max(0, Math.floor(sec));
  return { d: Math.floor(sec / 86400), h: Math.floor((sec % 86400) / 3600), m: Math.floor((sec % 3600) / 60), s: sec % 60 };
}

/**
 * Timing-Klassen für Sektoren: 'p' = schnellste overall, 'g' = persönliche Bestzeit,
 * 'y' = langsamer, '' = unbekannt.
 */
export function sectorClass(value, personalBest, overallBest) {
  if (value == null) return '';
  if (overallBest != null && value <= overallBest + 1e-9) return 'p';
  if (personalBest != null && value <= personalBest + 1e-9) return 'g';
  return 'y';
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
