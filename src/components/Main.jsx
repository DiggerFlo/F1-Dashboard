import { Card, Table } from 'antd';
import { fmtLap, fmtGap, fmtClock, splitCountdown, safeColor } from '../../js/format.js';
import { tracesSvg } from '../../js/track.js';
import { Html, Tyre, CodeCell, Sector, Bar, Badge, Kpi, Section, Swatch } from './bits.jsx';
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
      [s.type === 'quali' ? 'Pole-Zeit' : 'Bestzeit', fmtLap(pole?.best), pole ? pole.code : '—', pole ? 'p' : 'muted'],
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
      ['Leader', lead?.code || '—', `P1 · ${lead ? Math.round(lead.speed || 0) : 0} km/h`, ''],
      ['Überholen', 'Verboten', f === 'sc' ? 'Safety Car' : 'Delta einhalten', 'y']];
  } else {
    const fastest = d.filter((x) => x.best != null).sort((a, b) => a.best - b.best)[0];
    const pits = d.reduce((n, x) => n + (x.stops || 0), 0);
    k = [
      [s.type === 'race' ? 'Runde' : 'Session', s.type === 'race' ? `${s.lap || '–'}${s.totalLaps ? '/' + s.totalLaps : ''}` : s.name || '—', s.totalLaps && s.lap ? `${s.totalLaps - s.lap} Runden verbleibend` : '', 'muted'],
      ['Schnellste Runde', fmtLap(fastest?.best), fastest ? fastest.code : '—', 'p'],
      ['Leader', lead?.code || '—', lead ? `${Math.round(lead.speed || 0)} km/h` : '', ''],
      ['Boxenstopps', String(pits), 'gesamt', 'muted']];
  }
  return k.map(([label, value, delta, cls]) => <Kpi key={label} label={label} value={value} delta={delta} cls={cls} />);
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
    { title: 'DRS', key: 'drs', render: (_, d) => (d.drs ? <Badge kind="drs">DRS</Badge> : <Badge>—</Badge>) },
    { title: 'Status', key: 'status', render: (_, d) => (d.pit ? <Badge kind="pit">PIT</Badge> : frozen ? <Badge kind="pit">BOX</Badge> : null) },
  ];
  const caption = timed ? (s.type === 'quali' ? 'Qualifying-Ergebnis' : 'Trainingsergebnis') : 'Live-Timing aller Fahrer';
  return (
    <Table
      size="small" pagination={false} rowKey="num" dataSource={rows} columns={columns} scroll={{ x: 'max-content' }}
      rowClassName={(d, i) => [i === 0 ? 'lead' : '', d.num === sel ? 'sel' : '', timed && s.cutoff && i === s.cutoff - 1 ? 'cut' : ''].join(' ').trim()}
      onRow={(d) => ({ tabIndex: 0, onClick: () => onPick?.(d.num), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(d.num); } } })}
    />
  );
}

function Detail({ state, sel, hist, refHist }) {
  const d = state.drivers.find((x) => x.num === sel) || state.drivers[0];
  if (!d) return null;
  const h = hist.get(d.num) || [];
  const f = state.flag;
  const isQ = state.session.type === 'quali';
  const team = d.team ? <><span className="tc" style={{ background: safeColor(d.color) || 'var(--line)' }} />{d.team}</> : 'Letzte Messwerte';
  return (
    <Section title={`Telemetrie · ${d.code} · P${d.pos}`} meta={team} label={`Telemetrie ${d.code}`}>
      <div className="two">
        <Card className="traces">
          <Html html={tracesSvg(h, isQ ? refHist : null)} />
          <div className="legend">
            <span><i />Geschwindigkeit</span><span><i style={{ background: 'var(--ink-muted)' }} />Gas</span>
            <span><i style={{ background: 'repeating-linear-gradient(90deg,var(--ink) 0 4px,transparent 4px 7px)' }} />Bremse</span>
            {isQ && <span><i style={{ background: 'var(--tp)' }} />Pole-Runde</span>}
          </div>
        </Card>
        <div className="kpis two-col">
          <Kpi label="Geschwindigkeit" value={d.speed != null ? String(Math.round(d.speed)) : '—'} delta="km/h" />
          <Kpi label="Gang · U/min" value={`${d.gear ?? '—'} · ${d.rpm != null ? (d.rpm / 1000).toFixed(1) + 'k' : '—'}`} delta="Bereich 8.0–12.5k" cls={f === 'sc' ? 'y' : ''} />
          <Kpi label="Gas · Bremse" value={`${Math.round(d.throttle || 0)}% · ${Math.round(d.brake || 0)}%`} delta={d.brake > 0 ? 'bremst' : 'Gas'} />
          <Kpi label="DRS" value={d.drs ? 'Offen' : 'Zu'} delta={f === 'sc' || f === 'red' ? 'Gesperrt' : ''} cls={d.drs ? 'g' : ''} />
        </div>
      </div>
    </Section>
  );
}

export function Top5({ state, sel, onPick }) {
  const timed = state.session.type === 'quali' || state.session.type === 'practice';
  return (
    <Card className="top5" size="small">
      <div className="head"><span className="label">{timed ? 'Schnellste Zeiten' : 'Spitzengruppe'}</span><span className="label">{timed ? 'Beste Zeit' : 'Intervall'}</span></div>
      {state.drivers.slice(0, 8).map((d, i) => {
        const val = timed ? (d.best != null ? (i === 0 ? <span className="p">{fmtLap(d.best)}</span> : fmtLap(d.best)) : '—') : i === 0 ? 'Leader' : fmtGap(d.interval);
        return (
          <button key={d.num} type="button" className={d.num === sel ? 'on' : ''} onClick={() => onPick?.(d.num)}>
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
  const cell = (v, l) => <div key={l}><span className="v">{String(v).padStart(2, '0')}</span><span className="label">{l}</span></div>;
  const rows = (arr) => (arr || []).map(([a, b]) => <div className="row" key={a}><span>{a}</span><span className="mono">{b}</span></div>);
  const live = new Map(state.drivers.map((d) => [d.code, d.color]));
  const colorOf = (code) => live.get(code) || null; // sonst leitet Swatch die Farbe aus dem Teamnamen ab
  const standings = u.standings || [];
  const teams = u.constructors || [];
  const last = u.lastResult;
  return (
    <>
      <div className={`hero${ui.cinema ? ' solo' : ''}`}>
        {!ui.cinema && <StateMap state={state} ui={ui} actions={actions} />}
        <Card className="hl">
          <span className="label">{u.nextLabel || 'Nächste Session'}</span>
          <h2 className="big">{u.meeting || '—'}</h2>
          <span className="muted">{u.circuit || ''}</span>
          <div className="cd">{cell(cd.d, 'Tage')}{cell(cd.h, 'Std')}{cell(cd.m, 'Min')}{cell(cd.s, 'Sek')}</div>
          <div className="two">{(u.facts || []).map(([l, v]) => <div key={l}><span className="label">{l}</span><div className="mono fact">{v}</div></div>)}</div>
        </Card>
      </div>
      <div className="two">
        {u.schedule?.length > 0 && <Section title="Zeitplan" meta="Ortszeit"><Card className="rows">{rows(u.schedule)}</Card></Section>}
        {u.weather?.length > 0 && <Section title="Wetter" meta="Prognose"><Card className="rows">{rows(u.weather)}</Card></Section>}
      </div>
      {last && last.podium.length > 0 && (
        <Section title={`Letztes Rennen · ${last.name}`} meta="Podium">
          <Card className="rows">{last.podium.map((p) => <div className="row" key={p.pos}><span><span className="pos">{p.pos}</span> <Swatch color={colorOf(p.code, p.team)} team={p.team} /><span className="code">{p.code}</span>{p.team && <span className="muted"> · {p.team}</span>}</span><span className="mono">{p.time}</span></div>)}</Card>
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
              { title: 'Punkte', dataIndex: 'points', align: 'right', render: (v) => <span className="mono">{v}</span> },
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
              { title: 'Punkte', dataIndex: 'points', align: 'right', render: (v) => <span className="mono">{v}</span> },
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
      <Detail state={state} sel={ui.sel} hist={hist} refHist={refHist} />
    </>
  );
}
