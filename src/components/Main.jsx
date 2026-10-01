import { Card, Table } from 'antd';
import { fmtLap, fmtGap, fmtClock, splitCountdown, safeColor } from '../../js/format.js';
import { tracesSvg } from '../../js/track.js';
import { teamColor } from '../../js/teams.js';
import { fmtSecs, pitLossNote } from '../../js/pitstops.js';
import { flagUrl, countryOf } from '../flags.js';
import { t, tl, dec, locale } from '../../js/i18n.js';
import { sessionLabel, sameSession } from '../../js/sessions.js';
import { Html, Tyre, CodeCell, Sector, Bar, Badge, Kpi, Section, Swatch, Face } from './bits.jsx';
import { StateMap } from './MapCard.jsx';

function kpisFor(state) {
  const s = state.session, d = state.drivers, f = state.flag;
  const lead = d[0];
  let k;
  if (s.type === 'quali' || s.type === 'practice') {
    const pole = d.find((x) => x.best != null);
    const cut = s.cutoff ? d[s.cutoff - 1] : null;
    const on = d.filter((x) => x.onTrack).length;
    k = [
      [s.type === 'quali' ? t('kpi.pole') : t('kpi.best'), fmtLap(pole?.best), pole ? `${pole.code}${pole.team ? ' · ' + pole.team : ''}` : '—', pole ? 'p' : 'muted', pole],
      s.type === 'quali' ? [t('kpi.cutoff', { p: s.cutoff || '–' }), fmtLap(cut?.best), cut?.best && pole?.best ? t('kpi.toPole', { gap: (cut.best - pole.best).toFixed(3) }) : '—', cut?.best ? 'y' : 'muted']
        : [t('kpi.timedDrivers'), String(d.filter((x) => x.best != null).length), t('kpi.ofTotal', { n: d.length }), 'muted'],
      [t('kpi.remaining'), fmtClock(s.remaining), s.name ? sessionLabel(s.name) : '', 'muted'],
      [t('kpi.onTrack'), String(on), t('kpi.drivers'), 'muted']];
  } else if (f === 'red') {
    const stopped = d.filter((x) => (x.speed || 0) === 0).length;
    k = [
      [t('kpi.interruption'), fmtClock(s.flagSince ? (state.now - s.flagSince) / 1000 : null), t('kpi.sinceLap', { lap: s.lap || '–' }), 'y'],
      [t('kpi.carsStopped'), `${stopped}/${d.length}`, t('kpi.speedZero'), stopped === d.length ? 'g' : 'muted'],
      [t('kpi.tyreChange'), t('kpi.allowed'), t('kpi.pitClosed'), 'muted'],
      [t('kpi.restart'), '—', t('kpi.restartHint'), 'muted']];
  } else if (f === 'sc' || f === 'vsc') {
    const last = d[d.length - 1];
    k = [
      [f === 'sc' ? t('kpi.scSince') : t('kpi.vscSince'), fmtClock(s.flagSince ? (state.now - s.flagSince) / 1000 : null), t('kpi.lapN', { lap: s.lap || '–' }), 'y'],
      [t('kpi.fieldGap'), last?.gap != null ? `+${last.gap.toFixed(1)} s` : '—', t('kpi.leaderToLast'), 'muted'],
      [t('kpi.leader'), lead?.code || '—', `${lead?.team ? lead.team + ' · ' : ''}P1 · ${lead ? Math.round(lead.speed || 0) : 0} ${t('unit.kmh')}`, '', lead],
      [t('kpi.overtaking'), t('kpi.forbidden'), f === 'sc' ? t('kpi.safetyCar') : t('kpi.keepDelta'), 'y']];
  } else {
    const fastest = d.filter((x) => x.best != null).sort((a, b) => a.best - b.best)[0];
    k = [
      [s.type === 'race' ? t('kpi.lap') : t('kpi.session'), s.type === 'race' ? `${s.lap || '–'}${s.totalLaps ? '/' + s.totalLaps : ''}` : (s.name ? sessionLabel(s.name) : '—'), s.totalLaps && s.lap ? t('kpi.lapsLeft', { n: s.totalLaps - s.lap }) : '', 'muted'],
      [t('kpi.fastest'), fmtLap(fastest?.best), fastest ? fastest.code : '—', 'p'],
      [t('kpi.leader'), lead?.code || '—', lead ? `${lead.team ? lead.team + ' · ' : ''}${Math.round(lead.speed || 0)} ${t('unit.kmh')}` : '', '', lead]];
  }
  return k.map(([label, value, delta, cls, who]) => <Kpi key={label} label={label} value={value} delta={delta} cls={cls} accent={who ? safeColor(who.color) || teamColor(who.team) : null} who={who} />);
}

const posCol = () => ({ title: t('tbl.pos'), dataIndex: 'pos', width: 52, render: (v) => <span className="pos">{v}</span> });
const driverCol = () => ({ title: t('tbl.driver'), key: 'driver', render: (_, d) => <CodeCell d={d} /> });
const tyreCol = () => ({ title: t('tbl.tyre'), key: 'tyre', render: (_, d) => <Tyre c={d.tyre} /> });
const mono = (title, render, extra = {}) => ({ title, align: 'right', render: (_, d, i) => <span className="mono">{render(d, i)}</span>, ...extra });
const sectorCols = () => [0, 1, 2].map((k) => mono(`S${k + 1}`, (d) => <Sector v={d.sectors?.[k]} cls={d.sectorCls?.[k]} />, { key: `s${k}` }));

function TimingTable({ state, sel, onPick }) {
  const s = state.session;
  const rows = state.drivers;
  if (!rows.length) return <div className="empty">{t('tbl.empty')}</div>;
  const timed = s.type === 'quali' || s.type === 'practice';
  const pole = rows.find((x) => x.best != null)?.best;
  const frozen = state.flag === 'red';
  const pos = posCol(), driver = driverCol(), tyre = tyreCol(), sectors = sectorCols();
  const columns = timed ? [
    pos, driver, tyre,
    mono(t('tbl.bestTime'), (d, i) => (d.best != null ? (i === 0 ? <span className="p">{fmtLap(d.best)}</span> : fmtLap(d.best)) : '—'), { key: 'best' }),
    mono(t('tbl.gap'), (d, i) => (d.best != null && i ? fmtGap(d.best - pole) : i === 0 ? t('tbl.pole') : '—'), { key: 'gap' }),
    mono(t('tbl.lastLap'), (d) => fmtLap(d.last), { key: 'last' }),
    ...sectors,
    { title: t('tbl.status'), key: 'status', render: (_, d) => (d.onTrack ? <Badge kind="drs">{t('badge.push')}</Badge> : <Badge>{t('badge.box')}</Badge>) },
  ] : [
    pos, driver, tyre,
    mono(t('tbl.gap'), (d, i) => fmtGap(d.gap, i === 0), { key: 'gap' }),
    mono(t('tbl.interval'), (d, i) => (i === 0 ? '—' : fmtGap(d.interval)), { key: 'int' }),
    mono(t('tbl.lastLap'), (d) => fmtLap(d.last), { key: 'last' }),
    ...sectors,
    mono(t('unit.kmh'), (d) => (d.speed != null ? Math.round(d.speed) : '—'), { key: 'kmh' }),
    { title: t('tbl.pedals'), key: 'pedals', render: (_, d) => <span className="pedals"><Bar v={d.throttle} /><Bar v={d.brake} brake /></span> },
    mono(t('tbl.gear'), (d) => d.gear ?? '—', { key: 'gear' }),
    state.overtake
      ? { title: t('tbl.overtake'), key: 'drs', render: (_, d) => (d.ovt ? <Badge kind="drs">OVT</Badge> : <Badge>—</Badge>) }
      : { title: t('tbl.drs'), key: 'drs', render: (_, d) => (d.drs ? <Badge kind="drs">DRS</Badge> : <Badge>—</Badge>) },
    { title: t('tbl.status'), key: 'status', render: (_, d) => (d.status === 'out' ? <Badge kind="out">{t('badge.dnf')}</Badge> : d.status === 'stopped' ? <Badge kind="pit">{t('badge.stopped')}</Badge> : d.pit ? <Badge kind="pit">{t('badge.pit')}</Badge> : frozen ? <Badge kind="pit">{t('badge.box')}</Badge> : null) },
  ];
  return (
    <Table
      size="small" pagination={false} rowKey="num" dataSource={rows} columns={columns} scroll={{ x: 'max-content' }}
      rowClassName={(d, i) => [i === 0 ? 'lead' : '', d.num === sel ? 'sel' : '', timed && s.cutoff && i === s.cutoff - 1 ? 'cut' : '', timed && s.cutoff && i >= s.cutoff ? 'elim' : ''].join(' ').trim()}
      onRow={(d) => ({ tabIndex: 0, onClick: () => onPick?.(d.num), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(d.num); } } })}
    />
  );
}

/** Boxenstopps des Rennens: Standzeit (Reifenwechsel, Auto steht) und Gesamtzeit in der Boxengasse (Ein- bis Ausfahrt). */
function PitTable({ state, onPick }) {
  const stops = [...(state.pitStops || [])].reverse();
  if (!stops.length) return null;
  const best = Math.min(...stops.map((p) => p.stop).filter((v) => typeof v === 'number' && v > 0));
  const note = pitLossNote(state.pitLoss, state.flag === 'sc' || state.flag === 'vsc');
  return (
    <Section title={t('pit.title')} meta={note || t('pit.meta')} label={t('pit.title')}>
      <Table
        size="small" pagination={false} rowKey="id" dataSource={stops} scroll={{ x: 'max-content' }}
        onRow={(p) => ({ onClick: () => onPick?.(p.num) })}
        columns={[
          { title: t('tbl.driver'), key: 'driver', render: (_, p) => <CodeCell d={p} /> },
          { title: t('pit.lap'), dataIndex: 'lap', align: 'right', render: (v) => <span className="mono">{v ?? '—'}</span> },
          { title: t('pit.stationary'), key: 'stop', align: 'right', render: (_, p) => <span className={`mono${p.stop != null && p.stop === best ? ' p' : ''}`} title={t('pit.stationaryTip')}>{fmtSecs(p.stop)}</span> },
          { title: t('pit.total'), key: 'lane', align: 'right', render: (_, p) => <span className="mono" title={t('pit.totalTip')}>{fmtSecs(p.lane)}</span> },
          { title: t('tbl.tyre'), key: 'tyre', render: (_, p) => <Tyre c={p.tyre} /> },
        ]}
      />
    </Section>
  );
}

const LEDS = 15;
/** Schaltlichter wie am Lenkrad: 5 grün, 5 rot, 5 blau, je nach Drehzahl (Maximum 13 000). */
function ShiftLights({ rpm }) {
  const lit = rpm == null ? 0 : Math.round(Math.min(1, Math.max(0, rpm / 13000)) * LEDS);
  return <span className="leds" aria-hidden="true">{Array.from({ length: LEDS }, (_, i) => <i key={i} className={`${i < 5 ? 'lg' : i < 10 ? 'lr' : 'lb'}${i < lit ? ' on' : ''}`} />)}</span>;
}

const Pedal = ({ label, v, cls }) => (
  <div className="ped"><span className="label">{label}</span><span className="pbar2"><i className={cls} style={{ width: `${Math.round(Math.min(100, Math.max(0, v || 0)))}%` }} /></span><span className="mono">{Math.round(v || 0)}%</span></div>
);

function Detail({ state, sel, hist, refHist }) {
  const d = state.drivers.find((x) => x.num === sel) || state.drivers[0];
  if (!d) return null;
  const h = hist.get(d.num) || [];
  const f = state.flag;
  const isQ = state.session.type === 'quali';
  const col = safeColor(d.color) || teamColor(d.team) || '#f5f5f3';
  const posTxt = d.pos != null && d.pos < 90 ? `P${d.pos}` : '–';
  const hasSpeed = d.speed != null;
  const mode = state.overtake
    ? { label: t('tele.ovt'), value: d.ovt ? t('tele.ovt.reach') : state.overtake.open ? t('tele.ovt.open') : t('tele.ovt.locked'), note: d.ovt ? t('tele.ovt.noteReach') : state.overtake.open === false || f === 'sc' || f === 'red' ? t('tele.ovt.noteRc') : t('tele.ovt.noteFar'), on: d.ovt }
    : { label: t('tele.drs'), value: d.drs ? t('tele.drs.open') : t('tele.drs.closed'), note: f === 'sc' || f === 'red' ? t('tele.drs.locked') : '', on: d.drs };
  return (
    <Section title={t('tele.title', { code: d.code })} meta={d.team ? <><span className="tc" style={{ background: col }} />{d.team}</> : t('tele.latest')} label={t('tele.aria', { code: d.code })}>
      <div className="tele" style={{ '--tc': col }}>
        <Card className="tdriver">
          <div className="tface"><Face d={d} size={96} /><span className="tpos disp">{posTxt}</span></div>
          <div className="tname"><span className="code">{d.code}</span><strong>{d.name || d.code}</strong><span className="muted">#{d.num}{d.team ? ` · ${d.team}` : ''}</span></div>
          <dl className="tfacts">
            <div><dt className="label">{t('tbl.tyre')}</dt><dd>{d.tyre ? <Tyre c={d.tyre} /> : '—'}{d.stops != null && <span className="muted"> {t('tele.stops', { n: d.stops })}</span>}</dd></div>
            <div><dt className="label">{t('tbl.lastLap')}</dt><dd className="mono">{fmtLap(d.last)}</dd></div>
            <div><dt className="label">{t('tele.bestLap')}</dt><dd className="mono">{fmtLap(d.best)}</dd></div>
            <div><dt className="label">{isQ ? t('tbl.gap') : t('tbl.interval')}</dt><dd className="mono">{d.pos === 1 ? '—' : fmtGap(isQ ? d.gap : d.interval)}</dd></div>
          </dl>
        </Card>
        <div className="tmain">
          <div className="tdash">
            <div className="tt tspeed"><span className="label">{t('tele.speed')}</span><span className="tv">{hasSpeed ? Math.round(d.speed) : '—'}<small>{t('unit.kmh')}</small></span><span className="sbar2"><i style={{ width: `${hasSpeed ? Math.min(100, (d.speed / 350) * 100) : 0}%` }} /></span></div>
            <div className="tt tgear"><span className="label">{t('tbl.gear')}</span><span className="tv">{d.gear == null ? '—' : d.gear === 0 ? 'N' : d.gear}</span></div>
            <div className="tt trpm"><span className="label">{t('tele.rpm')}</span><ShiftLights rpm={d.rpm} /><span className="mono trv">{d.rpm != null ? `${dec((d.rpm / 1000).toFixed(1))}k` : '—'} <span className="muted">{t('tele.rpmUnit')}</span></span></div>
            <div className="tt tped"><Pedal label={t('tele.throttle')} v={d.throttle} cls="th" /><Pedal label={t('tele.brake')} v={d.brake} cls="br" /></div>
            <div className={`tt tmode${mode.on ? ' on' : ''}`}><span className="label">{mode.label}</span><span className="tv sm">{mode.value}</span>{mode.note && <span className="tnote mono">{mode.note}</span>}</div>
          </div>
          <Card className="traces">
            <Html html={tracesSvg(h, isQ ? refHist : null, col)} />
            <div className="legend">
              <span><i style={{ background: col }} />{t('tele.speed')}</span><span><i style={{ background: 'rgba(245,245,243,.5)' }} />{t('tele.throttle')}</span>
              <span><i style={{ background: 'var(--race-red)' }} />{t('tele.brake')}</span>
              {isQ && <span><i style={{ background: 'var(--tp)' }} />{t('tele.poleLap')}</span>}
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}

export function Top5({ state, sel, onPick }) {
  const timed = state.session.type === 'quali' || state.session.type === 'practice';
  const cut = state.session.type === 'quali' ? state.session.cutoff : null; // Quali: Spitzengruppe reicht bis knapp unter die Cut-Off-Linie
  return (
    <Card className="top5" size="small">
      <div className="head"><span className="label">{timed ? t('top5.fastest') : t('top5.lead')}</span><span className="label">{timed ? t('top5.bestTime') : t('top5.interval')}</span></div>
      {state.drivers.slice(0, cut ? Math.min(cut + 2, 18) : 10).map((d, i) => {
        const val = timed ? (d.best != null ? (i === 0 ? <span className="p">{fmtLap(d.best)}</span> : fmtLap(d.best)) : '—') : i === 0 ? t('top5.leader') : fmtGap(d.interval);
        return (
          <button key={d.num} type="button" className={`${d.num === sel ? 'on' : ''}${cut && i === cut - 1 ? ' cutafter' : ''}${cut && i >= cut ? ' elim' : ''}`} onClick={() => onPick?.(d.num)}>
            <span className="p1">{d.pos}</span>
            <span className="nm"><CodeCell d={d} />{d.team && <small>{d.team}</small>}</span>
            <Tyre c={d.tyre} />
            <span className="val">{val}</span>
          </button>
        );
      })}
    </Card>
  );
}

function Upcoming({ state, ui, actions }) {
  const u = state.upcoming || {};
  const cd = splitCountdown((u.startsAt - state.now) / 1000);
  const cell = (v, l) => <div key={l} className="cdc"><span className="v">{String(v).padStart(2, '0')}</span><span className="label">{l}</span></div>;
  const live = new Map(state.drivers.map((d) => [d.code, d.color]));
  const colorOf = (code) => live.get(code) || null; // sonst leitet Swatch die Farbe aus dem Teamnamen ab
  const standings = u.standings || [];
  const teams = u.constructors || [];
  const last = u.lastResult;
  const flag = flagUrl(countryOf(u.circuit));
  const nextName = u.nextLabel || '';
  const isNext = (name) => !!nextName && sameSession(name, nextName);
  const when = (v) => (typeof v === 'number' ? new Date(v).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : v); // Zeitpunkt oder fertiger Text (Demo)
  const pts = (arr) => Math.max(1, ...arr.map((x) => Number(x.points) || 0));
  const bar = (v, max) => <span className="pbar" aria-hidden="true"><i style={{ width: `${Math.round(((Number(v) || 0) / max) * 100)}%` }} /></span>;
  const maxD = pts(standings), maxT = pts(teams);
  return (
    <>
      <div className={`hero${ui.cinema ? ' solo' : ''}`}>
        {!ui.cinema && <StateMap state={state} ui={ui} actions={actions} />}
        <Card className="hl">
          {flag && <span className="rflag" style={{ backgroundImage: `url("${flag}")` }} aria-hidden="true" />}
          <span className="label eyebrow"><i />{nextName ? sessionLabel(nextName) : t('status.next')}</span>
          <h2 className="big">{u.meeting || '—'}</h2>
          <span className="muted where">{u.circuit || ''}</span>
          <div className="cd" role="timer" aria-label={t('up.countdown')}>{cell(cd.d, t('up.days'))}{cell(cd.h, t('up.hours'))}{cell(cd.m, t('up.min'))}{cell(cd.s, t('up.sec'))}</div>
          {(u.facts || []).length > 0 && <div className="facts">{u.facts.map(([l, v]) => <div key={l}><span className="label">{tl(l)}</span><div className="mono fact">{v}</div></div>)}</div>}
        </Card>
      </div>
      <div className="two">
        {u.schedule?.length > 0 && (
          <Section title={t('up.weekend')} meta={t('up.localTime')}>
            <Card className="rows sched">
              {u.schedule.map(([a, b]) => (
                <div className={`row${isNext(a) ? ' next' : ''}`} key={a} aria-current={isNext(a) ? 'true' : undefined}>
                  <span className="sname">{sessionLabel(a)}{isNext(a) && <span className="nexttag">{t('up.nextTag')}</span>}</span>
                  <span className="mono">{when(b)}</span>
                </div>
              ))}
            </Card>
          </Section>
        )}
        {u.weather?.length > 0 && (
          <Section title={t('up.weather')} meta={t('up.forecast')}>
            <div className="wx">{u.weather.map(([a, b]) => <Card className="wxc" key={a} size="small"><span className="label">{tl(a)}</span><span className="mono wxv">{b}</span></Card>)}</div>
          </Section>
        )}
      </div>
      {last && last.podium.length > 0 && (
        <Section title={t('up.lastRace', { name: last.name })} meta={t('up.podium')}>
          <div className="podium">
            {last.podium.map((p) => (
              <Card className={`pod p${p.pos}`} key={p.pos} size="small">
                <span className="pn">{p.pos}</span>
                <span className="pwho"><Swatch color={colorOf(p.code, p.team)} team={p.team} /><span className="code">{p.code}</span></span>
                {p.team && <span className="muted pteam">{p.team}</span>}
                <span className="mono ptime">{p.time}</span>
              </Card>
            ))}
          </div>
        </Section>
      )}
      <div className="two">
      {standings.length > 0 && (
        <Section title={t('up.drivers')} meta={t('up.top10')}>
          <Table
            size="small" pagination={false} rowKey="code" dataSource={standings}
            rowClassName={(_, i) => (i === 0 ? 'lead' : '')}
            columns={[
              { title: t('tbl.pos'), width: 52, render: (_, __, i) => <span className="pos">{i + 1}</span> },
              { title: t('tbl.driver'), dataIndex: 'code', render: (c, r) => <><Swatch color={colorOf(c, r.team)} team={r.team} /><span className="code">{c}</span>{r.team && <span className="muted"> · {r.team}</span>}</> },
              { title: t('up.points'), dataIndex: 'points', align: 'right', render: (v) => <span className="pcell"><span className="mono">{v}</span>{bar(v, maxD)}</span> },
              { title: t('up.wins'), dataIndex: 'wins', align: 'right', render: (v) => <span className="mono">{v}</span> },
            ]}
          />
        </Section>
      )}
      {teams.length > 0 && (
        <Section title={t('up.constructors')} meta="Jolpica F1">
          <Table
            size="small" pagination={false} rowKey="team" dataSource={teams.slice(0, 10)}
            rowClassName={(_, i) => (i === 0 ? 'lead' : '')}
            columns={[
              { title: t('tbl.pos'), width: 52, render: (_, __, i) => <span className="pos">{i + 1}</span> },
              { title: t('tbl.team'), dataIndex: 'team', render: (t) => <><Swatch team={t} />{t}</> },
              { title: t('up.points'), dataIndex: 'points', align: 'right', render: (v) => <span className="pcell"><span className="mono">{v}</span>{bar(v, maxT)}</span> },
              { title: t('up.wins'), dataIndex: 'wins', align: 'right', render: (v) => <span className="mono">{v}</span> },
            ]}
          />
        </Section>
      )}
      </div>
    </>
  );
}

export function Main({ state, ui, hist, refHist, actions = {} }) {
  const type = state.session.type;
  if (type === 'upcoming') return <Upcoming state={state} ui={ui} actions={actions} />;
  const ttl = state.flag === 'sc' ? t('main.ttl.sc') : state.flag === 'red' ? t('main.ttl.red') : type === 'quali' ? t('main.ttl.quali') : type === 'practice' ? t('main.ttl.practice') : t('main.ttl.live');
  const kp = kpisFor(state);
  return (
    <>
      <div className={`kpis n${kp.length}`}>{kp}</div>
      <div className={`hero${ui.cinema ? ' solo' : ''}`}>
        {!ui.cinema && <StateMap state={state} ui={ui} actions={actions} overlay={<Top5 state={state} sel={ui.sel} onPick={actions.pick} />} />}
        <Top5 state={state} sel={ui.sel} onPick={actions.pick} />
      </div>
      <Section title={ttl} meta={t('main.pickRow')}><TimingTable state={state} sel={ui.sel} onPick={actions.pick} /></Section>
      {type === 'race' && <PitTable state={state} onPick={actions.pick} />}
      <Detail state={state} sel={ui.sel} hist={hist} refHist={refHist} />
    </>
  );
}
