import { Alert, Card, Select, Tag } from 'antd';
import { findLayout } from '../../js/circuits.js';
import { samplePath } from '../../js/svgpath.js';
import { miniTrackSvg } from '../../js/track.js';
import { yearsFor } from '../../js/calendar.js';
import { Html } from './bits.jsx';
import { flagUrl } from '../flags.js';

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
const fmtDay = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short' });

/** Karte für das nächste (oder laufende) Rennen: Flagge mit Verlauf, Countdown, Ort, Datum und Streckenlayout. */
function SeasonNext({ next, db, onOpen }) {
  if (!next) return <section className="snext" aria-label="Saison abgeschlossen"><span className="label">Saison abgeschlossen</span></section>;
  const flag = flagUrl(next.country);
  const live = next.status === 'live';
  const days = Math.max(0, Math.ceil((next.start - Date.now()) / 86400000));
  const cd = live ? 'Live' : days === 0 ? 'Heute' : `${days} ${days === 1 ? 'Tag' : 'Tage'}`;
  const open = () => onOpen?.(next);
  return (
    <section className="snext" role="button" tabIndex={0} aria-label={`${live ? 'Läuft gerade' : 'Nächstes Rennen'}: ${next.meeting}`} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
      {flag && <span className="rflag" style={{ backgroundImage: `url("${flag}")` }} aria-hidden="true" />}
      <span className="label eyebrow"><i />{live ? 'Läuft gerade' : 'Nächstes Rennen'} · Runde {next.round}</span>
      <strong className="snext-cd disp">{cd}</strong>
      <span className="snext-name">{next.meeting}</span>
      <span className="snext-meta">{[next.location, next.country].filter(Boolean).join(' · ')}<span className="mono"> · {fmt.format(next.start)}</span></span>
      <Html className="snext-map" html={miniFor(db, next)} />
    </section>
  );
}

/** Saisonfortschritt: ein Segment pro Rennen (beendet rot, nächstes hervorgehoben, Rest grau), Klick öffnet das Rennen. */
function SeasonBar({ races, onOpen }) {
  const done = races.filter((r) => r.status === 'done').length;
  const pct = Math.round((done / races.length) * 100);
  return (
    <section className="sbar" aria-label="Saisonfortschritt">
      <div className="sbar-head">
        <span className="label">Saison {races[0].year}</span>
        <span className="sbar-pct mono">{pct} %</span>
      </div>
      <div className="sbar-big">
        <span className="disp">{done}</span>
        <span className="sbar-of">von {races.length} Rennen beendet</span>
        <span className="sbar-left mono">{races.length - done} offen</span>
      </div>
      <div className="sbar-track" role="img" aria-label={`${done} von ${races.length} Rennen beendet`}>
        {races.map((r) => (
          <button key={`${r.round}-${r.circuit}`} type="button" className={`sseg ${r.status}${r.next ? ' next' : ''}`} title={`Runde ${r.round} · ${r.meeting} · ${fmt.format(r.start)}`} aria-label={`Runde ${r.round}: ${r.meeting}`} onClick={() => onOpen?.(r)} />
        ))}
      </div>
      <div className="sbar-foot mono"><span>{fmtDay.format(races[0].start)}</span><span>{fmtDay.format(races[races.length - 1].start)}</span></div>
    </section>
  );
}

function RaceCard({ r, db, onOpen }) {
  const open = () => onOpen?.(r);
  const flag = flagUrl(r.country);
  return (
    <Card
      hoverable role="button" tabIndex={0} data-race={r.round}
      className={`race${r.status === 'done' ? ' done' : ''}${r.next ? ' next' : ''}`}
      aria-label={`Runde ${r.round}: ${r.meeting}, ${fmt.format(r.start)}`}
      onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
    >
      {flag && <span className="rflag" style={{ backgroundImage: `url("${flag}")` }} aria-hidden="true" />}
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
  const next = cal.races.find((r) => r.next);
  const days = next ? Math.max(0, Math.ceil((next.start - Date.now()) / 86400000)) : null;
  const live = next?.status === 'live';
  return (
    <div className="sec">
      {head}
      <div className="shead">
        <SeasonBar races={cal.races} onOpen={actions.openRace} />
        <SeasonNext next={next} db={db} onOpen={actions.openRace} />
      </div>
      <div className="cal">{cal.races.map((r) => <RaceCard key={`${r.round}-${r.circuit}`} r={r} db={db} onOpen={actions.openRace} />)}</div>
      {cal.source === 'jolpica' && <p className="meta muted">Termine: Jolpica F1. Vergangene Rennen lassen sich per Klick als Wiederholung (OpenF1) abspielen.</p>}
      {cal.demo && <p className="meta muted">Demo: Strecken des Jahres mit erfundenen Terminen, alle 14 Tage ab Mitte März. Echte Termine: ?source=openf1</p>}
    </div>
  );
}
