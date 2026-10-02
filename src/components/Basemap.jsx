import { useMemo } from 'react';
import { trackView } from '../../js/track.js';
import { planBasemap, STYLES } from '../../js/basemap.js';

/**
 * Kartenhintergrund hinter dem Streckenlayout: Rasterkacheln, die per Matrix so gelegt sind, dass das Layout auf der echten Strecke liegt.
 * Nutzt dieselbe viewBox wie die Streckenebene (trackView), beide Ebenen liegen deckungsgleich übereinander (siehe .mapstack in styles.css).
 * Die Ebene hängt nur an Strecke, Ausrichtung und Stil, nicht an den Fahrerdaten: React fasst sie bei neuen Zuständen nicht an.
 */
export function Basemap({ track, geo, style }) {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const plan = useMemo(() => {
    const v = trackView(track);
    const p = planBasemap({ view: v, rot: v.rotation, geo, style, dpr });
    return p && { v, p };
  }, [track.points, track.rotate, geo, style, dpr]);
  if (!plan) return null;
  const { v, p } = plan;
  const st = STYLES[style] || STYLES.map;
  return (
    <svg className={`basemap bm-${style}`} viewBox={`${v.vx} ${v.vy} ${v.vw} ${v.vh}`} aria-hidden="true" focusable="false" style={{ '--ar': (v.vw / v.vh).toFixed(4), ...(st.filter !== 'none' ? { filter: st.filter } : null) }}>
      <g transform={`rotate(${v.rotation.deg} ${v.rotation.cx} ${v.rotation.cy})`}>
        {p.tiles.map((tile) => <image key={tile.key} href={tile.href} width="256.6" height="256.6" preserveAspectRatio="none" transform={`matrix(${tile.matrix.join(' ')})`} />)}
      </g>
    </svg>
  );
}
