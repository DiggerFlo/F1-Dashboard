import { useEffect, useState } from 'react';
import { t, tl } from '../../js/i18n.js';

/** Speichen eines Rades (dreht sich), Mittelpunkt (cx, cy) und Radius der Felge. */
const Spokes = ({ cx, cy, r }) => (
  <g className="lwheel" style={{ transformOrigin: `${cx}px ${cy}px` }} stroke="#9a9aa6" strokeWidth="1.6">
    <path d={`M${cx} ${cy - r}L${cx} ${cy + r}M${cx - r} ${cy}L${cx + r} ${cy}M${cx - r * 0.7} ${cy - r * 0.7}L${cx + r * 0.7} ${cy + r * 0.7}M${cx + r * 0.7} ${cy - r * 0.7}L${cx - r * 0.7} ${cy + r * 0.7}`} />
  </g>
);

/** Formelwagen in Seitenansicht (selbst gezeichnet): Räder drehen, Fahrtwind zieht nach hinten. */
function Car() {
  return (
    <svg className="lcar" viewBox="0 0 420 108" width="360" height="93" aria-hidden="true">
      <defs>
        <linearGradient id="lg-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff3550" /><stop offset=".55" stopColor="#e8112d" /><stop offset="1" stopColor="#9c0b20" /></linearGradient>
        <linearGradient id="lg-pod" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c70f27" /><stop offset="1" stopColor="#7d0a1a" /></linearGradient>
        <radialGradient id="lg-shadow" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#000" stopOpacity=".7" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
      </defs>
      <g className="lwind" stroke="#9a9aa6" strokeWidth="2" strokeLinecap="round">
        <line x1="14" y1="46" x2="-30" y2="46" /><line x1="22" y1="60" x2="-50" y2="60" /><line x1="20" y1="76" x2="-36" y2="76" /><line x1="30" y1="90" x2="-24" y2="90" />
      </g>
      <ellipse cx="215" cy="104" rx="190" ry="6" fill="url(#lg-shadow)" />
      <g className="lbody">
        <path d="M26 26 L56 26 L60 60 L30 62 Z" fill="url(#lg-pod)" stroke="#f5f5f3" strokeWidth="1.2" />
        <path d="M34 34 L56 34" stroke="#f5f5f3" strokeWidth="1.5" />
        <rect x="30" y="22" width="30" height="4" fill="#17171c" />
        <path d="M54 62 L72 78" stroke="#4a4a56" strokeWidth="3" />
        <path d="M62 98 L84 90 L340 92 L388 96 L388 99 L62 99 Z" fill="#17171c" />
        <path d="M66 92 L66 66 C88 62 120 56 150 47 L166 38 L190 36 L200 46 C212 52 236 55 252 61 L334 80 L384 85 L384 91 L300 93 Z" fill="url(#lg-body)" />
        <path d="M66 66 C88 62 120 56 150 47 L166 38 L190 36 L200 46 C212 52 236 55 252 61 L334 80 L384 85" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.6" />
        <path d="M150 70 C168 60 204 58 232 66 L252 78 L246 90 L150 92 Z" fill="url(#lg-pod)" />
        <path d="M196 64 C210 62 226 64 236 70 L228 80 L192 80 Z" fill="#0b0b0e" />
        <path d="M166 38 L174 24 Q184 20 192 34 Z" fill="#7d0a1a" />
        <path d="M174 25 Q182 22 188 31 L176 33 Z" fill="#0b0b0e" />
        <path d="M96 76 C130 70 170 66 214 74" fill="none" stroke="#f5f5f3" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="222" cy="50" r="8" fill="#f5f5f3" />
        <path d="M224 46 L232 48 L231 54 L222 53 Z" fill="#17171c" />
        <path d="M206 56 Q226 30 252 62" fill="none" stroke="#4a4a56" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M334 86 L396 84 L400 99 L338 99 Z" fill="url(#lg-pod)" stroke="#f5f5f3" strokeWidth="1.2" />
        <path d="M342 92 L394 90" stroke="#f5f5f3" strokeWidth="1.5" />
        <circle cx="96" cy="76" r="25" fill="#0b0b0e" stroke="#e8112d" strokeWidth="2.4" />
        <circle cx="96" cy="76" r="15" fill="#2a2a32" />
        <Spokes cx={96} cy={76} r={14} />
        <circle cx="96" cy="76" r="4" fill="#9a9aa6" />
        <circle cx="318" cy="79" r="21" fill="#0b0b0e" stroke="#e8112d" strokeWidth="2.2" />
        <circle cx="318" cy="79" r="13" fill="#2a2a32" />
        <Spokes cx={318} cy={79} r={12} />
        <circle cx="318" cy="79" r="3.5" fill="#9a9aa6" />
      </g>
    </svg>
  );
}

/** Ladeanzeige mit fahrendem Auto, Titel und Hinweis. */
export function Loader({ title, sub, children }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <Car />
      <div className="lroad" aria-hidden="true" />
      <strong className="ltitle">{title}</strong>
      {sub && <span className="lsub">{sub}</span>}
      {children}
    </div>
  );
}

/** Nach einigen Sekunden: ehrlicher Hinweis, warum es dauert (OpenF1 begrenzt Anfragen ohne Token). */
function SlowHint() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(t); }, []);
  return slow ? <span className="lhint" role="status">{t('loader.slow')}</span> : null;
}

/** Halbtransparente Ebene über dem Inhalt (unter der Kopfzeile) beim Seitenwechsel, bis die Daten da sind. */
export function LoadingOverlay({ label }) {
  return (
    <div className="overlay">
      <Loader title={t('loader.title', { label: tl(label) })} sub={t('loader.sub')}><SlowHint /></Loader>
    </div>
  );
}
