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

/** Nur gültige #rrggbb-Farben durchlassen (Werte aus externen Quellen landen in Stilen). */
export function safeColor(c) {
  if (typeof c !== 'string') return null;
  const v = c.trim().replace(/^#?/, '#');
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

/** Fahrerfoto nur vom offiziellen F1-Medienserver (https), sonst null. */
export function safePhoto(u) {
  try { const x = new URL(String(u)); return x.protocol === 'https:' && x.hostname === 'media.formula1.com' ? x.href : null; } catch { return null; }
}

/**
 * Fahrerfoto vom F1-Medienserver aus Vor- und Nachname (Jolpica liefert keine Bild-Adresse). Schema des Servers: Ordner mit
 * Kennung aus den ersten drei Buchstaben von Vor- und Nachname plus 01, mehrteilige Namen mit Leerzeichen. Gibt es das Bild nicht,
 * liefert der Server selbst ein neutrales Ersatzbild (d_driver_fallback_image). Ohne Namen null.
 */
export function f1Photo(given, family) {
  const words = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z\s-]/g, '').split(/[\s-]+/).filter(Boolean);
  const g = words(given), f = words(family);
  if (!g.length || !f.length) return null;
  const id = (g[0].slice(0, 3) + f.join('').slice(0, 3)).toUpperCase();
  const name = encodeURIComponent(`${g.join(' ')}_${f.join(' ')}`).replace(/%5F/gi, '_');
  return `https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/${id[0]}/${id}01_${name}/${id.toLowerCase()}01.png.transform/1col/image.png`;
}
