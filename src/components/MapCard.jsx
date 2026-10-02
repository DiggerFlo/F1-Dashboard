import { useEffect, useRef, useState } from 'react';
import { Button, Card, Dropdown, Segmented } from 'antd';
import { BorderOutlined, ColumnWidthOutlined, EnvironmentOutlined, FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';
import { trackSvg, trackView } from '../../js/track.js';
import { LIGHTS, lightsFor, isRaceLabel } from '../../js/startlights.js';
import { Html, Swatch } from './bits.jsx';
import { Basemap } from './Basemap.jsx';
import { STYLES, STYLE_IDS } from '../../js/basemap.js';
import { t, dec } from '../../js/i18n.js';

const modes = () => [
  { value: 'normal', title: t('map.standard'), label: <span aria-label={t('map.standard')} title={t('map.standard')}><BorderOutlined /></span> },
  { value: 'wide', title: t('map.cinemaTip'), label: <span aria-label={t('map.cinema')} title={t('map.cinemaTip')}><ColumnWidthOutlined /></span> },
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
    <div className={`slights${l.go ? ' go' : ''}`} role="img" aria-label={l.go ? t('map.lightsOut') : t('map.lights', { lit: l.lit, total: LIGHTS })}>
      {Array.from({ length: LIGHTS }, (_, i) => <span key={i} className={i < l.lit ? 'on' : ''}><i /><i /></span>)}
      {l.go && <b>{t('map.lightsOutText')}</b>}
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
    <div className={`pitbox${list.length ? ' on' : ''}`} role="status" aria-label={t('map.pitlane')}>
      <span className="label">{t('map.pitlane')}</span>
      {list.length ? list.map((d) => <span key={d.num} className="pbchip"><Swatch color={d.color} team={d.team} /><span className="code">{d.code}</span><span className="mono">{dec(Math.max(0, (now - d.pitSince) / 1000).toFixed(1))} s</span></span>) : <span className="muted">{t('map.pitlaneFree')}</span>}
    </div>
  );
}

/** Schalter für den Kartenhintergrund: Aus, Karte, Satellit. */
function BaseMenu({ value, onChange }) {
  const items = ['off', ...STYLE_IDS].map((k) => ({ key: k, label: t(`map.base.${k}`) }));
  return (
    <Dropdown trigger={['click']} placement="bottomRight" menu={{ items, selectable: true, selectedKeys: [value], onClick: ({ key }) => onChange?.(key) }}>
      <Button className={`mbase${value !== 'off' ? ' on' : ''}`} type="text" size="small" icon={<EnvironmentOutlined />} aria-label={`${t('map.base')}: ${t(`map.base.${value}`)}`} title={t('map.base')} />
    </Dropdown>
  );
}

export function MapCard({ html, label, circuit, mode = 'normal', onMode, overlay, lights, pitbox, basemap, baseCtl, ar = 1.5 }) {
  const ref = useRef(null);
  const [native, setNative] = useState(false);
  const [fake, setFake] = useState(false);
  const full = native || fake;
  // Seitenspalte (links, Bedienelemente untereinander) nur, wenn die Karte breit genug ist: 8 rem für die Spalte plus 28 rem Streckenhöhe mal Seitenverhältnis
  const [side, setSide] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setSide(e.contentRect.width >= (8 + 28 * ar) * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ar]);

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
    <Card className={`map${full ? ' is-full' : ''}${side ? ' sidecol' : ''}`} ref={ref} actions={pitbox ? [pitbox] : undefined}>
      <div className="cap mhead">
        <div className="mtitle">
          <span className="mname">{label}</span>
          {circuit && <span className="mcirc">{circuit}</span>}
        </div>
        {lights}
        <div className="mapctl">
          {baseCtl && <BaseMenu value={baseCtl.value} onChange={baseCtl.onChange} />}
          {onMode && <Segmented className="msize" size="small" vertical={side && !full} value={mode} options={modes()} onChange={onMode} aria-label={t('map.size')} />}
          <Button className="mfull" type="text" size="small" icon={full ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={toggleFull} aria-label={full ? t('map.fullscreenExit') : t('map.fullscreen')} title={full ? t('map.fullscreenExitEsc') : t('map.fullscreen')} />
        </div>
      </div>
      <div className={`mapstack${basemap ? ' has-base' : ''}`}>
        {basemap}
        <Html html={html} className="mapfg" />
      </div>
      {basemap && <span className="mapattr">© <a href="https://www.esri.com" target="_blank" rel="noopener noreferrer">{STYLES[baseCtl?.value]?.attr || 'Esri'}</a></span>}
      {full && overlay && <div className="fs-leaders">{overlay}</div>}
    </Card>
  );
}

/** Karte für den aktuellen Zustand (Vorschau: nur Layout, sonst mit Fahrern und Auswahl). */
export function StateMap({ state, ui, actions = {}, overlay }) {
  const up = state.session.type === 'upcoming';
  const type = state.session.type;
  const label = up ? t('map.layout') : t(`tab.${state.session.kind || type}`);
  const circuit = up ? state.upcoming?.circuit || '' : state.session.circuit || '';
  const u = state.upcoming;
  const sl = state.startLights; // Demo-Rennen: Ampel mit Wanduhr-Zeiten
  const lights = sl ? <StartLights startsAt={sl.startsAt} now={sl.now} speed={sl.speed} per={sl.per} /> : up && u?.startsAt && isRaceLabel(u.nextLabel) ? <StartLights startsAt={u.startsAt} now={state.now} /> : null;
  // Kartenhintergrund nur, wenn die Strecke ein ausgerichtetes Layout hat (circuit-geo.json) und er nicht ausgeschaltet ist
  const geoEntry = state.track?.layoutId ? ui.geo?.[state.track.layoutId] : null;
  const style = ui.basemap || 'map';
  const showBase = !!geoEntry && style !== 'off';
  const basemap = showBase ? <Basemap track={state.track} geo={geoEntry} style={style} /> : null;
  const baseCtl = geoEntry ? { value: style, onChange: actions.basemap } : null;
  const view = state.track?.points?.length ? trackView(state.track) : null;
  const ar = view ? view.vw / view.vh : 1.5;
  return <MapCard html={up ? trackSvg(state, null, null, { base: showBase }) : trackSvg(state, ui.sel, ui.pos, { base: showBase })} label={label} circuit={circuit} pitbox={!up ? <PitBox drivers={state.drivers} now={state.now} /> : null} mode={ui.mapMode} onMode={actions.mapMode} overlay={overlay} lights={lights} basemap={basemap} baseCtl={baseCtl} ar={ar} />;
}
