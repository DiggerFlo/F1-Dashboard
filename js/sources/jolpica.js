// Jolpica F1 (Nachfolger der Ergast-API, https://api.jolpi.ca): Saisonkalender, Wertungen, Ergebnisse.
// Ergänzt OpenF1, das Live-Timing und Telemetrie liefert, aber keine Meisterschaftsstände.
import { finishCalendar } from '../calendar.js';

const BASE = 'https://api.jolpi.ca/ergast/f1';
const TTL = 10 * 60 * 1000; // Das Limit liegt bei ca. 500 Anfragen pro Stunde, Wertungen ändern sich selten.

const pick = (d, ...path) => path.reduce((o, k) => (o == null ? o : o[k]), d);
const stamp = (o, fallbackTime = '12:00:00Z') => (o?.date ? Date.parse(`${o.date}T${o.time || fallbackTime}`) : NaN);

/** Fahrerwertung -> [{ pos, code, name, team, points, wins }] */
export function mapDriverStandings(data) {
  const rows = pick(data, 'MRData', 'StandingsTable', 'StandingsLists', 0, 'DriverStandings') || [];
  return rows.map((r) => ({
    pos: Number(r.position), code: r.Driver?.code || String(r.Driver?.familyName || '').slice(0, 3).toUpperCase(),
    name: `${r.Driver?.givenName || ''} ${r.Driver?.familyName || ''}`.trim(), team: r.Constructors?.[r.Constructors.length - 1]?.name || null,
    points: Number(r.points), wins: Number(r.wins),
  }));
}

/** Konstrukteurswertung -> [{ pos, team, points, wins }] */
export function mapConstructorStandings(data) {
  const rows = pick(data, 'MRData', 'StandingsTable', 'StandingsLists', 0, 'ConstructorStandings') || [];
  return rows.map((r) => ({ pos: Number(r.position), team: r.Constructor?.name || '', points: Number(r.points), wins: Number(r.wins) }));
}

/** Rennen einer Saison -> Kalendereinträge (siehe calendar.js) inkl. Zeitplan der Sessions. */
export function mapRaces(data) {
  const races = pick(data, 'MRData', 'RaceTable', 'Races') || [];
  return races.map((r) => {
    const start = stamp(r);
    const sessions = [['Training 1', r.FirstPractice], ['Training 2', r.SecondPractice], ['Training 3', r.ThirdPractice], ['Sprint-Quali', r.SprintQualifying ?? r.SprintShootout],
      ['Sprint', r.Sprint], ['Qualifying', r.Qualifying], ['Rennen', { date: r.date, time: r.time }]]
      .map(([name, o]) => [name, stamp(o)]).filter(([, t]) => isFinite(t));
    return {
      key: null, jolpica: true, round: Number(r.round), meeting: r.raceName, official: r.Circuit?.circuitName || '', location: r.Circuit?.Location?.locality || '',
      country: r.Circuit?.Location?.country || '', circuit: r.Circuit?.circuitId || '', circuitName: r.Circuit?.circuitName || '', year: Number(r.season),
      start, end: start + 2 * 3600000, sessions,
    };
  }).filter((r) => isFinite(r.start));
}

/** Kalender aus Jolpica; OpenF1-Rennsessions (gleicher Tag ± 1 Tag) liefern den Schlüssel zum Abspielen. */
export function buildJolpicaCalendar(races, openf1Races = [], now = Date.now()) {
  const list = races.map((r) => {
    const o = openf1Races.find((x) => Math.abs(x.start - r.start) < 86400000 * 1.5 && x.key != null);
    return o ? { ...r, key: o.key, start: o.start, end: o.end } : { ...r };
  });
  return finishCalendar(list, now);
}

/** Letztes Rennen -> { name, podium:[{pos, code, team, time}] } */
export function mapLastResult(data) {
  const race = pick(data, 'MRData', 'RaceTable', 'Races', 0);
  if (!race) return null;
  return {
    name: race.raceName, round: Number(race.round),
    podium: (race.Results || []).slice(0, 3).map((x) => ({ pos: Number(x.position), code: x.Driver?.code || x.Driver?.familyName, team: x.Constructor?.name || null, time: x.Time?.time || x.status || '' })),
  };
}

export function createJolpica({ fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  const cache = new Map();
  async function get(path) {
    const hit = cache.get(path);
    if (hit && now() - hit.t < TTL) return hit.v;
    const r = await fetchImpl(`${BASE}/${path}`);
    if (!r.ok) throw new Error(`Jolpica ${r.status}`);
    const v = await r.json();
    cache.set(path, { t: now(), v });
    return v;
  }
  return {
    get,
    races: async (year) => mapRaces(await get(`${year}/races.json?limit=100`)),
    driverStandings: async (year = 'current') => mapDriverStandings(await get(`${year}/driverstandings.json?limit=40`)),
    constructorStandings: async (year = 'current') => mapConstructorStandings(await get(`${year}/constructorstandings.json?limit=20`)),
    lastResult: async (year = 'current') => mapLastResult(await get(`${year}/last/results.json?limit=3`)),
  };
}
