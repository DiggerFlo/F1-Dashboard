import { resample } from './svgpath.js';

// Passt die Positionsdaten einer Quelle (eigenes Koordinatensystem) per Ähnlichkeitstransformation
// (Verschiebung, Skalierung, Drehung, optional Spiegelung) auf ein Streckenlayout an.

function stats(pts) {
  const n = pts.length;
  const cx = pts.reduce((a, p) => a + p[0], 0) / n, cy = pts.reduce((a, p) => a + p[1], 0) / n;
  const r = Math.sqrt(pts.reduce((a, p) => a + (p[0] - cx) ** 2 + (p[1] - cy) ** 2, 0) / n);
  return { cx, cy, r };
}

function chamfer(a, b) {
  let sum = 0;
  for (const p of a) {
    let best = Infinity;
    for (const q of b) { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < best) best = d; }
    sum += Math.sqrt(best);
  }
  return sum / a.length;
}

const rot = (p, c, s) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];

/**
 * @returns {{map:(x:number,y:number)=>number[], error:number}} error = mittlere Abweichung relativ zum Streckenradius
 */
export function fitSimilarity(src, dst, n = 100) {
  const a = resample(src, n), b = resample(dst, n);
  const sa = stats(a), sb = stats(b);
  const na = a.map((p) => [(p[0] - sa.cx) / sa.r, (p[1] - sa.cy) / sa.r]);
  const nb = b.map((p) => [(p[0] - sb.cx) / sb.r, (p[1] - sb.cy) / sb.r]);
  let best = { err: Infinity, mirror: false, ang: 0 };
  const score = (mirror, deg) => {
    const rad = (deg * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
    const t = na.map((p) => rot(mirror ? [p[0], -p[1]] : p, c, s));
    return chamfer(t, nb) + chamfer(nb, t);
  };
  for (const mirror of [false, true]) {
    for (let deg = 0; deg < 360; deg += 3) {
      const e = score(mirror, deg);
      if (e < best.err) best = { err: e, mirror, ang: deg };
    }
  }
  const { mirror } = best;
  let ang = best.ang;
  for (let step = 1.5; step >= 0.1; step /= 2) {
    for (const cand of [ang - step, ang + step]) {
      const e = score(mirror, cand);
      if (e < best.err) { best.err = e; ang = cand; }
    }
  }
  const rad = (ang * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const k = sb.r / sa.r;
  const map = (x, y) => {
    let p = [(x - sa.cx) / sa.r, (y - sa.cy) / sa.r];
    if (mirror) p = [p[0], -p[1]];
    p = rot(p, c, s);
    return [p[0] * sb.r + sb.cx, p[1] * sb.r + sb.cy];
  };
  // Feinabstimmung: ICP mit Ähnlichkeitstransformation (Spiegelung bleibt fest)
  const dense = resample(src, 240), target = resample(dst, 480);
  let cur = map;
  for (let it = 0; it < 12; it++) {
    const a1 = dense.map(([x, y]) => cur(x, y));
    const b1 = a1.map((p) => { let bi = 0, bd = Infinity; for (let j = 0; j < target.length; j++) { const d = (p[0] - target[j][0]) ** 2 + (p[1] - target[j][1]) ** 2; if (d < bd) { bd = d; bi = j; } } return target[bi]; });
    const ma = [a1.reduce((q, p) => q + p[0], 0) / a1.length, a1.reduce((q, p) => q + p[1], 0) / a1.length];
    const mb = [b1.reduce((q, p) => q + p[0], 0) / b1.length, b1.reduce((q, p) => q + p[1], 0) / b1.length];
    let dot = 0, cross = 0, nrm = 0;
    for (let i = 0; i < a1.length; i++) {
      const ax = a1[i][0] - ma[0], ay = a1[i][1] - ma[1], bx = b1[i][0] - mb[0], by = b1[i][1] - mb[1];
      dot += ax * bx + ay * by; cross += ax * by - ay * bx; nrm += ax * ax + ay * ay;
    }
    const th = Math.atan2(cross, dot), sc = Math.hypot(dot, cross) / nrm, cs = Math.cos(th), sn = Math.sin(th);
    const prev = cur;
    cur = (x, y) => { const [px, py] = prev(x, y); const ux = px - ma[0], uy = py - ma[1]; return [sc * (ux * cs - uy * sn) + mb[0], sc * (ux * sn + uy * cs) + mb[1]]; };
  }
  const refined = dense.map(([x, y]) => cur(x, y));
  const error = (chamfer(refined, target) + chamfer(target, refined)) / 2 / sb.r;
  return { map: cur, error, scale: k, mirror, angle: ang };
}
