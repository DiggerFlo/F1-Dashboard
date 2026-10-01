import { useEffect, useRef } from 'react';
import { Layout, Skeleton } from 'antd';
import { applyCarPositions } from '../js/track.js';
import { useDashboard } from './useDashboard.js';
import { Chrome } from './components/Chrome.jsx';
import { Main } from './components/Main.jsx';
import { Calendar } from './components/Calendar.jsx';
import { Feed } from './components/Feed.jsx';
import { LoadingOverlay } from './components/Loader.jsx';
import { StateMap } from './components/MapCard.jsx';
import { Top5 } from './components/Main.jsx';



function askKey() {
  try {
    let k = sessionStorage.getItem('openai_key');
    if (!k) { k = window.prompt('OpenAI-API-Key für Whisper (bleibt nur in diesem Tab, wird nur an api.openai.com gesendet):'); if (k) sessionStorage.setItem('openai_key', k.trim()); }
    return k && k.trim();
  } catch { return null; }
}

function Loading() {
  return <div className="main" aria-busy="true"><Skeleton.Node active style={{ width: '100%', height: 92 }}> </Skeleton.Node><Skeleton.Node active style={{ width: '100%', height: 360 }}> </Skeleton.Node></div>;
}

export function App() {
  const { state, ui, actions, hist, animator, params } = useDashboard();
  const root = useRef(null);

  // Fahrzeuge pro Bild entlang der Strecke bewegen (die Daten kommen nur alle 0,5 bis 2 s)
  useEffect(() => {
    let id;
    const frame = (now) => {
      const svg = root.current?.querySelector('svg[data-rot]');
      if (svg) applyCarPositions(svg, animator.sample(now));
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [animator]);

  useEffect(() => { document.title = `Pitwall · ${state?.session.name || 'Vorschau'}`; }, [state?.session.name]);

  if (!state) return <div className="app"><Loading /></div>;

  const top = state.drivers[0];
  const refHist = top && top.num !== ui.sel ? hist.get(top.num) : null;
  // Funk gibt es nur während einer Session, nicht in Vorschau und Kalender
  const hasFeed = state.session.type !== 'upcoming' && ui.view !== 'calendar';
  const sub = state.session.type === 'upcoming' ? 'Offline' : state.flag === 'sc' ? 'Safety Car' : state.flag === 'red' ? 'Unterbrochen' : 'Live';

  return (
    <Layout className="app" ref={root}>
      {ui.loading && <LoadingOverlay label={ui.loading.label} />}
      <a className="skip" href="#mainc">Zum Inhalt springen</a>
      <Chrome state={state} ui={ui} actions={actions} />
      {ui.cinema && (
        <div className="cinema">
          <StateMap state={state} ui={ui} actions={actions} overlay={state.session.type === 'upcoming' ? null : <Top5 state={state} sel={ui.sel} onPick={actions.pick} />} />
        </div>
      )}
      <div className={`shell${hasFeed ? (ui.feedOpen ? '' : ' rail') : ' nofeed'}`}>
        <Layout.Content className="main" id="mainc" tabIndex={-1}>
          {ui.view === 'calendar' ? <Calendar cal={ui.cal} ui={ui} db={ui.db} actions={actions} /> : <Main state={state} ui={ui} hist={hist} refHist={refHist} actions={actions} />}
        </Layout.Content>
        {hasFeed && <Feed items={[...state.feed, ...ui.events].sort((a, b) => b.t - a.t)} show={ui.show} onShow={actions.showKind} drivers={state.drivers} filter={ui.filter} onFilter={actions.filter} collapsed={!ui.feedOpen} onToggle={actions.toggleFeed} sub={sub} note={state.sourceNote || ''} proxy={params.get('proxy') ?? 'local'} getKey={askKey} />}
      </div>
      <footer className="foot">
        <span>Inoffizielles Fan-Projekt, nicht mit der Formula 1 oder einem Team verbunden.</span>
        <span>Daten: <a href="https://openf1.org" target="_blank" rel="noopener noreferrer">OpenF1</a></span>
        <span>Streckenlayouts: <a href="https://github.com/julesr0y/f1-circuits-svg" target="_blank" rel="noopener noreferrer">julesr0y/f1-circuits-svg</a> (CC BY 4.0)</span>
        <span>Strecken, Sektoren, Boxenverlust: <a href="https://multiviewer.app" target="_blank" rel="noopener noreferrer">MultiViewer</a></span>
        <span>UI: <a href="https://ant.design" target="_blank" rel="noopener noreferrer">Ant Design</a></span>
      </footer>
    </Layout>
  );
}
