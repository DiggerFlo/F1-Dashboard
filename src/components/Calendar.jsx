import { Alert, Card, Select, Tag } from 'antd';
import { findLayout } from '../../js/circuits.js';
import { samplePath } from '../../js/svgpath.js';
import { miniTrackSvg } from '../../js/track.js';
import { yearsFor } from '../../js/calendar.js';
import { Html } from './bits.jsx';
import { flagUrl } from '../flags.js';
import { t, locale, getLang } from '../../js/i18n.js';

const miniCache = new Map();
function miniFor(db, race) {
  const k = `${race.circuit}|${race.location}|${race.year}|${getLang()}`;
  if (miniCache.has(k)) return miniCache.get(k);
  let svg = '';
  const l = db && findLayout(db, { circuit_short_name: race.circuit, location: race.location, country_name: race.country, year: race.year }, race.year);
  if (l) svg = miniTrackSvg(samplePath(l.d, 140), l.rotate, t('map.layoutOf', { name: race.meeting }));
  miniCache.set(k, svg);
  return svg;
}

// Datumsformate folgen der Sprache (werden bei jedem Aufruf neu gebildet)
const fmt = { format: (d) => new Intl.DateTimeFormat(locale(), { weekday: 'short', day: '2-digit', month: 'short' }).format(d) };
const fmtDay = { format: (d) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(d) };

/** Karte für das nächste (oder laufende) Rennen: Flagge mit Verlauf, Countdown, Ort, Datum und Streckenlayout. */
function SeasonNext({ next, db, onOpen }) {
  if (!next) return <section className="snext" aria-label={t('cal.over')}><span className="label">{t('cal.over')}</span></section>;
  const flag = flagUrl(next.country);
  const live = next.status === 'live';
  const days = Math.max(0, Math.ceil((next.start - Date.now()) / 86400000));
  const cd = live ? t('cal.live') : days === 0 ? t('cal.today') : t('cal.days', { n: days });
  const open = () => onOpen?.(next);
  return (
    <section className="snext" role="button" tabIndex={0} aria-label={`${live ? t('cal.liveNow') : t('cal.nextRace')}: ${next.meeting}`} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
      {flag && <span className="rflag" style={{ backgroundImage: `url("${flag}")` }} aria-hidden="true" />}
      <span className="label eyebrow"><i />{live ? t('cal.liveNow') : t('cal.nextRace')} · {t('cal.roundN', { n: next.round })}</span>
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
    <section className="sbar" aria-label={t('cal.progress')}>
      <div className="sbar-head">
        <span className="label">{t('cal.seasonN', { year: races[0].year })}</span>
        <span className="sbar-pct mono">{pct} %</span>
      </div>
      <div className="sbar-big">
        <span className="disp">{done}</span>
        <span className="sbar-of">{t('cal.of', { n: races.length })}</span>
        <span className="sbar-left mono">{t('cal.open', { n: races.length - done })}</span>
      </div>
      <div className="sbar-track" role="img" aria-label={t('cal.done', { done, total: races.length })}>
        {races.map((r) => (
          <button key={`${r.round}-${r.circuit}`} type="button" className={`sseg ${r.status}${r.next ? ' next' : ''}`} title={t('cal.tipRound', { round: r.round, meeting: r.meeting, date: fmt.format(r.start) })} aria-label={t('cal.ariaRound', { round: r.round, meeting: r.meeting })} onClick={() => onOpen?.(r)} />
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
      aria-label={t('cal.ariaCard', { round: r.round, meeting: r.meeting, date: fmt.format(r.start) })}
      onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
    >
      {flag && <span className="rflag" style={{ backgroundImage: `url("${flag}")` }} aria-hidden="true" />}
      <span className="rn disp">{String(r.round).padStart(2, '0')}</span>
      <span className="rt">
        <strong className="title">{r.meeting}</strong>
        <span className="muted">{[r.location, r.country].filter(Boolean).join(' · ')}</span>
        <span className="mono">{fmt.format(r.start)}</span>
        <span className="chips">
          {r.next && r.status !== 'live' && <Tag bordered>{t('cal.nextRace')}</Tag>}
          {r.status === 'live' && <Tag bordered color="error"><span className="dot red" />{t('cal.live')}</Tag>}
          {r.status === 'done' && <Tag bordered>{t('cal.tagDone')}</Tag>}
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
      <h2>{t('cal.title')}</h2>
      <label className="label yearsel">{t('cal.season')}
        <Select size="small" value={ui.year} onChange={(y) => actions.year?.(y)} aria-label={t('cal.pickSeason')} style={{ width: '5.625rem' }} options={yearsFor().map((y) => ({ value: y, label: y }))} />
      </label>
    </div>
  );
  if (!cal) return <div className="sec">{head}<div className="empty">{t('cal.loading')}</div></div>;
  if (cal.error) return <div className="sec">{head}<Alert type="warning" showIcon role="alert" message={t('cal.error', { msg: cal.error })} /></div>;
  if (!cal.races.length) return <div className="sec">{head}<div className="empty">{t('cal.none', { year: cal.year })}</div></div>;
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
      {cal.source === 'jolpica' && <p className="meta muted">{t('cal.sourceNote')}</p>}
      {cal.demo && <p className="meta muted">{t('cal.demoNote')}</p>}
    </div>
  );
}
