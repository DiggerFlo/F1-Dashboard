import { useSyncExternalStore } from 'react';

// Skalierung der Oberfläche: Die Wurzelschrift wächst auf großen Bildschirmen (siehe styles.css, 16 px = 1), alles in rem folgt.
// Ant Design rechnet in px; sein Theme wird mit demselben Faktor skaliert (siehe theme.js).
const read = () => { try { return Math.round((parseFloat(getComputedStyle(document.documentElement).fontSize) / 16) * 1000) / 1000 || 1; } catch { return 1; } };
const subscribe = (fn) => { addEventListener('resize', fn); return () => removeEventListener('resize', fn); };

/** Faktor 1 bis 1,3 aus der aktuellen Wurzelschrift (16 px = 1). */
export const useScale = () => useSyncExternalStore(subscribe, read, () => 1);
