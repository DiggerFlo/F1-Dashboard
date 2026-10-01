import { renderChrome, renderMain, renderSideHead } from './views.js';
import { createFeed } from './feed.js';
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
const ui = { sel: null, demo: false };
const hist = new Map();
let state = null;

const source = params.get('source') === 'openf1'
  ? createOpenF1Source({ token: params.get('token'), speed: Number(params.get('speed')) || 8, sessionKey: params.get('session'), wantType: params.get('type') })
  : createDemoSource({ scenario: params.get('scenario') || 'auto' });
ui.demo = source.demo;

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
  $('mainc').innerHTML = renderMain(state, ui, hist, ref);
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
    if (a === 'tab') source.select(act.dataset.type);
    else if (a.startsWith('ev-')) source.trigger(a.slice(3));
    return;
  }
  const row = e.target.closest('tr[data-num]');
  if (row) { ui.sel = Number(row.dataset.num); render(); }
});
root.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest?.('tr[data-num]');
  if (row) { e.preventDefault(); ui.sel = Number(row.dataset.num); render(); }
});

source.start((s) => { state = s; remember(s); render(); });
