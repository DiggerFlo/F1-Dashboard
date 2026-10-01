// Minimaler SVG-Pfad-Parser: wandelt einen "d"-Wert in Punkte um (für Fahrerpositionen auf dem Layout).
// Unterstützt M L H V C S Q T A Z in absoluter und relativer Schreibweise.

const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// Arc in Mittelpunktsform umrechnen (SVG-Spezifikation F.6.5) und in Punkte zerlegen.
function arcPoints(x1, y1, rx, ry, phi, fa, fs, x2, y2, steps) {
  if (!rx || !ry) return [[x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const p = (phi * Math.PI) / 180, c = Math.cos(p), s = Math.sin(p);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = c * dx + s * dy, y1p = -s * dx + c * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  if (fs && dth < 0) dth += 2 * Math.PI;
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = th1 + (dth * i) / steps;
    pts.push([c * rx * Math.cos(t) - s * ry * Math.sin(t) + cx, s * rx * Math.cos(t) + c * ry * Math.sin(t) + cy]);
  }
  return pts;
}

/** Pfad -> dichte Polylinie (Liste von [x,y]). */
export function flattenPath(d, steps = 24) {
  const pts = [];
  let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, lcx = null, lcy = null, lqx = null, lqy = null;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const NUMRE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y;
  const num = () => { skip(); NUMRE.lastIndex = i; const m = NUMRE.exec(d); if (!m) throw new Error(`Ungültiger Pfad bei Position ${i}`); i = NUMRE.lastIndex; return parseFloat(m[0]); };
  const flag = () => { skip(); const c = d[i++]; if (c !== '0' && c !== '1') throw new Error(`Ungültiges Arc-Flag bei Position ${i}`); return Number(c); };
  while (true) {
    skip();
    if (i >= d.length) break;
    if (/[A-Za-z]/.test(d[i])) cmd = d[i++];
    else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
    const up = cmd.toUpperCase(), rel = cmd !== up;
    if (up === 'Z') { x = sx; y = sy; pts.push([x, y]); lcx = lqx = null; continue; }
    const a = [];
    for (let k = 0; k < ARGS[up]; k++) a.push(up === 'A' && (k === 3 || k === 4) ? flag() : num());
    const ox = rel ? x : 0, oy = rel ? y : 0;
    let nc = null, nq = null;
    if (up === 'M') { x = a[0] + ox; y = a[1] + oy; sx = x; sy = y; pts.push([x, y]); }
    else if (up === 'L') { x = a[0] + ox; y = a[1] + oy; pts.push([x, y]); }
    else if (up === 'H') { x = a[0] + (rel ? x : 0); pts.push([x, y]); }
    else if (up === 'V') { y = a[0] + (rel ? y : 0); pts.push([x, y]); }
    else if (up === 'C' || up === 'S') {
      let x1, y1, x2, y2, x3, y3;
      if (up === 'C') { x1 = a[0] + ox; y1 = a[1] + oy; x2 = a[2] + ox; y2 = a[3] + oy; x3 = a[4] + ox; y3 = a[5] + oy; }
      else { x1 = lcx != null ? 2 * x - lcx : x; y1 = lcy != null ? 2 * y - lcy : y; x2 = a[0] + ox; y2 = a[1] + oy; x3 = a[2] + ox; y3 = a[3] + oy; }
      for (let k = 1; k <= steps; k++) {
        const u = k / steps, v = 1 - u;
        pts.push([v * v * v * x + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3, v * v * v * y + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3]);
      }
      nc = [x2, y2]; x = x3; y = y3;
    } else if (up === 'Q' || up === 'T') {
      let x1, y1, x2, y2;
      if (up === 'Q') { x1 = a[0] + ox; y1 = a[1] + oy; x2 = a[2] + ox; y2 = a[3] + oy; }
      else { x1 = lqx != null ? 2 * x - lqx : x; y1 = lqy != null ? 2 * y - lqy : y; x2 = a[0] + ox; y2 = a[1] + oy; }
      for (let k = 1; k <= steps; k++) {
        const u = k / steps, v = 1 - u;
        pts.push([v * v * x + 2 * v * u * x1 + u * u * x2, v * v * y + 2 * v * u * y1 + u * u * y2]);
      }
      nq = [x1, y1]; x = x2; y = y2;
    } else if (up === 'A') {
      const ex = a[5] + ox, ey = a[6] + oy;
      pts.push(...arcPoints(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey, steps));
      x = ex; y = ey;
    }
    [lcx, lcy] = nc || [null, null];
    [lqx, lqy] = nq || [null, null];
  }
  return pts;
}

/** Geschlossene Polylinie in n gleichmäßig verteilte Punkte (nach Bogenlänge) umrechnen. */
export function resample(points, n) {
  const pts = points.slice();
  const first = pts[0], last = pts[pts.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-9) pts.push(first);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / n;
    while (j < cum.length - 1 && cum[j] < target) j++;
    const seg = cum[j] - cum[j - 1] || 1;
    const f = (target - cum[j - 1]) / seg;
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f]);
  }
  return out;
}

export const samplePath = (d, n = 300) => resample(flattenPath(d), n);

export function pathLength(d) {
  const p = flattenPath(d, 48);
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}
