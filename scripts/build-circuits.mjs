// Erzeugt public/data/circuits.json (aktuelle Layouts, nur Pfaddaten) und js/sources/demo-track.js
// aus einem Checkout von https://github.com/julesr0y/f1-circuits-svg (CC BY 4.0).
// Aufruf: node scripts/build-circuits.mjs /pfad/zu/f1-circuits-svg
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { samplePath } from '../js/svgpath.js';

const src = process.argv[2];
if (!src) { console.error('Pfad zum f1-circuits-svg-Checkout angeben'); process.exit(1); }
const list = JSON.parse(readFileSync(join(src, 'circuits.json'), 'utf8'));
const MIN_YEAR = 2012;
const lastSeason = (s) => Math.max(...s.split(',').map((p) => Number(p.split('-').pop())));

const out = {};
for (const c of list) {
  const layouts = c.layouts.filter((l) => lastSeason(l.seasons) >= MIN_YEAR).map((l) => {
    const svg = readFileSync(join(src, 'circuits/minimal/white', `${l.layoutId}.svg`), 'utf8');
    const d = [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map((m) => m[1]).join(' ');
    return { id: l.layoutId, seasons: l.seasons, rotate: l['f1-orientation'] ?? 0, d };
  });
  if (layouts.length) out[c.id] = { name: c.name, country: c.countryId, layouts };
}
writeFileSync('public/data/circuits.json', JSON.stringify(out));

const monza = out.monza.layouts.at(-1);
const pts = samplePath(monza.d, 160).map((p) => p.map((v) => Math.round(v * 10) / 10));
writeFileSync('js/sources/demo-track.js', `// Erzeugt von scripts/build-circuits.mjs aus f1-circuits-svg (Monza, CC BY 4.0). Nicht von Hand ändern.\nexport const DEMO_TRACK = { name: 'Autodromo Nazionale Monza', rotate: ${monza.rotate}, points: ${JSON.stringify(pts)} };\n`);
console.log(Object.keys(out).length, 'Strecken,', Object.values(out).reduce((n, c) => n + c.layouts.length, 0), 'Layouts');
