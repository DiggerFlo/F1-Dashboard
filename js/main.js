import { renderChrome, renderMain, renderSideHead, renderCalendar } from './views.js';
import { createFeed } from './feed.js';
import { detectOvertakes } from './overtakes.js';
import { createToasts } from './toasts.js';
import { createCarAnimator, applyCarPositions } from './track.js';
import { createDemoSource } from './sources/demo.js';
import { createOpenF1Source } from './sources/openf1.js';

const params = new URLSearchParams(location.search);
const root = document.getElementById('app');
root.innerHTML = `<a class="skip" href="#mainc">Zum Inhalt springen</a><div id="chrome"></div>
<div class="shell"><main class="main" id="mainc" tabindex="-1" aria-busy="true"><div class="kpis"><div class="skel" style="height:92px"></div><div class="skel" style="height:92px"></div><div class="skel" style="height:92px"></div><div class="skel" style="height:92px"></div></div><div class="skel" style="height:360px"></div><div class="skel" style="height:420px"></div></main>
<aside class="side" aria-label="Funk und Race Control"><div id="sidehead"></div><div id="feedslot"></div><div class="sidefoot" id="sidefoot"></div></aside></div>
<footer class="foot"><span>Inoffizielles Fan-Projekt, nicht mit der Formula 1 oder einem Team verbunden.</span><span>Daten: <a href="https://openf1.org" target="_blank" rel="noopener">OpenF1</a></span><span>Streckenlayouts: <a href="https://github.com/julesr0y/f1-circuits-svg" target="_blank" rel="noopener">julesr0y/f1-circuits-svg</a> (CC BY 4.0)</span></footer>`;
const $ = (id) => document.getElementById(id);
const feed = createFeed({
  proxy: params.get('proxy'),
  getKey: () => {
    try {
      let k = sessionStorage.getItem('openai_key');
      if (!k) { k = window.prompt('OpenAI-API-Key für Whisper (bleibt nur in diesem Tab, wird nur an api.openai.com gesendet):'); if (k) sessionStorage.setItem('openai_key', k.trim()); }
      return k && k.trim();
    } catch { return null; }
  },
});
$('feedslot').replaceWith(feed.el);
const toasts = createToasts();
document.body.appendChild(toasts.el);
let prevState = null;
const animator = createCarAnimator();
const sessionId = (s) => `${s.session.type}|${s.session.name}|${s.session.circuit}`;
const ui = { filter: 'all', toasts: true, sel: null, demo: false, view: null, year: new Date().getFullYear(), cal: null, db: null };
let lastKey = null, calDirty = true;
const hist = new Map();
let state = null;

const source = params.get('source') === 'openf1'
  ? createOpenF1Source({ token: params.get('token'), speed: Number(params.get('speed')) || 8, sessionKey: params.get('session'), wantType: params.get('type') })
  : createDemoSource({ scenario: params.get('scenario') || 'auto' });
ui.demo = source.demo;

fetch('data/circuits.json').then((r) => r.json()).then((db) => { ui.db = db; calDirty = true; render(); }).catch(() => {});

async function loadCalendar() {
  ui.cal = null; calDirty = true; render();
  const year = ui.year;
  try {
    const cal = await source.calendar(year, ui.db || (await (await fetch('data/circuits.json')).json()));
    if (ui.year === year) ui.cal = cal;
  } catch (e) {
    if (ui.year === year) ui.cal = { year, races: [], error: `Kalender konnte nicht geladen werden (${e.message}).` };
  }
  calDirty = true; render();
}

function remember(s) {
  for (const d of s.drivers) {
    if (d.speed == null) continue;
    const h = hist.get(d.num) || [];
    h.push({ speed: d.speed, throttle: d.throttle || 0, brake: d.brake || 0 });
    if (h.length > 120) h.shift();
    hist.set(d.num, h);
  }
}

function render() {
  if (!state) return;
  if (!state.drivers.some((d) => d.num === ui.sel)) ui.sel = state.drivers[2]?.num ?? state.drivers[0]?.num ?? null;
  const active = document.activeElement;
  const keep = active && root.contains(active) && (active.dataset.num || active.dataset.action)
    ? (active.dataset.num ? `[data-num="${active.dataset.num}"]` : `[data-action="${active.dataset.action}"]${active.dataset.type ? `[data-type="${active.dataset.type}"]` : ''}`) : null;
  const wrap = root.querySelector('.tw');
  const sc = wrap ? [wrap.scrollTop, wrap.scrollLeft] : null;
  const top = state.drivers[0];
  const ref = top && top.num !== ui.sel ? hist.get(top.num) : null;
  $('chrome').innerHTML = renderChrome(state, ui);
  ui.pos = animator.sample(performance.now());
  const key = ui.view || 'live';
  if (key !== lastKey) { lastKey = key; calDirty = true; }
  if (key === 'calendar') { if (calDirty) { $('mainc').innerHTML = renderCalendar(ui.cal, ui, ui.db); calDirty = false; } }
  else $('mainc').innerHTML = renderMain(state, ui, hist, ref);
  $('sidehead').innerHTML = renderSideHead(state, ui);
  feed.el.dataset.filter = ui.filter;
  $('mainc').removeAttribute('aria-busy');
  $('sidefoot').textContent = state.sourceNote || '';
  feed.update(state.feed);
  const w2 = root.querySelector('.tw');
  if (w2 && sc) { w2.scrollTop = sc[0]; w2.scrollLeft = sc[1]; }
  if (keep) root.querySelector(keep)?.focus({ preventScroll: true });
  document.title = `Pitwall · ${state.session.name || 'Vorschau'}`;
}

root.addEventListener('click', (e) => {
  const act = e.target.closest('[data-action]');
  if (act) {
    const a = act.dataset.action;
    if (a === 'tab') {
      if (act.dataset.type === 'calendar') { ui.view = 'calendar'; loadCalendar(); }
      else { ui.view = null; source.select(act.dataset.type); render(); }
    } else if (a === 'open-race') {
      ui.view = null;
      if (act.dataset.key) source.openRace(Number(act.dataset.key)); else source.openRace();
      render();
    }
    else if (a === 'feed-filter') { ui.filter = act.dataset.v; render(); }
    else if (a === 'pick') { ui.sel = Number(act.dataset.num); render(); }
    else if (a === 'toggle-toasts') { ui.toasts = !ui.toasts; if (!ui.toasts) toasts.clear(); render(); }
    else if (a.startsWith('ev-')) source.trigger(a.slice(3));
    return;
  }
  const row = e.target.closest('tr[data-num]');
  if (row) { ui.sel = Number(row.dataset.num); render(); }
});
root.addEventListener('change', (e) => {
  if (e.target.matches?.('[data-action="year"]')) { ui.year = Number(e.target.value); loadCalendar(); }
});
root.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest?.('tr[data-num]');
  if (row) { e.preventDefault(); ui.sel = Number(row.dataset.num); render(); }
});

source.start((s) => {
  const color = new Map(s.drivers.map((d) => [d.code, d.color]));
  if (prevState && sessionId(prevState) === sessionId(s) && ui.toasts) detectOvertakes(prevState, s).slice(0, 3).forEach((o) => toasts.show({ ...o, byColor: color.get(o.by), overColor: color.get(o.over) }));
  else { toasts.clear(); if (!prevState || sessionId(prevState) !== sessionId(s)) animator.reset(); }
  animator.update(s, performance.now());
  prevState = s; state = s; remember(s); render();
});

// Fahrzeuge pro Bild entlang der Strecke bewegen (die Daten kommen nur alle 0,5 bis 2 s)
function frame(now) {
  const svg = root.querySelector('svg[data-rot]');
  if (svg && state) applyCarPositions(svg, animator.sample(now));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
