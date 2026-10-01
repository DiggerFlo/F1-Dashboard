// Zwischenspeicher für die Stammdaten beendeter OpenF1-Sessions (Fahrer, Runden, Boxenstopps, Race Control, Funk, Wetter, Positionen).
// Sie ändern sich nach dem Ende nicht mehr; OpenF1 erlaubt ohne Zugangsschlüssel nur etwa 30 Anfragen pro Minute, jede gesparte Anfrage zählt.
// Nur im Browser (localStorage), die Zeitfenster der Telemetrie sind zu groß und werden nicht gespeichert. Fehler sind nie kritisch.

const STATIC = /^(drivers|laps|stints|race_control|team_radio|weather|pit|position)\?session_key=(\d+)$/;

/** Session-Schlüssel, wenn der Pfad eine cachebare Stammdaten-Abfrage ist, sonst null. */
export const cacheKeyOf = (path) => (STATIC.exec(path) || [])[2] ?? null;

/**
 * storage: wie localStorage (getItem/setItem/removeItem), maxSessions: so viele Sessions bleiben gespeichert (älteste fliegen zuerst raus).
 * read(path) -> Daten oder undefined, write(path, data).
 */
export function createStaticCache(storage = globalThis.localStorage, { prefix = 'pitwall.of1.', maxSessions = 6 } = {}) {
  const idxKey = `${prefix}idx`;
  const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
  const readIdx = () => safe(() => JSON.parse(storage.getItem(idxKey) || '[]'), []); // [{ k, paths: [] }], neueste zuletzt
  const writeIdx = (i) => safe(() => storage.setItem(idxKey, JSON.stringify(i)));
  const drop = (entry) => entry.paths.forEach((p) => safe(() => storage.removeItem(prefix + p)));

  return {
    read(path) {
      if (!storage || cacheKeyOf(path) == null) return undefined;
      const raw = safe(() => storage.getItem(prefix + path), null);
      return raw == null ? undefined : safe(() => JSON.parse(raw), undefined);
    },
    write(path, data) {
      const k = cacheKeyOf(path);
      if (!storage || k == null) return false;
      let idx = readIdx();
      let e = idx.find((x) => x.k === k);
      if (!e) { e = { k, paths: [] }; idx.push(e); }
      else idx = [...idx.filter((x) => x !== e), e]; // zuletzt benutzt nach hinten
      while (idx.length > maxSessions) drop(idx.shift());
      try {
        storage.setItem(prefix + path, JSON.stringify(data));
        if (!e.paths.includes(path)) e.paths.push(path);
        writeIdx(idx);
        return true;
      } catch { // Speicher voll: alles Gespeicherte verwerfen, nichts kaputt machen
        idx.forEach(drop); writeIdx([]);
        return false;
      }
    },
  };
}
