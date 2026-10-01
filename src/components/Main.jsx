import { Card, Table } from 'antd';
import { fmtLap, fmtGap, fmtClock, splitCountdown, safeColor } from '../../js/format.js';
import { tracesSvg } from '../../js/track.js';
import { teamColor } from '../../js/teams.js';
import { fmtSecs, pitLossNote } from '../../js/pitstops.js';
import { flagUrl, countryOf } from '../flags.js';
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
      [s.type === 'quali' ? 'Pole-Zeit' : 'Bestzeit', fmtLap(pole?.best), pole ? `${pole.code}${pole.team ? ' · ' + pole.team : ''}` : '—', pole ? 'p' : 'muted', pole],
      s.type === 'quali' ? ['Cut-Off P' + (s.cutoff || '–'), fmtLap(cut?.best), cut?.best && pole?.best ? `+${(cut.best - pole.best).toFixed(3)} zur Pole` : '—', cut?.best ? 'y' : 'muted']
        : ['Fahrer mit Zeit', String(d.filter((x) => x.best != null).length), `von ${d.length}`, 'muted'],
      ['Verbleibend', fmtClock(s.remaining), s.name || '', 'muted'],
      ['Auf der Strecke', String(on), 'Fahrer', 'muted']];
  } else if (f === 'red') {
    const stopped = d.filter((x) => (x.speed || 0) === 0).length;
    k = [
      ['Unterbrechung', fmtClock(s.flagSince ? (state.now - s.flagSince) / 1000 : null), `seit Runde ${s.lap || '–'}`, 'y'],
      ['Fahrzeuge steht', `${stopped}/${d.length}`, 'Geschwindigkeit 0', stopped === d.length ? 'g' : 'muted'],
      ['Reifenwechsel', 'Erlaubt', 'Boxengasse geschlossen', 'muted'],
      ['Restart', '—', 'Meldung Race Control abwarten', 'muted']];
  } else if (f === 'sc' || f === 'vsc') {
    const last = d[d.length - 1];
    k = [
      [f === 'sc' ? 'Safety Car seit' : 'VSC seit', fmtClock(s.flagSince ? (state.now - s.flagSince) / 1000 : null), `Runde ${s.lap || '–'}`, 'y'],
      ['Feldabstand', last?.gap != null ? `+${last.gap.toFixed(1)} s` : '—', 'Leader bis Letzter', 'muted'],
      ['Leader', lead?.code || '—', `${lead?.team ? lead.team + ' · ' : ''}P1 · ${lead ? Math.round(lead.speed || 0) : 0} km/h`, '', lead],
      ['Überholen', 'Verboten', f === 'sc' ? 'Safety Car' : 'Delta einhalten', 'y']];
  } else {
    const fastest = d.filter((x) => x.best != null).sort((a, b) => a.best - b.best)[0];
    const pits = d.reduce((n, x) => n + (x.stops || 0), 0);
    k = [
      [s.type === 'race' ? 'Runde' : 'Session', s.type === 'race' ? `${s.lap || '–'}${s.totalLaps ? '/' + s.totalLaps : ''}` : s.name || '—', s.totalLaps && s.lap ? `${s.totalLaps - s.lap} Runden verbleibend` : '', 'muted'],
      ['Schnellste Runde', fmtLap(fastest?.best), fastest ? fastest.code : '—', 'p'],
      ['Leader', lead?.code || '—', lead ? `${lead.team ? lead.team + ' · ' : ''}${Math.round(lead.speed || 0)} km/h` : '', '', lead],
      ['Boxenstopps', String(pits), 'gesamt', 'muted']];
  }
  return k.map(([label, value, delta, cls, who]) => <Kpi key={label} label={label} value={value} delta={delta} cls={cls} accent={who ? safeColor(who.color) || teamColor(who.team) : null} who={who} />);
}

const pos = { title: 'Pos', dataIndex: 'pos', width: 52, render: (v) => <span className="pos">{v}</span> };
const driver = { title: 'Fahrer', key: 'driver', render: (_, d) => <CodeCell d={d} /> };
const tyre = { title: 'Reifen', key: 'tyre', render: (_, d) => <Tyre c={d.tyre} /> };
const mono = (title, render, extra = {}) => ({ title, align: 'right', render: (_, d, i) => <span className="mono">{render(d, i)}</span>, ...extra });
const sectors = [0, 1, 2].map((k) => mono(`S${k + 1}`, (d) => <Sector v={d.sectors?.[k]} cls={d.sectorCls?.[k]} />, { key: `s${k}` }));

function TimingTable({ state, sel, onPick }) {
  const s = state.session;
  const rows = state.drivers;
  if (!rows.length) return <div className="empty">Keine Fahrerdaten verfügbar.</div>;
  const timed = s.type === 'quali' || s.type === 'practice';
  const pole = rows.find((x) => x.best != null)?.best;
  const frozen = state.flag === 'red';
  const columns = timed ? [
    pos, driver, tyre,
    mono('Beste Zeit', (d, i) => (d.best != null ? (i === 0 ? <span className="p">{fmtLap(d.best)}</span> : fmtLap(d.best)) : '—'), { key: 'best' }),
    mono('Abstand', (d, i) => (d.best != null && i ? fmtGap(d.best - pole) : i === 0 ? 'Pole' : '—'), { key: 'gap' }),
    mono('Letzte Runde', (d) => fmtLap(d.last), { key: 'last' }),
    ...sectors,
    { title: 'Status', key: 'status', render: (_, d) => (d.onTrack ? <Badge kind="drs">PUSH</Badge> : <Badge>BOX</Badge>) },
  ] : [
    pos, driver, tyre,
    mono('Abstand', (d, i) => fmtGap(d.gap, i === 0), { key: 'gap' }),
    mono('Intervall', (d, i) => (i === 0 ? '—' : fmtGap(d.interval)), { key: 'int' }),
    mono('Letzte Runde', (d) => fmtLap(d.last), { key: 'last' }),
    ...sectors,
    mono('km/h', (d) => (d.speed != null ? Math.round(d.speed) : '—'), { key: 'kmh' }),
    { title: 'Gas / Bremse', key: 'pedals', render: (_, d) => <span className="pedals"><Bar v={d.throttle} /><Bar v={d.brake} brake /></span> },
    mono('Gang', (d) => d.gear ?? '—', { key: 'gear' }),
    state.overtake
      ? { title: 'Overtake', key: 'drs', render: (_, d) => (d.ovt ? <Badge kind="drs">OVT</Badge> : <Badge>—</Badge>) }
      : { title: 'DRS', key: 'drs', render: (_, d) => (d.drs ? <Badge kind="drs">DRS</Badge> : <Badge>—</Badge>) },
    { title: 'Status', key: 'status', render: (_, d) => (d.status === 'out' ? <Badge kind="out">DNF</Badge> : d.status === 'stopped' ? <Badge kind="pit">STEHT</Badge> : d.pit ? <Badge kind="pit">PIT</Badge> : frozen ? <Badge kind="pit">BOX</Badge> : null) },
  ];
  const caption = timed ? (s.type === 'quali' ? 'Qualifying-Ergebnis' : 'Trainingsergebnis') : 'Live-Timing aller Fahrer';
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
    <Section title="Boxenstopps" meta={note || 'Standzeit = Reifenwechsel · Gesamt = Ein- bis Ausfahrt'} label="Boxenstopps">
      <Table
        size="small" pagination={false} rowKey="id" dataSource={stops} scroll={{ x: 'max-content' }}
        onRow={(p) => ({ onClick: () => onPick?.(p.num) })}
        columns={[
          { title: 'Fahrer', key: 'driver', render: (_, p) => <CodeCell d={p} /> },
          { title: 'Runde', dataIndex: 'lap', align: 'right', render: (v) => <span className="mono">{v ?? '—'}</span> },
          { title: 'Standzeit', key: 'stop', align: 'right', render: (_, p) => <span className={`mono${p.stop != null && p.stop === best ? ' p' : ''}`} title="Zeit, in der das Auto stand (Reifenwechsel)">{fmtSecs(p.stop)}</span> },
          { title: 'Gesamt in der Box', key: 'lane', align: 'right', render: (_, p) => <span className="mono" title="Gesamtzeit von Einfahrt bis Ausfahrt der Boxengasse">{fmtSecs(p.lane)}</span> },
          { title: 'Reifen', key: 'tyre', render: (_, p) => <Tyre c={p.tyre} /> },
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
    ? { label: 'Overtake-Modus', value: d.ovt ? 'In Reichweite' : state.overtake.open ? 'Freigegeben' : 'Gesperrt', note: d.ovt ? 'Abstand ≤ 1,0 s (abgeleitet)' : state.overtake.open === false || f === 'sc' || f === 'red' ? 'Rennleitung' : 'Abstand > 1,0 s', on: d.ovt }
    : { label: 'DRS', value: d.drs ? 'Offen' : 'Zu', note: f === 'sc' || f === 'red' ? 'Gesperrt' : '', on: d.drs };
  return (
    <Section title={`Telemetrie · ${d.code}`} meta={d.team ? <><span className="tc" style={{ background: col }} />{d.team}</> : 'Letzte Messwerte'} label={`Telemetrie ${d.code}`}>
      <div className="tele" style={{ '--tc': col }}>
        <Card className="tdriver">
          <div className="tface"><Face d={d} size={96} /><span className="tpos disp">{posTxt}</span></div>
          <div className="tname"><span className="code">{d.code}</span><strong>{d.name || d.code}</strong><span className="muted">#{d.num}{d.team ? ` · ${d.team}` : ''}</span></div>
          <dl className="tfacts">
            <div><dt className="label">Reifen</dt><dd>{d.tyre ? <Tyre c={d.tyre} /> : '—'}{d.stops != null && <span className="muted"> {d.stops} {d.stops === 1 ? 'Stopp' : 'Stopps'}</span>}</dd></div>
            <div><dt className="label">Letzte Runde</dt><dd className="mono">{fmtLap(d.last)}</dd></div>
            <div><dt className="label">Beste Runde</dt><dd className="mono">{fmtLap(d.best)}</dd></div>
            <div><dt className="label">{isQ ? 'Abstand' : 'Intervall'}</dt><dd className="mono">{d.pos === 1 ? '—' : fmtGap(isQ ? d.gap : d.interval)}</dd></div>
          </dl>
        </Card>
        <div className="tmain">
          <div className="tdash">
            <div className="tt tspeed"><span className="label">Geschwindigkeit</span><span className="tv">{hasSpeed ? Math.round(d.speed) : '—'}<small>km/h</small></span><span className="sbar2"><i style={{ width: `${hasSpeed ? Math.min(100, (d.speed / 350) * 100) : 0}%` }} /></span></div>
            <div className="tt tgear"><span className="label">Gang</span><span className="tv">{d.gear == null ? '—' : d.gear === 0 ? 'N' : d.gear}</span></div>
            <div className="tt trpm"><span className="label">Drehzahl</span><ShiftLights rpm={d.rpm} /><span className="mono trv">{d.rpm != null ? `${(d.rpm / 1000).toFixed(1).replace('.', ',')}k` : '—'} <span className="muted">U/min</span></span></div>
            <div className="tt tped"><Pedal label="Gas" v={d.throttle} cls="th" /><Pedal label="Bremse" v={d.brake} cls="br" /></div>
            <div className={`tt tmode${mode.on ? ' on' : ''}`}><span className="label">{mode.label}</span><span className="tv sm">{mode.value}</span>{mode.note && <span className="tnote mono">{mode.note}</span>}</div>
          </div>
          <Card className="traces">
            <Html html={tracesSvg(h, isQ ? refHist : null, col)} />
            <div className="legend">
              <span><i style={{ background: col }} />Geschwindigkeit</span><span><i style={{ background: 'rgba(245,245,243,.5)' }} />Gas</span>
              <span><i style={{ background: 'var(--race-red)' }} />Bremse</span>
              {isQ && <span><i style={{ background: 'var(--tp)' }} />Pole-Runde</span>}
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
      <div className="head"><span className="label">{timed ? 'Schnellste Zeiten' : 'Spitzengruppe'}</span><span className="label">{timed ? 'Beste Zeit' : 'Intervall'}</span></div>
      {state.drivers.slice(0, cut ? Math.min(cut + 2, 18) : 10).map((d, i) => {
        const val = timed ? (d.best != null ? (i === 0 ? <span className="p">{fmtLap(d.best)}</span> : fmtLap(d.best)) : '—') : i === 0 ? 'Leader' : fmtGap(d.interval);
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
  const isNext = (name) => !!nextName && (name === nextName || nextName.endsWith(name));
  const pts = (arr) => Math.max(1, ...arr.map((x) => Number(x.points) || 0));
  const bar = (v, max) => <span className="pbar" aria-hidden="true"><i style={{ width: `${Math.round(((Number(v) || 0) / max) * 100)}%` }} /></span>;
  const maxD = pts(standings), maxT = pts(teams);
  return (
    <>
      <div className={`hero${ui.cinema ? ' solo' : ''}`}>
        {!ui.cinema && <StateMap state={state} ui={ui} actions={actions} />}
        <Card className="hl">
          {flag && <span className="rflag" style={{ backgroundImage: `url("${flag}")` }} aria-hidden="true" />}
          <span className="label eyebrow"><i />{nextName || 'Nächste Session'}</span>
          <h2 className="big">{u.meeting || '—'}</h2>
          <span className="muted where">{u.circuit || ''}</span>
          <div className="cd" role="timer" aria-label="Countdown bis zum Start">{cell(cd.d, 'Tage')}{cell(cd.h, 'Std')}{cell(cd.m, 'Min')}{cell(cd.s, 'Sek')}</div>
          {(u.facts || []).length > 0 && <div className="facts">{u.facts.map(([l, v]) => <div key={l}><span className="label">{l}</span><div className="mono fact">{v}</div></div>)}</div>}
        </Card>
      </div>
      <div className="two">
        {u.schedule?.length > 0 && (
          <Section title="Rennwochenende" meta="Ortszeit">
            <Card className="rows sched">
              {u.schedule.map(([a, b]) => (
                <div className={`row${isNext(a) ? ' next' : ''}`} key={a} aria-current={isNext(a) ? 'true' : undefined}>
                  <span className="sname">{a}{isNext(a) && <span className="nexttag">Als Nächstes</span>}</span>
                  <span className="mono">{b}</span>
                </div>
              ))}
            </Card>
          </Section>
        )}
        {u.weather?.length > 0 && (
          <Section title="Wetter" meta="Prognose">
            <div className="wx">{u.weather.map(([a, b]) => <Card className="wxc" key={a} size="small"><span className="label">{a}</span><span className="mono wxv">{b}</span></Card>)}</div>
          </Section>
        )}
      </div>
      {last && last.podium.length > 0 && (
        <Section title={`Letztes Rennen · ${last.name}`} meta="Podium">
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
        <Section title="Fahrerwertung" meta="Top 10">
          <Table
            size="small" pagination={false} rowKey="code" dataSource={standings}
            rowClassName={(_, i) => (i === 0 ? 'lead' : '')}
            columns={[
              { title: 'Pos', width: 52, render: (_, __, i) => <span className="pos">{i + 1}</span> },
              { title: 'Fahrer', dataIndex: 'code', render: (c, r) => <><Swatch color={colorOf(c, r.team)} team={r.team} /><span className="code">{c}</span>{r.team && <span className="muted"> · {r.team}</span>}</> },
              { title: 'Punkte', dataIndex: 'points', align: 'right', render: (v) => <span className="pcell"><span className="mono">{v}</span>{bar(v, maxD)}</span> },
              { title: 'Siege', dataIndex: 'wins', align: 'right', render: (v) => <span className="mono">{v}</span> },
            ]}
          />
        </Section>
      )}
      {teams.length > 0 && (
        <Section title="Konstrukteurswertung" meta="Jolpica F1">
          <Table
            size="small" pagination={false} rowKey="team" dataSource={teams.slice(0, 10)}
            rowClassName={(_, i) => (i === 0 ? 'lead' : '')}
            columns={[
              { title: 'Pos', width: 52, render: (_, __, i) => <span className="pos">{i + 1}</span> },
              { title: 'Team', dataIndex: 'team', render: (t) => <><Swatch team={t} />{t}</> },
              { title: 'Punkte', dataIndex: 'points', align: 'right', render: (v) => <span className="pcell"><span className="mono">{v}</span>{bar(v, maxT)}</span> },
              { title: 'Siege', dataIndex: 'wins', align: 'right', render: (v) => <span className="mono">{v}</span> },
            ]}
          />
        </Section>
      )}
      </div>
    </>
  );
}

export function Main({ state, ui, hist, refHist, actions = {} }) {
  const t = state.session.type;
  if (t === 'upcoming') return <Upcoming state={state} ui={ui} actions={actions} />;
  const ttl = state.flag === 'sc' ? 'Live-Timing · Safety Car' : state.flag === 'red' ? 'Aufstellung beim Restart' : t === 'quali' ? 'Qualifying-Ergebnis' : t === 'practice' ? 'Trainingsergebnis' : 'Live-Timing';
  return (
    <>
      <div className="kpis">{kpisFor(state)}</div>
      <div className={`hero${ui.cinema ? ' solo' : ''}`}>
        {!ui.cinema && <StateMap state={state} ui={ui} actions={actions} overlay={<Top5 state={state} sel={ui.sel} onPick={actions.pick} />} />}
        <Top5 state={state} sel={ui.sel} onPick={actions.pick} />
      </div>
      <Section title={ttl} meta="Zeile wählen für Telemetrie"><TimingTable state={state} sel={ui.sel} onPick={actions.pick} /></Section>
      {t === 'race' && <PitTable state={state} onPick={actions.pick} />}
      <Detail state={state} sel={ui.sel} hist={hist} refHist={refHist} />
    </>
  );
}
