import { esc, safeColor } from './format.js';
import { arcPoints } from './pit.js';

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

/**
 * Anteil (0..1) der Runde, an dem der Punkt (x,y) der Strecke am nächsten liegt.
 * Mit hint (letzter Anteil des Autos) wird nur in dessen Umgebung (± window der Runde) gesucht, sonst springt das Auto
 * an engen Stellen, an denen zwei Streckenabschnitte dicht beieinander liegen, auf den falschen. Liegt der Punkt
 * dort weit neben der Strecke (Boxengasse, Neustart, Datensprung) oder klar näher an einer anderen Straße, gilt die Suche
 * über die ganze Strecke.
 */
export function nearestFraction(points, x, y, hint = null, window = 0.15) {
  const { cum, total } = prep(points);
  const n = points.length;
  const h = hint == null || Number.isNaN(hint) ? null : ((hint % 1) + 1) % 1;
  const scan = (limit) => {
    let best = Infinity, bf = 0;
    for (let i = 0; i < n; i++) {
      if (limit != null) {
        const m = (cum[i] + cum[i + 1]) / 2 / total;
        const gap = Math.abs(m - h);
        if (Math.min(gap, 1 - gap) > limit) continue;
      }
      const a = points[i], b = points[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const k = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
      const d = (x - a[0] - dx * k) ** 2 + (y - a[1] - dy * k) ** 2;
      if (d < best) { best = d; bf = (cum[i] + k * (cum[i + 1] - cum[i])) / total; }
    }
    return [best, bf % 1];
  };
  if (h != null) {
    const [dw, fw] = scan(window);
    if (dw <= (0.03 * total) ** 2) {
      // Nur wenn der Punkt klar (> 2,5-fach) näher an einer anderen Straße liegt, wird der Hinweis korrigiert
      const [dg, fg] = scan(null);
      return dg * 6.25 < dw ? fg : fw;
    }
  }
  return scan(null)[1];
}

/** Punkt, der um den Anteil frac der Runde vor (x, y) auf der Strecke liegt (Safety Car vor dem Führenden). */
export function aheadOf(points, x, y, frac = 0.012) {
  const [px, py] = pointAt(points, nearestFraction(points, x, y) + frac);
  return { x: px, y: py };
}

/**
 * Bewegt die Fahrzeuge zwischen zwei Datenständen flüssig entlang der Strecke (nicht auf der Sehne).
 * update(state, now) bei jedem neuen Zustand, sample(now) pro Bild -> Map(num | 'sc' -> [x, y]).
 * Autos in der Boxengasse (d.pit) werden nicht gezeigt: die Boxengasse liegt zu nah an der Strecke, um sie auf der Karte zu trennen.
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
    if (Math.abs(delta) > 0.3) { c.f0 = c.f1 = f; c.dur = 0; c.t0 = now; return; } // Sprung (Neustart, Datenlücke): nicht überblenden
    c.f0 = cur; c.f1 = cur + delta; c.t0 = now; c.dur = dur;
  }

  return {
    update(state, now) {
      points = state.track?.points?.length ? state.track.points : null;
      if (!points) { cars.clear(); return; }
      const dur = lastT == null ? 500 : Math.min(3000, Math.max(150, now - lastT));
      lastT = now;
      const seen = new Set();
      const done = []; // schon zugeordnete Autos: [x, y, Anteil]
      const on = state.drivers.filter((d) => d.x != null && d.onTrack !== false && !d.pit && d.status !== 'out');
      // Erst Autos mit bekannter Position, dann neue: sie übernehmen den Anteil des nächsten Autos (gleiche Straße),
      // statt an engen Stellen die falsche Straße zu erwischen
      for (const pass of [0, 1]) {
        for (const d of on) {
          const known = cars.get(d.num);
          if ((pass === 0) !== !!known) continue;
          let hint = known?.f1;
          if (hint == null && done.length) hint = done.reduce((b, c) => (Math.hypot(c[0] - d.x, c[1] - d.y) < Math.hypot(b[0] - d.x, b[1] - d.y) ? c : b))[2];
          const f = nearestFraction(points, d.x, d.y, hint);
          done.push([d.x, d.y, f]);
          seen.add(d.num); track(d.num, f, now, dur);
        }
      }
      if (state.safetyCar?.x != null) { seen.add('sc'); track('sc', nearestFraction(points, state.safetyCar.x, state.safetyCar.y, cars.get('sc')?.f1), now, dur); }
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
  const sectorMode = !!(tr.marshal?.length && state.sectorFlags);
  const out = [`<svg viewBox="${vx} ${vy} ${vw} ${vh}" data-rot="${rot.params}" data-unit="${unit}" role="img" aria-label="Streckenlayout mit Fahrerpositionen">`];
  const w = unit * 3;
  out.push(`<polygon points="${poly}" fill="none" stroke="#2e2e37" stroke-width="${w}" stroke-linejoin="round"/>`);
  out.push(`<polygon points="${poly}" fill="none" stroke="#17171c" stroke-width="${w * 0.75}" stroke-linejoin="round"/>`);
  if (flag === 'sc' || flag === 'vsc' || (flag === 'yellow' && !sectorMode)) {
    out.push(`<polygon points="${poly}" fill="none" stroke="#ffcc00" stroke-width="${w * 0.75}" stroke-linejoin="round" opacity=".9"/>`);
    out.push(`<polygon points="${poly}" fill="none" stroke="#17171c" stroke-width="${w * 0.45}" stroke-linejoin="round"/>`);
  } else if (flag === 'red') {
    out.push(`<polygon points="${poly}" fill="none" stroke="#e8112d" stroke-width="${unit * 0.6}" stroke-dasharray="${unit * 2} ${unit * 2}"/>`);
  }
  if (sectorMode && flag !== 'sc' && flag !== 'vsc' && flag !== 'red') { // Gelb nur dort, wo es gilt (Marshal-Sektoren)
    const N = tr.marshal.length;
    for (const { n, level } of state.sectorFlags) {
      if (n < 1 || n > N) continue;
      const arc = arcPoints(tr.points, tr.marshal[n - 1], tr.marshal[n % N]).map(rot).map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
      out.push(`<polyline data-flag="${n}" points="${arc}" fill="none" stroke="#ffcc00" stroke-width="${w * 0.75}" stroke-linecap="butt" stroke-linejoin="round"/>`);
      out.push(`<polyline points="${arc}" fill="none" stroke="#17171c" stroke-width="${w * 0.45}" stroke-linecap="butt" stroke-linejoin="round"/>`);
      if (level === 'double') out.push(`<polyline points="${arc}" fill="none" stroke="#ffcc00" stroke-width="${w * 0.12}" stroke-dasharray="${unit * 0.8} ${unit * 0.8}" stroke-linejoin="round"/>`);
    }
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
  for (const d of state.drivers) if (d.status) labelled.add(d.num);
  const tagOf = (d) => (d.status === 'out' ? ' DNF' : d.status === 'stopped' ? ' STOPP' : '');
  const cars = state.drivers.filter((d) => d.x != null && d.onTrack !== false && !d.pit && d.status !== 'out'); // Ausgefallene werden ausgeblendet // in der Box: nicht zeigen
  const order = [...cars].sort((a, c) => (a.num === selNum) - (c.num === selNum));
  for (const car of order) {
    const at = pos?.get(car.num) || [car.x, car.y];
    const [cx, cy] = rot(at);
    const d = { ...car, x: cx, y: cy };
    const sel = d.num === selNum;
    const lead = d.pos === 1 && state.session.type === 'race' && flag !== 'red';
    const r = unit * (sel ? 1.5 : 1.1);
    const fill = d.status === 'out' ? '#55555e' : safeColor(d.color) || '#f5f5f3';
    if (d.status) out.push(`<circle data-car="${d.num}" cx="${d.x}" cy="${d.y}" r="${r + unit * 0.9}" fill="none" stroke="${d.status === 'out' ? '#e8112d' : '#ffcc00'}" stroke-width="${unit * 0.4}" stroke-dasharray="${unit * 0.9} ${unit * 0.7}" data-ring/>`);
    if (lead) out.push(`<circle data-car="${d.num}" cx="${d.x}" cy="${d.y}" r="${r + unit * 0.9}" fill="none" stroke="#e8112d" stroke-width="${unit * 0.4}" data-ring/>`);
    out.push(`<circle data-car="${d.num}" cx="${d.x}" cy="${d.y}" r="${r}" fill="${fill}" stroke="${sel ? '#f5f5f3' : '#0b0b0e'}" stroke-width="${unit * (sel ? 0.5 : 0.35)}"/>`);
    if (labelled.has(d.num) || sel) {
      out.push(`<text data-lab="${d.num}" x="${d.x + unit * 2}" y="${d.y - unit * 1.2}" font-family="JetBrains Mono" font-size="${fs}" font-weight="700" fill="#f5f5f3" stroke="#0b0b0e" stroke-width="${unit * 0.5}" paint-order="stroke">${esc(d.code)}${tagOf(d)}</text>`);
    }
  }
  if (state.safetyCar && state.safetyCar.x != null) {
    const [x, y] = rot(pos?.get('sc') || [state.safetyCar.x, state.safetyCar.y]);
    out.push(`<rect data-sc x="${x - unit * 1.6}" y="${y - unit * 1.6}" width="${unit * 3.2}" height="${unit * 3.2}" fill="#ffcc00"/><text data-sc-t x="${x}" y="${y + unit * 0.7}" text-anchor="middle" font-family="JetBrains Mono" font-size="${unit * 1.7}" font-weight="700" fill="#0b0b0e">SC</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

/** Telemetrie-Verlauf in drei Spuren (Geschwindigkeit, Gas, Bremse) aus einer Historie [{speed,throttle,brake}]. */
export function tracesSvg(hist, ref, color = '#f5f5f3') {
  const c = safeColor(color) || '#f5f5f3';
  const W = 560, H = 288, N = 80, L = 58, R = 8;
  const X = (i) => L + (i * (W - L - R)) / (N - 1);
  const h = hist.slice(-N), off = N - h.length; // neue Daten füllen von rechts
  const sy = (v) => 168 - (Math.min(350, Math.max(0, v)) / 350) * 150;
  const speed = (arr, o = 0) => arr.map((r, i) => `${X(i + o).toFixed(1)},${sy(r.speed).toFixed(1)}`).join(' ');
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf von Geschwindigkeit, Gas und Bremse">`;
  for (const v of [0, 100, 200, 300]) s += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="#2e2e37"/><text x="${L - 8}" y="${sy(v) + 3}" text-anchor="end" font-family="JetBrains Mono" font-size="12" fill="#9a9aa6">${v}</text>`;
  s += `<text x="${L - 8}" y="10" text-anchor="end" font-family="Inter" font-size="11" fill="#9a9aa6">km/h</text>`;
  s += `<text x="${L - 8}" y="206" text-anchor="end" font-family="Inter" font-size="12" fill="#9a9aa6">Gas</text><rect x="${L}" y="186" width="${W - L - R}" height="30" fill="#0b0b0e" stroke="#2e2e37"/>`;
  s += `<text x="${L - 8}" y="262" text-anchor="end" font-family="Inter" font-size="12" fill="#9a9aa6">Bremse</text><rect x="${L}" y="242" width="${W - L - R}" height="30" fill="#0b0b0e" stroke="#2e2e37"/>`;
  if (ref && ref.length > 1) { const r = ref.slice(-N); s += `<polyline points="${speed(r, N - r.length)}" fill="none" stroke="#b14bff" stroke-width="2" stroke-linejoin="round"/>`; }
  if (h.length > 1) {
    s += `<polygon points="${X(off).toFixed(1)},${sy(0)} ${speed(h, off)} ${X(N - 1).toFixed(1)},${sy(0)}" fill="${c}" fill-opacity=".16"/>`;
    s += `<polyline points="${speed(h, off)}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    const area = (arr, y0, hgt, key) => `${X(off).toFixed(1)},${y0 + hgt} ` + arr.map((r, i) => `${X(i + off).toFixed(1)},${(y0 + hgt - (Math.min(100, r[key] || 0) / 100) * hgt).toFixed(1)}`).join(' ') + ` ${X(N - 1).toFixed(1)},${y0 + hgt}`;
    s += `<polygon points="${area(h, 186, 30, 'throttle')}" fill="#f5f5f3" fill-opacity=".4" stroke="#f5f5f3" stroke-width="1"/>`;
    s += `<polygon points="${area(h, 242, 30, 'brake')}" fill="#e8112d" fill-opacity=".7" stroke="#e8112d" stroke-width="1"/>`;
    const last = h[h.length - 1];
    s += `<circle cx="${X(N - 1)}" cy="${sy(last.speed)}" r="4.5" fill="${c}" stroke="#17171c" stroke-width="2"/>`;
    s += `<text x="${X(N - 1) - 8}" y="${Math.max(12, sy(last.speed) - 8)}" text-anchor="end" font-family="JetBrains Mono" font-size="13" font-weight="700" fill="#f5f5f3">${Math.round(last.speed)}</text>`;
  } else {
    s += `<text x="${(W + L) / 2}" y="100" text-anchor="middle" font-family="Inter" font-size="13" fill="#9a9aa6">Messwerte werden gesammelt …</text>`;
  }
  s += `<text x="${L}" y="${H - 2}" font-family="Inter" font-size="11" fill="#9a9aa6">älter</text><text x="${W - R}" y="${H - 2}" text-anchor="end" font-family="Inter" font-size="11" fill="#9a9aa6">jetzt</text></svg>`;
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
