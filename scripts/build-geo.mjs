// Richtet die Streckenlayouts (public/data/circuits.json) auf die echte Lage auf der Weltkarte aus.
// Quelle der Geometrie: bacinger/f1-circuits (MIT) mit den Streckenverläufen als GeoJSON (Länge/Breite, aus OpenStreetMap).
// Pro Layout wird eine affine Abbildung layout (x, y) -> Web-Mercator (X, -Y) gesucht (Ähnlichkeitsfit, danach ICP-Verfeinerung)
// und in public/data/circuit-geo.json abgelegt. Aufruf: node scripts/build-geo.mjs [Zwischenspeicher-Ordner]
import fs from 'node:fs';
import path from 'node:path';
import { samplePath, resample } from '../js/svgpath.js';
import { fitSimilarity } from '../js/fit.js';
import { DEMO_TRACK } from '../js/sources/demo-track.js';

const RAW = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits';
const cacheDir = process.argv[2] || path.join(process.env.TEMP || '/tmp', 'f1-circuits-cache');
fs.mkdirSync(cacheDir, { recursive: true });

// Layout-ID des Datensatzes (circuits.json) -> Datei bei bacinger/f1-circuits
const BACINGER = {
  austin: 'us-2012', bahrain: 'bh-2002', baku: 'az-2016', catalunya: 'es-1991', hockenheimring: 'de-1932', hungaroring: 'hu-1986', imola: 'it-1953',
  interlagos: 'br-1940', istanbul: 'tr-2005', jeddah: 'sa-2021', 'las-vegas': 'us-2023', lusail: 'qa-2004', madring: 'es-2026', 'marina-bay': 'sg-2008',
  melbourne: 'au-1953', 'mexico-city': 'mx-1962', miami: 'us-2022', monaco: 'mc-1929', montreal: 'ca-1978', monza: 'it-1922', mugello: 'it-1914',
  nurburgring: 'de-1927', 'paul-ricard': 'fr-1969', portimao: 'pt-2008', sepang: 'my-1999', shanghai: 'cn-2004', silverstone: 'gb-1948', sochi: 'ru-2014',
  'spa-francorchamps': 'be-1925', spielberg: 'at-1969', suzuka: 'jp-1962', 'yas-marina': 'ae-2009', zandvoort: 'nl-1948',
};

const R = 6378137;
const merc = ([lon, lat]) => [R * (lon * Math.PI) / 180, -R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))]; // Y nach unten wie im SVG

async function geoOf(file) {
  const f = path.join(cacheDir, `${file}.geojson`);
  if (!fs.existsSync(f)) {
    const r = await fetch(`${RAW}/${file}.geojson`);
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    fs.writeFileSync(f, await r.text());
  }
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const g = j.features[0].geometry;
  const line = g.type === 'MultiLineString' ? g.coordinates.flat() : g.coordinates;
  return line.map(merc);
}

/** Offizielle Rundenlänge in Metern aus den Eigenschaften der GeoJSON-Datei. */
const lengthOf = (file) => Number(JSON.parse(fs.readFileSync(path.join(cacheDir, `${file}.geojson`), 'utf8')).features[0].properties?.length) || null;

const nearest = (p, pts) => { let b = Infinity, q = null; for (const c of pts) { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (d < b) { b = d; q = c; } } return [q, Math.sqrt(b)]; };

/** Ähnlichkeit (Drehung + Skalierung + Verschiebung, optional vorgeschaltete Spiegelung) src -> dst per Kleinste-Quadrate (komplexe Zahlen). */
function solveSimilarity(src, dst) {
  const n = src.length;
  const cs = [src.reduce((a, p) => a + p[0], 0) / n, src.reduce((a, p) => a + p[1], 0) / n];
  const cd = [dst.reduce((a, p) => a + p[0], 0) / n, dst.reduce((a, p) => a + p[1], 0) / n];
  let re = 0, im = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - cs[0], py = src[i][1] - cs[1], qx = dst[i][0] - cd[0], qy = dst[i][1] - cd[1];
    re += px * qx + py * qy; im += px * qy - py * qx; den += px * px + py * py;
  }
  const a = re / den, b = im / den; // z = a + ib
  return { a, b, tx: cd[0] - (a * cs[0] - b * cs[1]), ty: cd[1] - (b * cs[0] + a * cs[1]) };
}

function fitLayout(layoutPts, geo) {
  const dense = resample(geo, 900);
  const init = fitSimilarity(layoutPts, geo, 150);
  // Spiegelung erkennen: Bild der y-Achse gegenüber der x-Achse
  const o = init.map(0, 0), ex = init.map(1, 0), ey = init.map(0, 1);
  const vx = [ex[0] - o[0], ex[1] - o[1]], vy = [ey[0] - o[0], ey[1] - o[1]];
  const mirrored = vx[0] * vy[1] - vx[1] * vy[0] < 0;
  const flip = (p) => (mirrored ? [p[0], -p[1]] : p);
  const base = layoutPts.map(flip);
  let t = solveSimilarity(base, base.map((p) => init.map(...(mirrored ? [p[0], -p[1]] : p))));
  const apply = (p, T) => [T.a * p[0] - T.b * p[1] + T.tx, T.b * p[0] + T.a * p[1] + T.ty];
  for (let it = 0; it < 40; it++) { // ICP: nächster Punkt der echten Linie, dann neu anpassen
    const q = base.map((p) => nearest(apply(p, t), dense)[0]);
    t = solveSimilarity(base, q);
  }
  const dists = base.map((p) => nearest(apply(p, t), dense)[1]);
  const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
  const sorted = [...dists].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  // affine Matrix layout (x, y) -> (X, Yd) in SVG-Konvention [a b c d e f]: X = a x + c y + e, Yd = b x + d y + f; Spiegelung steckt in c/d
  const m = mirrored ? [t.a, t.b, t.b, -t.a, t.tx, t.ty] : [t.a, t.b, -t.b, t.a, t.tx, t.ty];
  const span = Math.hypot(Math.max(...geo.map((p) => p[0])) - Math.min(...geo.map((p) => p[0])), Math.max(...geo.map((p) => p[1])) - Math.min(...geo.map((p) => p[1])));
  return { m, mirrored, meanM: mean, p90M: p90, rel: mean / span, scale: Math.hypot(t.a, t.b) };
}

const db = JSON.parse(fs.readFileSync('public/data/circuits.json', 'utf8'));
const out = {};
const rows = [];
const jobs = [];
for (const [cid, c] of Object.entries(db)) {
  if (!BACINGER[cid]) { rows.push([cid, '-', 'keine Geodaten im Datensatz']); continue; }
  for (const l of c.layouts) jobs.push({ id: l.id, cid, d: l.d, current: /2025|2026/.test(l.seasons) });
}
jobs.push({ id: 'demo-monza', cid: 'monza', points: DEMO_TRACK.points, current: true });

for (const job of jobs) {
  try {
    const geo = await geoOf(BACINGER[job.cid]);
    const pts = job.points || samplePath(job.d, 400);
    const r = fitLayout(pts, geo);
    rows.push([job.id, BACINGER[job.cid], `mittlere Abweichung ${r.meanM.toFixed(1)} m, 90 % unter ${r.p90M.toFixed(1)} m, ${r.mirrored ? 'gespiegelt' : 'nicht gespiegelt'}${job.current ? '' : ' (alte Variante)'}`]);
    out[job.id] = { bid: BACINGER[job.cid], len: lengthOf(BACINGER[job.cid]), m: r.m.map((v) => Math.round(v * 1e6) / 1e6), err: Math.round(r.meanM * 10) / 10, p90: Math.round(r.p90M * 10) / 10 };
  } catch (e) { rows.push([job.id, BACINGER[job.cid], `Fehler: ${e.message}`]); }
}
console.log(rows.map((r) => r.join(' | ')).join('\n'));
fs.writeFileSync('public/data/circuit-geo.json', JSON.stringify(out));
console.log('layouts mit Fit:', Object.keys(out).length);
