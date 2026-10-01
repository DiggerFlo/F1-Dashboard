import { esc } from './format.js';

/** Punkt auf einem geschlossenen Polygonzug bei Anteil f (0..1) der Gesamtlänge. */
export function pointAt(points, f) {
  const n = points.length;
  const segs = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push([a, b, d]);
    total += d;
  }
  let t = (((f % 1) + 1) % 1) * total;
  for (const [a, b, d] of segs) {
    if (t <= d) {
      const k = d ? t / d : 0;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    t -= d;
  }
  return points[0];
}

/** Dreht Punkte um den Mittelpunkt der Streckenpunkte (Ausrichtung wie auf formula1.com). */
function rotator(points, deg) {
  if (!deg) return (p) => p;
  const b = bbox(points);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return (p) => [cx + (p[0] - cx) * c - (p[1] - cy) * s, cy + (p[0] - cx) * s + (p[1] - cy) * c];
}

function bbox(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY };
}

/**
 * SVG des Streckenlayouts. state.track = { points:[[x,y]...], sectors:[f,...]?, turns:[f,...]? }
 * Fahrer haben x/y im gleichen Koordinatensystem (nur wenn onTrack !== false).
 */
export function trackSvg(state, selNum) {
  const tr = state.track;
  if (!tr || !tr.points?.length) return '<div class="empty">Streckenlayout wird geladen …</div>';
  const rot = rotator(tr.points, tr.rotate);
  const pts = tr.points.map(rot);
  const b = bbox(pts);
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08;
  const vx = b.minX - pad, vy = b.minY - pad;
  const vw = b.maxX - b.minX + pad * 2, vh = b.maxY - b.minY + pad * 2;
  const unit = Math.max(vw, vh) / 100; // 1 "Einheit" ≈ 1 % der Kartenbreite
  const poly = pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  const flag = state.flag;
  const out = [`<svg viewBox="${vx} ${vy} ${vw} ${vh}" role="img" aria-label="Streckenlayout mit Fahrerpositionen">`];
  const w = unit * 3;
  out.push(`<polygon points="${poly}" fill="none" stroke="#2e2e37" stroke-width="${w}" stroke-linejoin="round"/>`);
  out.push(`<polygon points="${poly}" fill="none" stroke="#17171c" stroke-width="${w * 0.75}" stroke-linejoin="round"/>`);
  if (flag === 'sc' || flag === 'vsc' || flag === 'yellow') {
    out.push(`<polygon points="${poly}" fill="none" stroke="#ffcc00" stroke-width="${w * 0.75}" stroke-linejoin="round" opacity=".9"/>`);
    out.push(`<polygon points="${poly}" fill="none" stroke="#17171c" stroke-width="${w * 0.45}" stroke-linejoin="round"/>`);
  } else if (flag === 'red') {
    out.push(`<polygon points="${poly}" fill="none" stroke="#e8112d" stroke-width="${unit * 0.6}" stroke-dasharray="${unit * 2} ${unit * 2}"/>`);
  } else {
    out.push(`<polygon points="${poly}" fill="none" stroke="#9a9aa6" stroke-width="${unit * 0.25}" stroke-dasharray="${unit * 0.5} ${unit}"/>`);
  }
  const fs = unit * 1.9;
  (tr.sectors || []).forEach((f, i) => {
    const [x, y] = rot(pointAt(tr.points, f));
    out.push(`<circle cx="${x}" cy="${y}" r="${unit * 0.8}" fill="#f5f5f3"/><text x="${x + unit * 1.6}" y="${y + unit * 3}" font-family="JetBrains Mono" font-size="${fs}" fill="#9a9aa6">S${i + 1}</text>`);
  });
  if (state.session.type === 'upcoming') {
    (tr.turns || []).forEach((f, i) => {
      const [x, y] = rot(pointAt(tr.points, f));
      out.push(`<text x="${x - unit * 3}" y="${y - unit * 1.6}" font-family="JetBrains Mono" font-size="${fs}" fill="#9a9aa6">${i + 1}</text>`);
    });
  }
  const labelled = new Set(state.drivers.slice(0, flag === 'sc' || flag === 'vsc' || flag === 'red' ? 1 : 3).map((d) => d.num));
  const cars = state.drivers.filter((d) => d.x != null && d.onTrack !== false);
  const order = [...cars].sort((a, c) => (a.num === selNum) - (c.num === selNum));
  for (const car of order) {
    const [cx, cy] = rot([car.x, car.y]);
    const d = { ...car, x: cx, y: cy };
    const sel = d.num === selNum;
    const lead = d.pos === 1 && state.session.type === 'race' && flag !== 'red';
    const r = unit * (sel ? 1.5 : 1.1);
    out.push(`<circle cx="${d.x}" cy="${d.y}" r="${r}" fill="${lead ? '#e8112d' : '#f5f5f3'}" stroke="${sel ? '#f5f5f3' : '#17171c'}" stroke-width="${unit * 0.45}"/>`);
    if (labelled.has(d.num) || sel) {
      out.push(`<text x="${d.x + unit * 2}" y="${d.y - unit * 1.2}" font-family="JetBrains Mono" font-size="${fs}" font-weight="700" fill="#f5f5f3">${esc(d.code)}</text>`);
    }
  }
  if (state.safetyCar && state.safetyCar.x != null) {
    const [x, y] = rot([state.safetyCar.x, state.safetyCar.y]);
    out.push(`<rect x="${x - unit * 1.6}" y="${y - unit * 1.6}" width="${unit * 3.2}" height="${unit * 3.2}" fill="#ffcc00"/><text x="${x}" y="${y + unit * 0.7}" text-anchor="middle" font-family="JetBrains Mono" font-size="${unit * 1.7}" font-weight="700" fill="#0b0b0e">SC</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

/** Telemetrie-Verlauf (Geschwindigkeit, Gas, Bremse) aus einer Historie [{speed,throttle,brake}]. */
export function tracesSvg(hist, ref) {
  const W = 760, H = 220, N = 80;
  const line = (arr, fn) => arr.map((s, i) => `${((i * W) / (N - 1)).toFixed(1)},${fn(s).toFixed(1)}`).join(' ');
  const h = hist.slice(-N);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf von Geschwindigkeit, Gas und Bremse">`;
  for (const y of [30, 70, 110, 150, 190]) s += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="#2e2e37"/>`;
  if (ref && ref.length > 1) s += `<polyline points="${line(ref.slice(-N), (r) => 130 - r.speed * 0.38)}" fill="none" stroke="#b14bff" stroke-width="2"/>`;
  if (h.length > 1) {
    s += `<polyline points="${line(h, (r) => 130 - r.speed * 0.38)}" fill="none" stroke="#f5f5f3" stroke-width="2"/>`;
    s += `<polyline points="${line(h, (r) => 210 - r.throttle * 0.5)}" fill="none" stroke="#9a9aa6" stroke-width="1.5"/>`;
    s += `<polyline points="${line(h, (r) => 210 - r.brake * 0.5)}" fill="none" stroke="#f5f5f3" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  }
  s += `<text x="4" y="14" font-family="JetBrains Mono" font-size="10" fill="#9a9aa6">320 km/h</text><text x="${W - 4}" y="214" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#9a9aa6">jetzt</text></svg>`;
  return s;
}
