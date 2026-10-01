import { useEffect, useRef, useState } from 'react';
import { Button, Card, Segmented } from 'antd';
import { BorderOutlined, ColumnWidthOutlined, FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';
import { trackSvg } from '../../js/track.js';
import { LIGHTS, lightsFor, isRaceLabel } from '../../js/startlights.js';
import { Html, Swatch } from './bits.jsx';

const MODES = [
  { value: 'normal', title: 'Standard', label: <span aria-label="Standard" title="Standard"><BorderOutlined /></span> },
  { value: 'wide', title: 'Kino: volle Breite', label: <span aria-label="Kino" title="Kino: volle Breite"><ColumnWidthOutlined /></span> },
];

const DISPLAY_LAG_MS = 600;

/** Startampel über der Karte. Tickt selbst (100 ms), damit die Sekundenschritte auch bei seltenen Datenständen stimmen. */
export function StartLights({ startsAt, now, speed = 1, per = 1 }) {
  // Wiederholung: now läuft mit speed (0 = Pause) durch; per bremst die Ampel bei hohem Tempo, damit die Lichter sichtbar bleiben
  const anchor = useRef({ now: null, wall: 0 });
  if (anchor.current.now !== now || anchor.current.wall === 0) anchor.current = { now, wall: Date.now() }; // Anker nur bei neuem Datenstand
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 100); return () => clearInterval(id); }, []);
  // Die Karte zeigt die Autos einen Datenstand (~0,6 s) später als die Daten, die Ampel wartet darauf
  const virt = (now ?? anchor.current.wall) + (Date.now() - anchor.current.wall - DISPLAY_LAG_MS) * speed;
  const l = lightsFor((startsAt - virt) / 1000 / per);
  if (!l.visible) return null;
  return (
    <div className={`slights${l.go ? ' go' : ''}`} role="img" aria-label={l.go ? 'Start: alle Lichter aus' : `Startampel: ${l.lit} von ${LIGHTS} Lichtern`}>
      {Array.from({ length: LIGHTS }, (_, i) => <span key={i} className={i < l.lit ? 'on' : ''}><i /><i /></span>)}
      {l.go && <b>Lights out</b>}
    </div>
  );
}

/**
 * Streckenkarte in drei Größen: Standard (neben der Spitzengruppe), Kino (volle Breite über dem Inhalt,
 * die Seite scrollt weiter) und Vollbild (Browser-Vollbild, ersatzweise Overlay). overlay erscheint nur im Vollbild.
 */
/** Leiste unter der Karte: Autos, die gerade in der Boxengasse sind, mit laufender Zeit seit der Einfahrt. Feste Höhe, damit nichts springt. */
function PitBox({ drivers, now }) {
  const list = drivers.filter((d) => d.pit && d.pitSince != null);
  return (
    <div className={`pitbox${list.length ? ' on' : ''}`} role="status" aria-label="Boxengasse">
      <span className="label">Boxengasse</span>
      {list.length ? list.map((d) => <span key={d.num} className="pbchip"><Swatch color={d.color} team={d.team} /><span className="code">{d.code}</span><span className="mono">{Math.max(0, (now - d.pitSince) / 1000).toFixed(1).replace('.', ',')} s</span></span>) : <span className="muted">frei</span>}
    </div>
  );
}

export function MapCard({ html, label, circuit, mode = 'normal', onMode, overlay, lights, lap, pitbox }) {
  const ref = useRef(null);
  const [native, setNative] = useState(false);
  const [fake, setFake] = useState(false);
  const full = native || fake;

  useEffect(() => {
    const onChange = () => setNative(document.fullscreenElement === ref.current);
    const onKey = (e) => { if (e.key === 'Escape') setFake(false); };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('fullscreenchange', onChange); document.removeEventListener('keydown', onKey); };
  }, []);

  function toggleFull() {
    if (native) { document.exitFullscreen?.(); return; }
    if (fake) { setFake(false); return; }
    const el = ref.current;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => setFake(true));
    else setFake(true);
  }

  return (
    <Card className={`map${full ? ' is-full' : ''}`} ref={ref} actions={pitbox ? [pitbox] : undefined}>
      <div className="cap mhead">
        <div className="mtitle">
          <span className="mname">{label}</span>
          {lap && <span className="mlap mono">{lap}</span>}
          {circuit && <span className="mcirc">{circuit}</span>}
        </div>
        {lights}
        <div className="mapctl">
          {onMode && <Segmented className="msize" size="small" value={mode} options={MODES} onChange={onMode} aria-label="Größe der Karte" />}
          <Button className="mfull" type="text" size="small" icon={full ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={toggleFull} aria-label={full ? 'Vollbild beenden' : 'Vollbild'} title={full ? 'Vollbild beenden (Esc)' : 'Vollbild'} />
        </div>
      </div>
      <Html html={html} />
      {full && overlay && <div className="fs-leaders">{overlay}</div>}
    </Card>
  );
}

/** Karte für den aktuellen Zustand (Vorschau: nur Layout, sonst mit Fahrern und Auswahl). */
export function StateMap({ state, ui, actions = {}, overlay }) {
  const up = state.session.type === 'upcoming';
  const t = state.session.type;
  const label = up ? 'Streckenlayout' : t === 'quali' ? 'Qualifying' : t === 'practice' ? 'Training' : 'Rennen';
  const lap = !up && t === 'race' && state.session.lap ? `Runde ${state.session.lap}${state.session.totalLaps ? ` / ${state.session.totalLaps}` : ''}` : null;
  const circuit = up ? state.upcoming?.circuit || '' : state.session.circuit || '';
  const u = state.upcoming;
  const sl = state.startLights; // Demo-Rennen: Ampel mit Wanduhr-Zeiten
  const lights = sl ? <StartLights startsAt={sl.startsAt} now={sl.now} speed={sl.speed} per={sl.per} /> : up && u?.startsAt && isRaceLabel(u.nextLabel) ? <StartLights startsAt={u.startsAt} now={state.now} /> : null;
  return <MapCard html={up ? trackSvg(state, null) : trackSvg(state, ui.sel, ui.pos)} label={label} circuit={circuit} lap={lap} pitbox={!up ? <PitBox drivers={state.drivers} now={state.now} /> : null} mode={ui.mapMode} onMode={actions.mapMode} overlay={overlay} lights={lights} />;
}
