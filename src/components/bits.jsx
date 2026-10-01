import { Card, Progress, Statistic, Tag } from 'antd';
import { useState } from 'react';
import { safeColor, fmtSector } from '../../js/format.js';
import { tyreInfo, teamColor } from '../../js/teams.js';
import { t } from '../../js/i18n.js';

/** Fertiges SVG aus js/track.js einsetzen (alle Texte darin sind dort bereits escaped). */
export function Html({ html, className }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Reifen in den Pirelli-Farben: Soft rot, Medium gelb, Hard weiß, Intermediate grün, Wet blau. */
export function Tyre({ c }) {
  const ty = tyreInfo(c);
  return <span className="tyre" style={ty ? { '--tyre': ty.color } : undefined} title={ty ? ty.name : t('tyre.unknown')}>{(c || '?')[0].toUpperCase()}</span>;
}

/** Teamfarbe als schmaler Balken; `color` aus den Live-Daten, sonst aus dem Teamnamen abgeleitet. */
export function Swatch({ color, team }) {
  return <span className="tc" style={{ background: safeColor(color) || teamColor(team) || 'var(--line)' }} title={team || undefined} aria-hidden="true" />;
}

/** Fahrerfoto (offizielles Porträt) mit Teamfarbe als Unterkante; ohne Foto oder bei Ladefehler nichts. */
export function Avatar({ d, size = 28 }) {
  const [bad, setBad] = useState(false);
  if (!d?.photo || bad) return null;
  return (
    <span className="avatar" style={{ width: `${size / 16}rem`, height: `${size / 16}rem`, '--ac': safeColor(d.color) || teamColor(d.team) || 'var(--line)' }}>
      <img src={d.photo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />
    </span>
  );
}

/** Fahrerbild: Foto, sonst eine Kachel in Teamfarbe mit dem Kürzel. */
export function Face({ d, size = 42 }) {
  if (d?.photo) return <Avatar d={d} size={size} />;
  const ac = safeColor(d?.color) || teamColor(d?.team) || 'var(--line)';
  return <span className="face" style={{ '--ac': ac, width: `${size / 16}rem`, height: `${size / 16}rem`, fontSize: `${(size * 0.36) / 16}rem` }} aria-hidden="true">{(d?.code || '?').slice(0, 3)}</span>;
}

export function CodeCell({ d }) {
  return (
    <>
      <Avatar d={d} size={26} />
      <Swatch color={d.color} team={d.team} />
      <span className="code" title={[d.name, d.team].filter(Boolean).join(' · ')}>{d.code}</span>
    </>
  );
}

export const Sector = ({ v, cls }) => (cls ? <span className={cls}>{fmtSector(v)}</span> : fmtSector(v));

export const Bar = ({ v, brake }) => (
  <Progress percent={Math.round(v || 0)} showInfo={false} size={[44, 6]} strokeLinecap="butt" strokeColor={brake ? '#9a9aa6' : '#f5f5f3'} trailColor="#2e2e37" style={{ margin: 0, width: 44 }} />
);

export const Badge = ({ kind, children }) => <Tag className={`badge ${kind || ''}`} bordered>{children}</Tag>;

export function Kpi({ label, value, delta, cls = '', accent = null, who = null }) {
  return (
    <Card className={`kpi${who?.photo ? ' has-photo' : ''}`} size="small" style={accent ? { '--accent': accent } : undefined}>
      <Statistic title={label} value={value} groupSeparator="" />
      <span className={`d ${cls}`}>{delta}</span>
      {who?.photo && <span className="kphoto"><Avatar d={who} size={72} /></span>}
    </Card>
  );
}

export function Section({ title, meta, label, children }) {
  return (
    <section className="sec" aria-label={label || title}>
      <div className="sech"><h2>{title}</h2>{meta && <span className="meta">{meta}</span>}</div>
      {children}
    </section>
  );
}

export const WarnIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 6.5v3.5M8 12v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
