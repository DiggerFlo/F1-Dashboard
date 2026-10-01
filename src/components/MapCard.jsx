import { useEffect, useRef, useState } from 'react';
import { Button, Card, Segmented } from 'antd';
import { BorderOutlined, ColumnWidthOutlined, FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';
import { trackSvg } from '../../js/track.js';
import { Html } from './bits.jsx';

const MODES = [
  { value: 'normal', label: 'Standard', icon: <BorderOutlined /> },
  { value: 'wide', label: 'Kino', icon: <ColumnWidthOutlined /> },
];

/**
 * Streckenkarte in drei Größen: Standard (neben der Spitzengruppe), Kino (volle Breite über dem Inhalt,
 * die Seite scrollt weiter) und Vollbild (Browser-Vollbild, ersatzweise Overlay). overlay erscheint nur im Vollbild.
 */
export function MapCard({ html, label, circuit, mode = 'normal', onMode, overlay }) {
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
    <Card className={`map${full ? ' is-full' : ''}`} ref={ref}>
      <div className="cap">
        <span className="label">{label}</span>
        <span className="mapctl">
          <span className="label">{circuit}</span>
          {onMode && <Segmented size="small" value={mode} options={MODES} onChange={onMode} aria-label="Größe der Karte" />}
          <Button size="small" icon={full ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={toggleFull} aria-label={full ? 'Vollbild beenden' : 'Vollbild'} title={full ? 'Vollbild beenden (Esc)' : 'Vollbild'} />
        </span>
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
  const label = up ? 'Streckenlayout' : `${t === 'quali' ? 'Qualifying' : t === 'practice' ? 'Training' : 'Rennen'}${state.session.lap ? ' · Runde ' + state.session.lap : ''}`;
  const circuit = up ? state.upcoming?.circuit || '' : state.session.circuit || '';
  return <MapCard html={up ? trackSvg(state, null) : trackSvg(state, ui.sel, ui.pos)} label={label} circuit={circuit} mode={ui.mapMode} onMode={actions.mapMode} overlay={overlay} />;
}
