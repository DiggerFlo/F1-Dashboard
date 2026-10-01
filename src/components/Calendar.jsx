import { Alert, Card, Select, Tag } from 'antd';
import { findLayout } from '../../js/circuits.js';
import { samplePath } from '../../js/svgpath.js';
import { miniTrackSvg } from '../../js/track.js';
import { yearsFor } from '../../js/calendar.js';
import { Html } from './bits.jsx';

const miniCache = new Map();
function miniFor(db, race) {
  const k = `${race.circuit}|${race.location}|${race.year}`;
  if (miniCache.has(k)) return miniCache.get(k);
  let svg = '';
  const l = db && findLayout(db, { circuit_short_name: race.circuit, location: race.location, country_name: race.country, year: race.year }, race.year);
  if (l) svg = miniTrackSvg(samplePath(l.d, 140), l.rotate, `Streckenlayout ${race.meeting}`);
  miniCache.set(k, svg);
  return svg;
}

const fmt = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: '2-digit', month: 'short' });

function RaceCard({ r, db, onOpen }) {
  const open = () => onOpen?.(r);
  return (
    <Card
      hoverable role="button" tabIndex={0} data-race={r.round}
      className={`race${r.status === 'done' ? ' done' : ''}${r.next ? ' next' : ''}`}
      aria-label={`Runde ${r.round}: ${r.meeting}, ${fmt.format(r.start)}`}
      onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
    >
      <span className="rn disp">{String(r.round).padStart(2, '0')}</span>
      <span className="rt">
        <strong className="title">{r.meeting}</strong>
        <span className="muted">{[r.location, r.country].filter(Boolean).join(' · ')}</span>
        <span className="mono">{fmt.format(r.start)}</span>
        <span className="chips">
          {r.next && r.status !== 'live' && <Tag bordered>Nächstes Rennen</Tag>}
          {r.status === 'live' && <Tag bordered color="error"><span className="dot red" />Live</Tag>}
          {r.status === 'done' && <Tag bordered>Beendet</Tag>}
        </span>
      </span>
      <Html className="rm" html={miniFor(db, r)} />
    </Card>
  );
}

/** Rennkalender eines Jahres. cal = { year, races, demo } oder null während des Ladens. */
export function Calendar({ cal, ui, db, actions = {} }) {
  const head = (
    <div className="sech">
      <h2>Rennkalender</h2>
      <label className="label yearsel">Saison
        <Select size="small" value={ui.year} onChange={(y) => actions.year?.(y)} aria-label="Saison wählen" style={{ width: 90 }} options={yearsFor().map((y) => ({ value: y, label: y }))} />
      </label>
    </div>
  );
  if (!cal) return <div className="sec">{head}<div className="empty">Kalender wird geladen …</div></div>;
  if (cal.error) return <div className="sec">{head}<Alert type="warning" showIcon role="alert" message={cal.error} /></div>;
  if (!cal.races.length) return <div className="sec">{head}<div className="empty">Keine Rennen für {cal.year} gefunden.</div></div>;
  const done = cal.races.filter((r) => r.status === 'done').length;
  return (
    <div className="sec">
      {head}
      <p className="muted">{cal.races.length} Rennen · {done} beendet</p>
      <div className="cal">{cal.races.map((r) => <RaceCard key={`${r.round}-${r.circuit}`} r={r} db={db} onOpen={actions.openRace} />)}</div>
      {cal.source === 'jolpica' && <p className="meta muted">Termine: Jolpica F1. Vergangene Rennen lassen sich per Klick als Wiederholung (OpenF1) abspielen.</p>}
      {cal.demo && <p className="meta muted">Demo: Strecken des Jahres mit erfundenen Terminen, alle 14 Tage ab Mitte März. Echte Termine: ?source=openf1</p>}
    </div>
  );
}
