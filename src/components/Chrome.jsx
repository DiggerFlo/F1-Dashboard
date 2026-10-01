import { useState } from 'react';
import { Alert, Button, Menu, Segmented, Select, Slider, Spin } from 'antd';
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
  const type = ui.view === 'calendar' ? 'calendar' : ui.pendingType || state.session.type;
  const { dot, txt } = statusOf(state);
  return (
    <header className="top">
      <a className="brand" href="./" aria-label="Pitwall, Startseite"><Mark /><span>Pitwall</span></a>
      <Menu mode="horizontal" selectedKeys={[type]} items={TABS.map(([key, label]) => ({ key, label }))} onClick={({ key }) => actions.tab?.(key)} className="tabs" aria-label="Ansicht" />
      <div className="top-r">
        <Segmented size="small" className="srcsw" value={ui.demo ? 'demo' : 'openf1'} options={[{ value: 'demo', label: 'Demo' }, { value: 'openf1', label: 'Echtdaten' }]} onChange={(v) => actions.source?.(v)} aria-label="Datenquelle" />
        <div className="status"><span className={`dot ${dot}`} />{txt}</div>
      </div>
    </header>
  );
}

/** Flaggen-Symbol (Mast mit wehendem Tuch), Farbe über currentColor. */
const FlagIcon = () => (
  <svg className="bicon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 2v20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M6 4c3-2 5 2 8 0s4-1 5 0v9c-1-1-2-2-5 0s-5-2-8 0z" fill="currentColor" /></svg>
);
const ChequeredIcon = () => (
  <svg className="bicon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 2v20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M7 4h12v10H7z" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M7 4h4v3.3H7zM15 4h4v3.3h-4zM11 7.3h4v3.4h-4zM7 10.7h4V14H7zM15 10.7h4V14h-4z" fill="currentColor" /></svg>
);
const RainIcon = () => (
  <svg className="bicon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 15a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 7.5 3.8 3.8 0 0 1 17.5 15z" fill="currentColor" /><path d="M8 18l-1.2 3M12.5 18l-1.2 3M17 18l-1.2 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
);
/** Safety-Car-Zeichen wie auf der Karte: gelbes Quadrat mit Kürzel. */
const CarBadge = ({ t }) => <span className="bicon sbadge" aria-hidden="true">{t}</span>;

/** Statusbanner unter der Kopfzeile: je Zustand Farbe, Symbol, Titel und Hinweis, rechts Kacheln für Runde, Dauer und Wetter. */
function Banner({ state }) {
  const s = state.session, w = state.weather;
  const lapTxt = s.lap ? `${s.lap}${s.totalLaps ? '/' + s.totalLaps : ''}` : '';
  const since = s.flagSince ? fmtClock((state.now - s.flagSince) / 1000) : '';
  const timed = (s.type === 'quali' || s.type === 'practice') && s.remaining != null;
  const up = s.type === 'upcoming';
  let st; // { cls, icon, title, sub, since }
  switch (state.flag) {
    case 'sc': st = { cls: 'yl', icon: <CarBadge t="SC" />, title: 'Safety Car', sub: 'Überholen verboten · Delta-Zeit beachten', since }; break;
    case 'vsc': st = { cls: 'yl', icon: <CarBadge t="VSC" />, title: 'Virtual Safety Car', sub: 'Delta-Zeit einhalten · Überholen verboten', since }; break;
    case 'yellow': st = { cls: 'yl', icon: <FlagIcon />, title: 'Gelbe Flagge', sub: 'Gefahr auf der Strecke', since }; break;
    case 'red': st = { cls: 'rd', icon: <FlagIcon />, title: 'Rote Flagge', sub: 'Session unterbrochen', since }; break;
    case 'chequered': st = { cls: 'ch', icon: <ChequeredIcon />, title: 'Zielflagge', sub: 'Session beendet' }; break;
    default:
      if (up) st = { cls: '', icon: <span className="dot" />, title: 'Nächste Session', sub: '' };
      else if (w?.rain) st = { cls: 'rn', icon: <RainIcon />, title: 'Regen', sub: timed ? `Verbleibend ${fmtClock(s.remaining)}` : 'Nasse Strecke · Reifenwahl beachten' };
      else st = { cls: 'go', icon: <FlagIcon />, title: 'Grüne Flagge', sub: timed ? `Verbleibend ${fmtClock(s.remaining)}` : 'Strecke frei' };
  }
  const chip = (k, v, cls = '') => <span className={`bchip${cls}`} key={k}><span className="label">{k}</span><span className="mono">{v}</span></span>;
  return (
    <div className={`banner ok${st.cls ? ' st ' + st.cls : ''}`} role="status">
      {st.icon}
      <h2 className="disp">{st.title}</h2>
      {st.sub && <span className="sub">{st.sub}</span>}
      <span className="sp" />
      {st.since && chip('Seit', st.since)}
      {lapTxt && chip('Runde', lapTxt)}
      {w && chip('Luft', `${w.air} °C`)}
      {w && chip('Strecke', `${w.track} °C`)}
      {w && chip(w.rain ? 'Regen' : 'Trocken', w.rain ? 'nass' : 'trocken', w.rain ? ' wet' : '')}
    </div>
  );
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

/** Transportleiste der Wiederholung: Wiedergabe und Tempo, Session, Zeitleiste mit Zeit links und rechts. */
function ReplayBar({ replay, session, seasons, actions }) {
  const [drag, setDrag] = useState(null);
  const span = Math.max(1, replay.end - replay.start);
  const frac = Math.min(1, Math.max(0, (replay.t - replay.start) / span));
  const shown = drag ?? frac * 1000;
  const speeds = SPEEDS.includes(replay.speed) ? SPEEDS : [...SPEEDS, replay.speed].sort((a, b) => a - b);
  const at = (v) => fmtClock(((v / 1000) * span) / 1000);
  const current = [session.name, session.circuit].filter(Boolean).join(' · ') || 'Session wählen';
  return (
    <div className="demo replaybar" role="toolbar" aria-label="Steuerung der Wiederholung">
      <div className="rb-ctl">
        <Button className="rb-play" type="primary" shape="circle" icon={replay.paused ? <CaretRightFilled /> : <PauseOutlined />} onClick={() => actions.replay?.pause(!replay.paused)} aria-label={replay.paused ? 'Fortsetzen' : 'Pausieren'} />
        <Button className="rb-sq" icon={<StepBackwardOutlined />} onClick={() => actions.replay?.seek(0)} aria-label="Zum Start" title="Zum Start der Session" />
        <Segmented className="rb-speed" size="small" value={replay.speed} options={speeds.map((v) => ({ value: v, label: `${v}×` }))} onChange={(v) => actions.replay?.speed(v)} aria-label="Tempo" />
      </div>
      <div className="rb-sess">
        <span className="label">Session</span>
        <Select
          size="small" className="raceselect" showSearch optionFilterProp="label" value={session.key} labelRender={() => current}
          options={raceOptions(seasons)} onOpenChange={(o) => o && actions.loadSeasons?.()} onChange={(_, o) => actions.openRace?.(o.race)}
          notFoundContent="Keine Rennen geladen" aria-label="Rennen wählen" popupMatchSelectWidth={false}
        />
      </div>
      <div className="rb-time">
        <span className="mono rb-now">{at(shown)}</span>
        <Slider className="replayslider" min={0} max={1000} value={shown} tooltip={{ formatter: (v) => at(v) }} onChange={setDrag} onChangeComplete={(v) => { setDrag(null); actions.replay?.seek(v / 1000); }} aria-label="Position in der Session" />
        <span className="mono rb-tot">{at(1000)}</span>
      </div>
      {replay.loading ? <span className="rb-load" role="status"><Spin size="small" /> Lädt Daten</span> : <span className="rb-src label">Echte Daten · OpenF1</span>}
    </div>
  );
}

/** Kopfzeile, Hinweise, Banner. */
export function Chrome({ state, ui, actions = {} }) {
  return (
    <>
      <h1 className="sr-only">Pitwall – F1 Live-Dashboard</h1>
      <Topbar state={state} ui={ui} actions={actions} />
      {ui.view === 'calendar' ? null : state.replay ? <ReplayBar replay={state.replay} session={state.session} seasons={ui.seasons} actions={actions} /> : ui.sim && <DemoToolbar actions={actions} />}
      {state.problem && <Alert className="problem" type="warning" showIcon banner role="alert" message={state.problem} />}
      {ui.view !== 'calendar' && <Banner state={state} />}
    </>
  );
}
