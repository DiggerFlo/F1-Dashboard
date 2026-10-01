import { esc, safeColor } from './format.js';

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

const prepCache = new WeakMap();
/** Kumulierte Längen einer geschlossenen Polylinie (einmal je Punktliste berechnet). */
function prep(points) {
  let p = prepCache.get(points);
  if (p) return p;
  const n = points.length, cum = [0];
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  p = { cum, total: cum[n] };
  prepCache.set(points, p);
  return p;
}

function pointAtFast(points, f) {
  const { cum, total } = prep(points);
  const t = (((f % 1) + 1) % 1) * total;
  let lo = 0, hi = points.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= t) lo = mid; else hi = mid - 1; }
  const a = points[lo], b = points[(lo + 1) % points.length];
  const seg = cum[lo + 1] - cum[lo];
  const k = seg ? (t - cum[lo]) / seg : 0;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** Anteil (0..1) der Runde, an dem der Punkt (x,y) der Strecke am nächsten liegt. */
export function nearestFraction(points, x, y) {
  const { cum, total } = prep(points);
  const n = points.length;
  let best = Infinity, bf = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const k = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    const d = (x - a[0] - dx * k) ** 2 + (y - a[1] - dy * k) ** 2;
    if (d < best) { best = d; bf = (cum[i] + k * (cum[i + 1] - cum[i])) / total; }
  }
  return bf % 1;
}

/**
 * Bewegt die Fahrzeuge zwischen zwei Datenständen flüssig entlang der Strecke (nicht auf der Sehne).
 * update(state, now) bei jedem neuen Zustand, sample(now) pro Bild -> Map(num | 'sc' -> [x, y]).
 */
export function createCarAnimator() {
  const cars = new Map();
  let points = null, lastT = null;

  const frac = (c, now) => {
    const t = c.dur ? Math.min(1, Math.max(0, (now - c.t0) / c.dur)) : 1;
    return c.f0 + (c.f1 - c.f0) * t;
  };

  function track(key, f, now, dur) {
    const c = cars.get(key);
    if (!c) { cars.set(key, { f0: f, f1: f, t0: now, dur: 0 }); return; }
    const cur = frac(c, now);
    let delta = (((f - cur) % 1) + 1) % 1;
    if (delta > 0.5) delta -= 1;
    if (Math.abs(delta) > 0.3) { c.f0 = c.f1 = f; c.dur = 0; c.t0 = now; return; } // Sprung (Boxengasse, Neustart): nicht überblenden
    c.f0 = cur; c.f1 = cur + delta; c.t0 = now; c.dur = dur;
  }

  return {
    update(state, now) {
      points = state.track?.points?.length ? state.track.points : null;
      if (!points) { cars.clear(); return; }
      const dur = lastT == null ? 500 : Math.min(3000, Math.max(150, now - lastT));
      lastT = now;
      const seen = new Set();
      for (const d of state.drivers) {
        if (d.x == null || d.onTrack === false) continue;
        seen.add(d.num); track(d.num, nearestFraction(points, d.x, d.y), now, dur);
      }
      if (state.safetyCar?.x != null) { seen.add('sc'); track('sc', nearestFraction(points, state.safetyCar.x, state.safetyCar.y), now, dur); }
      for (const k of [...cars.keys()]) if (!seen.has(k)) cars.delete(k);
    },
    sample(now) {
      const out = new Map();
      if (!points) return out;
      for (const [k, c] of cars) out.set(k, pointAtFast(points, frac(c, now)));
      return out;
    },
    reset() { cars.clear(); lastT = null; },
  };
}

/** Setzt die Positionen in einem bereits gezeichneten Streckenkarten-SVG (pro Bild, ohne Neuaufbau). */
export function applyCarPositions(svg, positions) {
  const [deg, cx, cy] = svg.dataset.rot.split(' ').map(Number);
  const unit = Number(svg.dataset.unit);
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const place = ([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
  for (const el of svg.querySelectorAll('[data-car]')) {
    const p = positions.get(Number(el.dataset.car));
    if (!p) continue;
    const [x, y] = place(p);
    el.setAttribute('cx', x); el.setAttribute('cy', y);
  }
  for (const el of svg.querySelectorAll('[data-lab]')) {
    const p = positions.get(Number(el.dataset.lab));
    if (!p) continue;
    const [x, y] = place(p);
    el.setAttribute('x', x + unit * 2); el.setAttribute('y', y - unit * 1.2);
  }
  const sc = positions.get('sc');
  if (sc) {
    const [x, y] = place(sc);
    const rect = svg.querySelector('[data-sc]'), txt = svg.querySelector('[data-sc-t]');
    if (rect) { rect.setAttribute('x', x - unit * 1.6); rect.setAttribute('y', y - unit * 1.6); }
    if (txt) { txt.setAttribute('x', x); txt.setAttribute('y', y + unit * 0.7); }
  }
}

/** Dreht Punkte um den Mittelpunkt der Streckenpunkte (Ausrichtung wie auf formula1.com). */
function rotator(points, deg) {
  const b = bbox(points);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const r = ((deg || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const fn = deg ? (p) => [cx + (p[0] - cx) * c - (p[1] - cy) * s, cy + (p[0] - cx) * s + (p[1] - cy) * c] : (p) => p;
  fn.params = `${deg || 0} ${cx} ${cy}`;
  return fn;
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
export function trackSvg(state, selNum, pos = null) {
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
  const out = [`<svg viewBox="${vx} ${vy} ${vw} ${vh}" data-rot="${rot.params}" data-unit="${unit}" role="img" aria-label="Streckenlayout mit Fahrerpositionen">`];
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
    const at = pos?.get(car.num) || [car.x, car.y];
    const [cx, cy] = rot(at);
    const d = { ...car, x: cx, y: cy };
    const sel = d.num === selNum;
    const lead = d.pos === 1 && state.session.type === 'race' && flag !== 'red';
    const r = unit * (sel ? 1.5 : 1.1);
    const fill = safeColor(d.color) || '#f5f5f3';
    if (lead) out.push(`<circle data-car="${d.num}" cx="${d.x}" cy="${d.y}" r="${r + unit * 0.9}" fill="none" stroke="#e8112d" stroke-width="${unit * 0.4}" data-ring/>`);
    out.push(`<circle data-car="${d.num}" cx="${d.x}" cy="${d.y}" r="${r}" fill="${fill}" stroke="${sel ? '#f5f5f3' : '#0b0b0e'}" stroke-width="${unit * (sel ? 0.5 : 0.35)}"/>`);
    if (labelled.has(d.num) || sel) {
      out.push(`<text data-lab="${d.num}" x="${d.x + unit * 2}" y="${d.y - unit * 1.2}" font-family="JetBrains Mono" font-size="${fs}" font-weight="700" fill="#f5f5f3" stroke="#0b0b0e" stroke-width="${unit * 0.5}" paint-order="stroke">${esc(d.code)}</text>`);
    }
  }
  if (state.safetyCar && state.safetyCar.x != null) {
    const [x, y] = rot(pos?.get('sc') || [state.safetyCar.x, state.safetyCar.y]);
    out.push(`<rect data-sc x="${x - unit * 1.6}" y="${y - unit * 1.6}" width="${unit * 3.2}" height="${unit * 3.2}" fill="#ffcc00"/><text data-sc-t x="${x}" y="${y + unit * 0.7}" text-anchor="middle" font-family="JetBrains Mono" font-size="${unit * 1.7}" font-weight="700" fill="#0b0b0e">SC</text>`);
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

/** Kleine Strecken-Vorschau (z. B. im Kalender). */
export function miniTrackSvg(points, rotate = 0, label = '') {
  const rot = rotator(points, rotate);
  const pts = points.map(rot);
  const b = bbox(pts);
  const pad = 12;
  const w = b.maxX - b.minX + pad * 2, h = b.maxY - b.minY + pad * 2;
  return `<svg viewBox="${b.minX - pad} ${b.minY - pad} ${w} ${h}" role="img" aria-label="${esc(label)}"><polygon points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#9a9aa6" stroke-width="7" stroke-linejoin="round"/></svg>`;
}
