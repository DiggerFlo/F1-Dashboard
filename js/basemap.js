// Kartenhintergrund unter dem Streckenlayout. Rasterkacheln (Esri, ohne Schlüssel abrufbar) werden per affiner
// Abbildung so gelegt, dass das Layout auf dem echten Streckenverlauf liegt. Die Abbildung layout -> Weltkarte steht in
// public/data/circuit-geo.json (erzeugt von scripts/build-geo.mjs aus bacinger/f1-circuits, MIT). Reine Funktionen, ohne DOM und Netz.

const R = 6378137;                 // Erdradius der Web-Mercator-Projektion in m
const ORIGIN = Math.PI * R;        // halbe Weltbreite
const WORLD = 2 * ORIGIN;
export const MIN_ZOOM = 11, MAX_TILES = 48;
const TARGET_PX = 800;             // so viele Bildschirmpixel soll die Breite des Kartenausschnitts etwa haben (Kacheln sind 256 px groß)

/**
 * Kartenstile. url(z, x, y) liefert die Kachel, maxZoom die größte Zoomstufe der Quelle, filter färbt sie passend zur dunklen Oberfläche um,
 * attr ist der Quellenhinweis. Beide Quellen laufen ohne Zugangsschlüssel (Esri-Basemaps, bitte Nutzungsbedingungen beachten).
 */
export const STYLES = {
  map: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`, maxZoom: 16, filter: 'none', attr: 'Esri, HERE, Garmin, © OpenStreetMap-Mitwirkende' },
  sat: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, maxZoom: 18, filter: 'grayscale(.9) brightness(.62) contrast(1.15)', attr: 'Esri, Maxar, Earthstar Geographics, GIS User Community' },
};
export const STYLE_IDS = Object.keys(STYLES);

/** Länge/Breite -> Web-Mercator (X nach rechts, Yd nach unten wie im SVG). */
export const toMercator = (lon, lat) => [R * (lon * Math.PI) / 180, -R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
/** Web-Mercator (X, Yd) -> [Länge, Breite]. */
export const fromMercator = (X, Yd) => [(X / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(-Yd / R)) - Math.PI / 2) * (180 / Math.PI)];

/** Wo liegt ein Layoutpunkt (x, y) auf der Weltkarte? geo = { m: [a, b, c, d, e, f] } aus circuit-geo.json. Gibt [Länge, Breite] zurück. */
export function layoutToLonLat(geo, x, y) {
  const [a, b, c, d, e, f] = geo.m;
  return fromMercator(a * x + c * y + e, b * x + d * y + f);
}

/**
 * Kacheln für den sichtbaren Ausschnitt.
 * view: { vx, vy, vw, vh } (viewBox der Anzeige, nach der Drehung), rot: { deg, cx, cy } (Drehung Layout -> Anzeige), geo: { m }.
 * style: Schlüssel aus STYLES, dpr: Pixeldichte des Bildschirms (ab 1,5 eine Zoomstufe feiner).
 * Gibt { z, count, tiles: [{ key, href, matrix }] } zurück; matrix bildet Kachelpixel (0..256) auf Layoutkoordinaten ab (SVG-Matrix a b c d e f).
 */
export function planBasemap({ view, rot, geo, style = 'map', dpr = 1 }) {
  const st = STYLES[style] || STYLES.map;
  const [a, b, c, d, e, f] = geo?.m || [];
  const det = a * d - b * c;
  if (![a, b, c, d, e, f].every(Number.isFinite) || Math.abs(det) < 1e-12) return null;
  const rad = (-(rot?.deg || 0) * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
  const cx = rot?.cx || 0, cy = rot?.cy || 0;
  const unrot = (x, y) => [cx + (x - cx) * cs - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * cs]; // Anzeige -> Layout
  const toGeo = (x, y) => [a * x + c * y + e, b * x + d * y + f];
  const corners = [[view.vx, view.vy], [view.vx + view.vw, view.vy], [view.vx + view.vw, view.vy + view.vh], [view.vx, view.vy + view.vh]].map(([x, y]) => toGeo(...unrot(x, y)));
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const widthM = view.vw * Math.hypot(a, b); // Breite des Ausschnitts in Mercator-Metern
  const range = (z) => {
    const tileM = WORLD / 2 ** z;
    const ix = (v) => Math.floor((v + ORIGIN) / tileM);
    return { tileM, x0: ix(minX), x1: ix(maxX), y0: ix(minY), y1: ix(maxY) };
  };
  let z = Math.min(st.maxZoom, Math.max(MIN_ZOOM, Math.round(Math.log2((WORLD * TARGET_PX) / (256 * widthM))) + (dpr >= 1.5 ? 1 : 0)));
  let g = range(z);
  while (z > MIN_ZOOM && (g.x1 - g.x0 + 1) * (g.y1 - g.y0 + 1) > MAX_TILES) { z--; g = range(z); }
  const rpx = g.tileM / 256;
  const tiles = [];
  for (let ty = g.y0; ty <= g.y1; ty++) {
    for (let tx = g.x0; tx <= g.x1; tx++) {
      const X0 = tx * g.tileM - ORIGIN, Y0 = ty * g.tileM - ORIGIN; // linke obere Ecke der Kachel in (X, Yd)
      const matrix = [
        (rpx * d) / det, (-rpx * b) / det, (-rpx * c) / det, (rpx * a) / det,
        (d * (X0 - e) - c * (Y0 - f)) / det, (-b * (X0 - e) + a * (Y0 - f)) / det,
      ];
      tiles.push({ key: `${z}/${tx}/${ty}`, href: st.url(z, tx, ty), matrix });
    }
  }
  return { z, count: tiles.length, tiles };
}
