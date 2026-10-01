import { useState } from 'react';
import { Alert, Button, Menu, Segmented, Select, Slider, Space, Spin, Switch } from 'antd';
import { CaretRightFilled, PauseOutlined, StepBackwardOutlined } from '@ant-design/icons';
import { fmtClock } from '../../js/format.js';

const TABS = [['upcoming', 'Vorschau'], ['race', 'Rennen'], ['quali', 'Qualifying'], ['practice', 'Training'], ['calendar', 'Kalender']];

const Mark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h9a6 6 0 0 1 0 12H9v6H4V3Zm5 4v4h4a2 2 0 0 0 0-4H9Z" fill="currentColor" fillRule="evenodd" /><rect x="15" y="17" width="5" height="4" fill="#e8112d" /></svg>
);

function statusOf(state) {
  const f = state.flag;
  let dot = '', txt = 'Live';
  if (state.session.type === 'upcoming') txt = 'Nächste Session';
  else if (state.session.phase === 'replay') txt = 'Wiederholung';
  else if (f === 'red') { dot = 'y'; txt = 'Unterbrochen'; }
  else if (f === 'sc' || f === 'vsc' || f === 'yellow') { dot = 'y'; txt = 'Live · Neutralisiert'; }
  else if (f === 'chequered') txt = 'Beendet';
  else dot = state.session.type === 'race' ? 'red' : 'g';
  const lap = state.session.type === 'race' && state.session.lap ? ` · Runde ${state.session.lap}${state.session.totalLaps ? '/' + state.session.totalLaps : ''}` : '';
  return { dot, txt: txt + lap };
}

function Topbar({ state, ui, actions }) {
  const type = ui.view === 'calendar' ? 'calendar' : state.session.type;
  const { dot, txt } = statusOf(state);
  return (
    <header className="top">
      <a className="brand" href="./" aria-label="Pitwall, Startseite"><Mark /><span>Pitwall</span></a>
      <Menu mode="horizontal" selectedKeys={[type]} items={TABS.map(([key, label]) => ({ key, label }))} onClick={({ key }) => actions.tab?.(key)} className="tabs" aria-label="Ansicht" />
      <div className="top-r">
        <Segmented size="small" className="srcsw" value={ui.demo ? 'demo' : 'openf1'} options={[{ value: 'demo', label: 'Demo' }, { value: 'openf1', label: 'Echtdaten' }]} onChange={(v) => actions.source?.(v)} aria-label="Datenquelle" />
        <Space size={8} title="Hinweise bei Überholmanövern">
          <Switch size="small" checked={!!ui.toasts} onChange={() => actions.toggleToasts?.()} aria-label="Überholungen anzeigen" />
          <span className="switch-l">Überholungen</span>
        </Space>
        <div className="status"><span className={`dot ${dot}`} />{txt}</div>
      </div>
    </header>
  );
}

function Banner({ state }) {
  const s = state.session;
  const since = s.flagSince ? ` · seit ${fmtClock((state.now - s.flagSince) / 1000)}` : '';
  const lapTxt = s.lap ? `Runde ${s.lap}${s.totalLaps ? '/' + s.totalLaps : ''}` : '';
  const big = (cls, title, sub) => (
    <div className={`banner ${cls}`} role="status"><h2 className="disp">{title}</h2><span className="sub">{sub}{since}</span><span className="sp" /><span className="bx mono">{lapTxt}</span></div>
  );
  switch (state.flag) {
    case 'sc': return big('sc', 'Safety Car', 'Überholen verboten · Delta-Zeit beachten');
    case 'vsc': return big('sc', 'Virtual Safety Car', 'Delta-Zeit einhalten · Überholen verboten');
    case 'yellow': return big('sc', 'Gelbe Flagge', 'Gefahr auf der Strecke');
    case 'red': return big('rf', 'Rote Flagge', 'Session unterbrochen');
    case 'chequered': return <div className="banner ok" role="status"><span className="dot" /><span className="label strong">Zielflagge · Session beendet</span></div>;
    default: {
      const w = state.weather;
      const wtxt = w ? `Luft ${w.air} °C · Strecke ${w.track} °C${w.rain ? ' · Regen' : ' · trocken'}` : '';
      const left = (s.type === 'quali' || s.type === 'practice') && s.remaining != null ? `Grüne Flagge · Verbleibend ${fmtClock(s.remaining)}` : s.type === 'upcoming' ? 'Nächste Session' : 'Strecke frei · Grüne Flagge';
      return <div className="banner ok" role="status"><span className={`dot ${s.type === 'upcoming' ? '' : 'g'}`} /><span className="label strong">{left}</span><span className="sp" /><span className="label">{wtxt}</span></div>;
    }
  }
}

function DemoToolbar({ actions }) {
  const b = (ev, t) => <Button key={ev} size="small" onClick={() => actions.trigger?.(ev)}>{t}</Button>;
  return (
    <div className="demo" role="toolbar" aria-label="Demo-Steuerung">
      <span className="label">Demo-Ereignis</span>
      {b('green', 'Grün')}{b('yellow', 'Gelb')}{b('sc', 'Safety Car')}{b('vsc', 'VSC')}{b('red', 'Rote Flagge')}{b('rain', 'Regen')}
      <span className="label" style={{ marginLeft: 'auto' }}>Simulierte Daten</span>
    </div>
  );
}

const SPEEDS = [1, 2, 4, 8];

/** Steuerung der Wiederholung einer echten Session: Pause, Tempo, Sprung auf der Zeitleiste. */
/** Abspielbare Rennen (beendet oder laufend, mit OpenF1-Session), nach Saison gruppiert, neueste zuerst. */
function raceOptions(seasons = {}) {
  return Object.keys(seasons).sort((a, b) => b - a).map((y) => ({
    label: y,
    options: seasons[y].filter((r) => r.key != null && r.status !== 'upcoming').reverse().map((r) => ({ value: r.key, label: `R${r.round} · ${r.meeting}`, race: r })),
  })).filter((g) => g.options.length);
}

function ReplayBar({ replay, session, seasons, actions }) {
  const [drag, setDrag] = useState(null);
  const span = Math.max(1, replay.end - replay.start);
  const frac = Math.min(1, Math.max(0, (replay.t - replay.start) / span));
  const shown = drag ?? frac * 1000;
  const speeds = SPEEDS.includes(replay.speed) ? SPEEDS : [...SPEEDS, replay.speed].sort((a, b) => a - b);
  const at = (v) => fmtClock(((v / 1000) * span) / 1000);
  return (
    <div className="demo replaybar" role="toolbar" aria-label="Steuerung der Wiederholung">
      <Button size="small" type="primary" icon={replay.paused ? <CaretRightFilled /> : <PauseOutlined />} onClick={() => actions.replay?.pause(!replay.paused)} aria-label={replay.paused ? 'Fortsetzen' : 'Pausieren'} />
      <Button size="small" icon={<StepBackwardOutlined />} onClick={() => actions.replay?.seek(0)} aria-label="Zum Start" title="Zum Start der Session" />
      <Segmented size="small" value={replay.speed} options={speeds.map((v) => ({ value: v, label: `${v}×` }))} onChange={(v) => actions.replay?.speed(v)} aria-label="Tempo" />
      <Select
        size="small" className="raceselect" showSearch optionFilterProp="label" value={session.key} placeholder={session.name || 'Rennen wählen'}
        options={raceOptions(seasons)} onOpenChange={(o) => o && actions.loadSeasons?.()} onChange={(_, o) => actions.openRace?.(o.race)}
        notFoundContent="Keine Rennen geladen" aria-label="Rennen wählen" popupMatchSelectWidth={false}
      />
      <Slider className="replayslider" min={0} max={1000} value={shown} tooltip={{ formatter: (v) => at(v) }} onChange={setDrag} onChangeComplete={(v) => { setDrag(null); actions.replay?.seek(v / 1000); }} aria-label="Position in der Session" />
      <span className="mono replaytime">{at(shown)} <span className="muted">/ {at(1000)}</span></span>
      {replay.loading && <span className="label"><Spin size="small" /> Lade Daten …</span>}
      <span className="label" style={{ marginLeft: 'auto' }}>Wiederholung · echte Daten</span>
    </div>
  );
}

/** Kopfzeile, Hinweise, Banner. */
export function Chrome({ state, ui, actions = {} }) {
  return (
    <>
      <h1 className="sr-only">Pitwall – F1 Live-Dashboard</h1>
      <Topbar state={state} ui={ui} actions={actions} />
      {state.replay ? <ReplayBar replay={state.replay} session={state.session} seasons={ui.seasons} actions={actions} /> : ui.sim && <DemoToolbar actions={actions} />}
      {state.problem && <Alert className="problem" type="warning" showIcon banner role="alert" message={state.problem} />}
      {ui.view !== 'calendar' && <Banner state={state} />}
    </>
  );
}
