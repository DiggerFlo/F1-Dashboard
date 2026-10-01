import { renderChrome, renderMain, renderSideHead, renderCalendar } from './views.js';
import { createFeed } from './feed.js';
import { detectOvertakes } from './overtakes.js';
import { createToasts } from './toasts.js';
import { createDemoSource } from './sources/demo.js';
import { createOpenF1Source } from './sources/openf1.js';

const params = new URLSearchParams(location.search);
const root = document.getElementById('app');
root.innerHTML = '<div id="chrome"></div><div class="shell"><main class="main" id="mainc"></main><aside class="side"><div class="sideh" id="sidehead"></div><div id="feedslot"></div><div class="fine" id="sidefoot"></div></aside></div>';
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
const sessionId = (s) => `${s.session.type}|${s.session.name}|${s.session.circuit}`;
const ui = { toasts: true, sel: null, demo: false, view: null, year: new Date().getFullYear(), cal: null, db: null };
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
  const key = ui.view || 'live';
  if (key !== lastKey) { lastKey = key; calDirty = true; }
  if (key === 'calendar') { if (calDirty) { $('mainc').innerHTML = renderCalendar(ui.cal, ui, ui.db); calDirty = false; } }
  else $('mainc').innerHTML = renderMain(state, ui, hist, ref);
  $('sidehead').innerHTML = renderSideHead(state);
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
  if (prevState && sessionId(prevState) === sessionId(s) && ui.toasts) detectOvertakes(prevState, s).slice(0, 3).forEach((o) => toasts.show(o));
  else toasts.clear();
  prevState = s; state = s; remember(s); render();
});
