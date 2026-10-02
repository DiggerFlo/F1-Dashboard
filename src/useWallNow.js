import { useEffect, useRef, useState } from 'react';

/**
 * Laufende Uhr für Anzeigen, die zwischen zwei Datenständen weiterzählen sollen (Countdown, vergangene Zeit).
 * anchorNow: Zeit des letzten Zustands (state.now); dazu kommt die seither vergangene Wanduhr-Zeit. enabled = false schaltet das Ticken aus.
 */
export function useWallNow(anchorNow, enabled = true) {
  const a = useRef({ now: null, wall: 0 });
  if (a.current.now !== anchorNow || a.current.wall === 0) a.current = { now: anchorNow, wall: Date.now() }; // Anker nur bei neuem Datenstand
  const [, tick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [enabled]);
  return anchorNow == null ? Date.now() : anchorNow + (Date.now() - a.current.wall);
}
