import { useSyncExternalStore } from 'react';

// Schmale Bildschirme (Handy): gleiche Grenze wie die Mobil-Regeln in styles.css (max-width: 700px).
const QUERY = '(max-width: 700px)';
const subscribe = (fn) => { const m = matchMedia(QUERY); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); };
const read = () => { try { return matchMedia(QUERY).matches; } catch { return false; } };

/** true auf schmalen Bildschirmen; rendert neu, wenn sich das ändert (Drehen, Fenstergröße). */
export const useNarrow = () => useSyncExternalStore(subscribe, read, () => false);
