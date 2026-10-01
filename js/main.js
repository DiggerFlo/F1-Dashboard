import { renderApp } from './views.js';
import { createDemoSource } from './sources/demo.js';
import { createOpenF1Source } from './sources/openf1.js';

const params = new URLSearchParams(location.search);
const root = document.getElementById('app');
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
  const keep = active && root.contains(active) ? { sel: active.dataset.num ? `[data-num="${active.dataset.num}"]` : active.dataset.action ? `[data-action="${active.dataset.action}"]${active.dataset.type ? `[data-type="${active.dataset.type}"]` : ''}` : null } : null;
  const scroll = ['.sidebody', '.tw'].map((q) => { const e = root.querySelector(q); return e ? [q, e.scrollTop, e.scrollLeft] : null; });
  const top = state.drivers[0];
  const ref = top && top.num !== ui.sel ? hist.get(top.num) : null;
  root.innerHTML = renderApp(state, ui, hist, ref);
  for (const s of scroll) if (s) { const e = root.querySelector(s[0]); if (e) { e.scrollTop = s[1]; e.scrollLeft = s[2]; } }
  if (keep?.sel) root.querySelector(keep.sel)?.focus({ preventScroll: true });
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
