// Zuordnung Session -> Streckenlayout (Daten aus julesr0y/f1-circuits-svg, CC BY 4.0, siehe public/data/ATTRIBUTION.md).

export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Namen aus OpenF1 (circuit_short_name / location / Land) -> Strecken-ID im Layout-Datensatz.
const ALIASES = {
  'sakhir': 'bahrain', 'bahrain': 'bahrain', 'jeddah': 'jeddah', 'melbourne': 'melbourne', 'albert park': 'melbourne',
  'suzuka': 'suzuka', 'shanghai': 'shanghai', 'miami': 'miami', 'miami gardens': 'miami', 'imola': 'imola', 'monaco': 'monaco', 'monte carlo': 'monaco',
  'catalunya': 'catalunya', 'barcelona': 'catalunya', 'montmelo': 'catalunya', 'montreal': 'montreal', 'spielberg': 'spielberg', 'red bull ring': 'spielberg',
  'silverstone': 'silverstone', 'spa francorchamps': 'spa-francorchamps', 'spa': 'spa-francorchamps', 'hungaroring': 'hungaroring', 'budapest': 'hungaroring',
  'zandvoort': 'zandvoort', 'monza': 'monza', 'baku': 'baku', 'singapore': 'marina-bay', 'marina bay': 'marina-bay', 'austin': 'austin', 'mexico city': 'mexico-city',
  'interlagos': 'interlagos', 'sao paulo': 'interlagos', 'las vegas': 'las-vegas', 'lusail': 'lusail', 'losail': 'lusail', 'yas marina': 'yas-marina',
  'yas island': 'yas-marina', 'abu dhabi': 'yas-marina', 'madrid': 'madring', 'madring': 'madring', 'sochi': 'sochi', 'istanbul': 'istanbul', 'portimao': 'portimao',
  'mugello': 'mugello', 'nurburgring': 'nurburgring', 'le castellet': 'paul-ricard', 'paul ricard': 'paul-ricard', 'sepang': 'sepang', 'hockenheim': 'hockenheimring',
};

export function seasonsInclude(str, year) {
  return String(str || '').split(',').some((p) => {
    const [a, b] = p.trim().split('-').map(Number);
    return b ? year >= a && year <= b : year === a;
  });
}

/** Sucht in db ({id: {name, layouts:[{id,seasons,rotate,d}]}}) das Layout zur Session. */
export function findLayout(db, session, year = new Date().getFullYear()) {
  const keys = [session.circuit_short_name, session.location, session.country_name].map(norm).filter(Boolean);
  let id = null;
  for (const k of keys) { if (ALIASES[k]) { id = ALIASES[k]; break; } }
  if (!id) id = Object.keys(db).find((cid) => keys.includes(norm(cid)));
  const c = id && db[id];
  if (!c) return null;
  const y = Number(session.year) || year;
  const layout = c.layouts.find((l) => seasonsInclude(l.seasons, y)) || c.layouts[c.layouts.length - 1];
  return { circuit: c.name, ...layout };
}
