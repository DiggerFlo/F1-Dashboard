import { useState } from 'react';
import { Button, Segmented } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { fmtLap, fmtGap, safeColor } from '../../js/format.js';
import { tracesSvg } from '../../js/track.js';
import { teamColor, tyreInfo } from '../../js/teams.js';
import { FUEL_GAIN } from '../../js/tyres.js';
import { t, dec } from '../../js/i18n.js';
import { Html, Face, Tyre } from './bits.jsx';
import { ShiftLights, Pedal, modeOf } from './Main.jsx';

const DEG_HIGH = 0.08, DEG_LOW = 0.04; // s pro Runde: ab hier gilt der Abbau als hoch bzw. gering

/** Abbau mit Vorzeichen, z. B. "+0,062 s". */
const fmtDeg = (v) => (v == null ? '—' : `${v < 0 ? '−' : '+'}${dec(Math.abs(v).toFixed(3))} s`);
const degLevel = (v) => (v == null ? null : v >= DEG_HIGH ? 'high' : v <= DEG_LOW ? 'low' : 'mid');
const lapsText = (n) => t('dp.laps', { n });

/** Rundenzeiten des Stints als Balken (Abstand zur besten sauberen Runde, höher = langsamer) mit Trendlinie. */
function LapBars({ stint, color }) {
  const rows = stint?.times || [];
  if (!rows.length) return <p className="dp-empty muted">{t('dp.noLaps')}</p>;
  const good = rows.filter((r) => r.ok);
  const base = good.length ? Math.min(...good.map((r) => r.t)) : Math.min(...rows.map((r) => r.t));
  const cap = Math.max(0.5, ...good.map((r) => r.t - base)) * 1.2;
  const W = 320, H = 96, top = 6, bot = 18, bw = Math.min(14, (W - 8) / rows.length), gap = Math.min(3, bw * 0.25);
  const x = (i) => 4 + i * bw;
  const hOf = (d) => 4 + (Math.min(Math.max(d, 0), cap) / cap) * (H - top - bot - 4);
  // Trendlinie durch die sauberen Runden
  let line = null;
  if (good.length >= 2) {
    const n = good.length, mx = good.reduce((a, r) => a + r.n, 0) / n, my = good.reduce((a, r) => a + r.t, 0) / n;
    const den = good.reduce((a, r) => a + (r.n - mx) ** 2, 0);
    if (den) { const b = good.reduce((a, r) => a + (r.n - mx) * (r.t - my), 0) / den, a0 = my - b * mx; line = [rows[0], rows[rows.length - 1]].map((r) => [x(rows.indexOf(r)) + bw / 2, H - bot - hOf(a0 + b * r.n - base)]); }
  }
  return (
    <svg className="dp-bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('dp.chartAria')} style={{ '--tc': color }}>
      <line x1="0" x2={W} y1={H - bot} y2={H - bot} stroke="var(--line)" />
      {rows.map((r, i) => {
        const h = hOf(r.t - base);
        const tip = `${t('dp.lap', { n: r.lap })}: ${fmtLap(r.t)} (${r.t - base >= 0 ? '+' : '−'}${dec(Math.abs(r.t - base).toFixed(3))} s)${r.why ? ` · ${t(`dp.why.${r.why}`)}` : ''}`;
        return (
          <g key={r.lap}>
            <title>{tip}</title>
            <rect className={r.ok ? 'dp-ok' : 'dp-no'} x={x(i) + gap / 2} y={H - bot - h} width={Math.max(1, bw - gap)} height={h} />
          </g>
        );
      })}
      {line && <polyline points={line.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')} fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="4 3" />}
      <text x="4" y={H - 4} className="dp-ax">{t('dp.lap', { n: rows[0].lap })}</text>
      <text x={W - 4} y={H - 4} textAnchor="end" className="dp-ax">{t('dp.lap', { n: rows[rows.length - 1].lap })}</text>
    </svg>
  );
}

/** Reifenstrategie: ein Streifen pro Stint, Breite nach Runden. */
function Timeline({ stints, total }) {
  const sum = Math.max(total || 0, stints.reduce((a, s) => a + s.length, 0), 1);
  return (
    <div className="dp-tl" role="img" aria-label={t('dp.timeline')}>
      {stints.filter((s) => s.length > 0).map((s) => {
        const ty = tyreInfo(s.compound);
        return (
          <span key={s.n} className={`dp-st${s.current ? ' dp-now' : ''}`} style={{ flexGrow: s.length, '--tyre': ty?.color || 'var(--ink-muted)' }} title={`${ty?.name || t('tyre.unknown')} · ${lapsText(s.length)}`}>
            <b>{(s.compound || '?')[0]}</b><i>{s.length}</i>
          </span>
        );
      })}
      {total > 0 && sum > stints.reduce((a, s) => a + s.length, 0) && <span className="dp-st dp-rest" style={{ flexGrow: sum - stints.reduce((a, s) => a + s.length, 0) }} />}
    </div>
  );
}

export function TyresTab({ d, state, color }) {
  const ty = d.tyres;
  const cur = ty?.cur;
  if (!cur) return <p className="dp-empty muted">{t('dp.noTyres')}</p>;
  const lvl = degLevel(cur.deg);
  const info = tyreInfo(cur.compound);
  const history = ty.stints.filter((s) => s.length > 0 || s.current);
  return (
    <div className="dp-tyres">
      <div className="dp-cur">
        <span className="dp-ty"><Tyre c={cur.compound} /></span>
        <div className="dp-curt"><strong>{info?.name || t('tyre.unknown')}</strong><span className="muted">{t('dp.stintN', { n: cur.n })}{d.stops != null ? ` · ${t('tele.stops', { n: d.stops })}` : ''}</span></div>
      </div>
      <dl className="dp-facts">
        <div><dt className="label">{t('dp.stintLen')}</dt><dd className="mono">{lapsText(cur.length)}</dd></div>
        <div><dt className="label">{t('dp.age')}</dt><dd className="mono">{lapsText(cur.age)}{cur.ageAtStart > 0 ? <small className="muted"> ({t('dp.usedAt', { n: cur.ageAtStart })})</small> : null}</dd></div>
        <div><dt className="label">{t('dp.deg')}</dt><dd className={`mono ${lvl === 'high' ? 'y' : ''}`}>{fmtDeg(cur.deg)}<small className="muted"> {t('dp.perLap')}</small></dd></div>
        <div><dt className="label">{t('dp.degLevel')}</dt><dd>{lvl ? <span className={`dp-lvl ${lvl}`}>{t(`dp.deg.${lvl}`)}</span> : <span className="muted">{t('dp.degNone')}</span>}</dd></div>
        <div><dt className="label">{t('dp.bestStint')}</dt><dd className="mono">{fmtLap(cur.best)}</dd></div>
        <div><dt className="label">{t('dp.avgStint')}</dt><dd className="mono">{fmtLap(cur.avg)}</dd></div>
      </dl>
      <div className="dp-sub"><span className="label">{t('dp.chart')}</span><span className="muted">{t('dp.chartHint')}</span></div>
      <LapBars stint={cur} color={color} />
      <div className="dp-legend muted"><span><i className="dp-ok" style={{ background: color }} />{t('dp.legendOk')}</span><span><i className="dp-no" />{t('dp.legendSkip')}</span><span><i className="dp-trend" />{t('dp.legendTrend')}</span></div>
      <div className="dp-sub"><span className="label">{t('dp.timeline')}</span></div>
      <Timeline stints={history} total={state.session.type === 'race' ? state.session.totalLaps : 0} />
      {history.length > 1 && (
        <table className="dp-tbl">
          <thead><tr><th>{t('dp.tbl.stint')}</th><th>{t('dp.tbl.tyre')}</th><th className="r">{t('dp.tbl.laps')}</th><th className="r">{t('dp.tbl.deg')}</th><th className="r">{t('dp.tbl.best')}</th></tr></thead>
          <tbody>
            {history.map((s) => (
              <tr key={s.n} className={s.current ? 'dp-now' : ''}>
                <td className="mono">{s.n}</td><td><Tyre c={s.compound} /></td><td className="mono r">{s.length}</td>
                <td className={`mono r ${degLevel(s.deg) === 'high' ? 'y' : ''}`}>{fmtDeg(s.deg)}</td><td className="mono r">{fmtLap(s.best)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="dp-method muted">{t('dp.method', { fuel: dec(FUEL_GAIN.toFixed(2)) })}</p>
    </div>
  );
}

export function LiveTab({ d, state, hist, refHist, color }) {
  const isQ = state.session.type === 'quali';
  const mode = modeOf(state, d);
  const h = hist.get(d.num) || [];
  const hasSpeed = d.speed != null;
  return (
    <div className="dp-live">
      <div className="dp-speed">
        <div className="dp-big"><span className="tv">{hasSpeed ? Math.round(d.speed) : '—'}</span><small>{t('unit.kmh')}</small></div>
        <div className="dp-gear" title={t('tbl.gear')}><span className="label">{t('tbl.gear')}</span><span className="tv">{d.gear == null ? '—' : d.gear === 0 ? 'N' : d.gear}</span></div>
      </div>
      <span className="sbar2"><i style={{ width: `${hasSpeed ? Math.min(100, (d.speed / 350) * 100) : 0}%` }} /></span>
      <div className="dp-rpm"><ShiftLights rpm={d.rpm} /><span className="mono trv">{d.rpm != null ? `${dec((d.rpm / 1000).toFixed(1))}k` : '—'} <span className="muted">{t('tele.rpmUnit')}</span></span></div>
      <div className="dp-pedals"><Pedal label={t('tele.throttle')} v={d.throttle} cls="th" /><Pedal label={t('tele.brake')} v={d.brake} cls="br" /></div>
      <div className={`dp-mode${mode.on ? ' on' : ''}`}><span className="label">{mode.label}</span><strong>{mode.value}</strong>{mode.note && <span className="muted mono">{mode.note}</span>}</div>
      <Html className="dp-chart" html={tracesSvg(h, isQ ? refHist : null, color, true)} />
      <div className="legend">
        <span><i style={{ background: color }} />{t('tele.speed')}</span><span><i style={{ background: 'rgba(245,245,243,.5)' }} />{t('tele.throttle')}</span><span><i style={{ background: 'var(--race-red)' }} />{t('tele.brake')}</span>
        {isQ && <span><i style={{ background: 'var(--tp)' }} />{t('tele.poleLap')}</span>}
      </div>
      <dl className="dp-facts">
        <div><dt className="label">{t('tbl.lastLap')}</dt><dd className="mono">{fmtLap(d.last)}</dd></div>
        <div><dt className="label">{t('tele.bestLap')}</dt><dd className="mono">{fmtLap(d.best)}</dd></div>
        <div><dt className="label">{isQ ? t('tbl.gap') : t('tbl.interval')}</dt><dd className="mono">{d.pos === 1 ? '—' : fmtGap(isQ ? d.gap : d.interval)}</dd></div>
        <div><dt className="label">{t('tbl.tyre')}</dt><dd>{d.tyre ? <Tyre c={d.tyre} /> : '—'}</dd></div>
      </dl>
    </div>
  );
}

/**
 * Fahrer-Panel unter den Ereignissen in der Seitenleiste: Live-Werte (Gas, Bremse, Drehzahl, Verlauf) und Reifen
 * (Stint-Länge, Reifenalter, Abbau pro Runde). Folgt dem in Tabelle, Spitzengruppe oder Karte gewählten Fahrer.
 */
export function DriverPanel({ state, sel, hist, refHist, open = true, onToggle }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('pitwall.dptab') === 'tyres' ? 'tyres' : 'live'; } catch { return 'live'; } });
  const pick = (v) => { setTab(v); try { localStorage.setItem('pitwall.dptab', v); } catch { /* optional */ } };
  const d = state.drivers.find((x) => x.num === sel) || state.drivers[0];
  if (!d) return null;
  const col = safeColor(d.color) || teamColor(d.team) || '#f5f5f3';
  const posTxt = d.pos != null && d.pos < 90 ? `P${d.pos}` : '–';
  return (
    <section className={`dpanel${open ? '' : ' closed'}`} style={{ '--tc': col }} aria-label={t('tele.aria', { code: d.code })}>
      <div className="dp-head">
        <Face d={d} size={44} />
        <div className="dp-who"><span className="code">{d.code}</span><span className="muted">{d.name || d.code}{d.team ? ` · ${d.team}` : ''}</span></div>
        <span className="dp-pos">{posTxt}</span>
        <Button type="text" size="small" className="dp-toggle" aria-expanded={open} aria-label={open ? t('dp.collapse') : t('dp.expand')} title={open ? t('dp.collapse') : t('dp.expand')} icon={open ? <DownOutlined /> : <UpOutlined />} onClick={onToggle} />
      </div>
      {open && (
        <>
          <Segmented block size="small" className="dp-seg" value={tab} onChange={pick} aria-label={t('dp.tabs')}
            options={[{ value: 'live', label: t('dp.tab.live') }, { value: 'tyres', label: t('dp.tab.tyres') }]} />
          <div className="dp-body">
            {tab === 'tyres' ? <TyresTab d={d} state={state} color={col} /> : <LiveTab d={d} state={state} hist={hist} refHist={refHist} color={col} />}
          </div>
        </>
      )}
    </section>
  );
}
