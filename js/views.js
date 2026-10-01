import { esc, fmtLap, fmtSector, fmtGap, fmtClock, splitCountdown } from './format.js';
import { trackSvg, tracesSvg, miniTrackSvg } from './track.js';
import { findLayout } from './circuits.js';
import { samplePath } from './svgpath.js';
import { yearsFor } from './calendar.js';

/*
 * Normalisiertes Zustandsmodell (siehe README), das jede Datenquelle liefert:
 * { now, session:{type,name,meeting,circuit,lap,totalLaps,remaining,phase,startsAt,flagSince},
 *   flag:'green'|'yellow'|'sc'|'vsc'|'red'|'chequered', drivers:[...], feed:[...], weather, track, upcoming }
 */

const TABS = [['upcoming', 'Vorschau'], ['race', 'Rennen'], ['quali', 'Qualifying'], ['practice', 'Training'], ['calendar', 'Kalender']];

const tyre = (c) => {
  const k = (c || '?')[0].toLowerCase();
  const cls = k === 's' ? 's' : k === 'h' ? 'h' : '';
  return `<span class="tyre ${cls}" title="${esc(c || 'unbekannt')}">${esc((c || '?')[0].toUpperCase())}</span>`;
};
const sec = (v, c) => (c ? `<span class="${c}">${fmtSector(v)}</span>` : fmtSector(v));
const bar = (v, cls = '') => `<span class="bar ${cls}"><i style="width:${Math.round(v || 0)}%"></i></span>`;
const kpi = (l, v, d, c = '') => `<div class="card kpi"><span class="label">${esc(l)}</span><span class="v mono">${esc(v)}</span><span class="d mono ${c}">${esc(d)}</span></div>`;

function topbar(state, ui) {
  const type = ui.view === 'calendar' ? 'calendar' : state.session.type;
  const tabs = TABS.map(([k, n]) => `<button class="tab${k === type ? ' on' : ''}" data-action="tab" data-type="${k}">${n}</button>`).join('');
  const f = state.flag;
  let dot = 'g', txt = 'Live';
  if (type === 'upcoming') { dot = ''; txt = 'Nächste Session'; }
  else if (state.session.phase === 'replay') { dot = ''; txt = 'Wiederholung'; }
  else if (f === 'red') { dot = 'y'; txt = 'Unterbrochen'; }
  else if (f === 'sc' || f === 'vsc' || f === 'yellow') { dot = 'y'; txt = 'Live · Neutralisiert'; }
  else if (f === 'chequered') { dot = ''; txt = 'Beendet'; }
  else if (type === 'race') { dot = 'red'; }
  const lap = state.session.lap ? ` · Runde ${state.session.lap}${state.session.totalLaps ? '/' + state.session.totalLaps : ''}` : '';
  return `<header class="top"><div class="brand disp">Pitwall</div><nav class="tabs" aria-label="Session">${tabs}</nav><button type="button" class="hint" data-action="toggle-toasts" aria-pressed="${ui.toasts}" title="Hinweise bei Überholmanövern">Überholungen ${ui.toasts ? 'an' : 'aus'}</button><div class="live"><span class="dot ${dot}"></span>${esc(txt + (type === 'race' ? lap : ''))}</div></header>`;
}

function banner(state) {
  const s = state.session;
  const since = s.flagSince ? ` · seit ${fmtClock((state.now - s.flagSince) / 1000)}` : '';
  const lapTxt = s.lap ? `Runde ${s.lap}${s.totalLaps ? '/' + s.totalLaps : ''}` : '';
  switch (state.flag) {
    case 'sc':
      return `<div class="banner sc" role="status"><h2 class="disp">Safety Car</h2><span class="sub">Überholen verboten · Delta-Zeit beachten${since}</span><span class="sp"></span><span class="bx mono">${lapTxt}</span></div>`;
    case 'vsc':
      return `<div class="banner sc" role="status"><h2 class="disp">Virtual Safety Car</h2><span class="sub">Delta-Zeit einhalten · Überholen verboten${since}</span><span class="sp"></span><span class="bx mono">${lapTxt}</span></div>`;
    case 'yellow':
      return `<div class="banner sc" role="status"><h2 class="disp">Gelbe Flagge</h2><span class="sub">Gefahr auf der Strecke${since}</span><span class="sp"></span><span class="bx mono">${lapTxt}</span></div>`;
    case 'red':
      return `<div class="banner rf" role="status"><h2 class="disp">Rote Flagge</h2><span class="sub">Session unterbrochen${since}</span><span class="sp"></span><span class="bx mono">${lapTxt}</span></div>`;
    case 'chequered':
      return `<div class="banner ok" role="status"><span class="dot"></span><span class="label" style="color:#f5f5f3">Zielflagge · Session beendet</span></div>`;
    default: {
      const w = state.weather;
      const wtxt = w ? `Luft ${w.air} °C · Strecke ${w.track} °C${w.rain ? ' · Regen' : ' · trocken'}` : '';
      const left = (s.type === 'quali' || s.type === 'practice') && s.remaining != null ? `Grüne Flagge · Verbleibend ${fmtClock(s.remaining)}` : s.type === 'upcoming' ? 'Nächste Session' : 'Strecke frei · Grüne Flagge';
      return `<div class="banner ok" role="status"><span class="dot ${s.type === 'upcoming' ? '' : 'g'}"></span><span class="label" style="color:#f5f5f3">${esc(left)}</span><span class="sp"></span><span class="label">${esc(wtxt)}</span></div>`;
    }
  }
}

function kpisFor(state) {
  const s = state.session, d = state.drivers, f = state.flag;
  const lead = d[0];
  if (s.type === 'quali' || s.type === 'practice') {
    const pole = d.find((x) => x.best != null);
    const cut = s.cutoff ? d[s.cutoff - 1] : null;
    const on = d.filter((x) => x.onTrack).length;
    return [
      kpi(s.type === 'quali' ? 'Pole-Zeit' : 'Bestzeit', fmtLap(pole?.best), pole ? pole.code : '—', pole ? 'p' : 'muted'),
      s.type === 'quali' ? kpi('Cut-Off P' + (s.cutoff || '–'), fmtLap(cut?.best), cut?.best && pole?.best ? `+${(cut.best - pole.best).toFixed(3)} zur Pole` : '—', cut?.best ? 'y' : 'muted')
        : kpi('Fahrer mit Zeit', String(d.filter((x) => x.best != null).length), `von ${d.length}`, 'muted'),
      kpi('Verbleibend', fmtClock(s.remaining), s.name || '', 'muted'),
      kpi('Auf der Strecke', String(on), 'Fahrer', 'muted')].join('');
  }
  if (f === 'red') {
    const stopped = d.filter((x) => (x.speed || 0) === 0).length;
    return [
      kpi('Unterbrechung', fmtClock(s.flagSince ? (state.now - s.flagSince) / 1000 : null), `seit Runde ${s.lap || '–'}`, 'y'),
      kpi('Fahrzeuge steht', `${stopped}/${d.length}`, 'Geschwindigkeit 0', stopped === d.length ? 'g' : 'muted'),
      kpi('Reifenwechsel', 'Erlaubt', 'Boxengasse geschlossen', 'muted'),
      kpi('Restart', '—', 'Meldung Race Control abwarten', 'muted')].join('');
  }
  if (f === 'sc' || f === 'vsc') {
    const last = d[d.length - 1];
    return [
      kpi(f === 'sc' ? 'Safety Car seit' : 'VSC seit', fmtClock(s.flagSince ? (state.now - s.flagSince) / 1000 : null), `Runde ${s.lap || '–'}`, 'y'),
      kpi('Feldabstand', last?.gap != null ? `+${last.gap.toFixed(1)} s` : '—', 'Leader bis Letzter', 'muted'),
      kpi('Leader', lead?.code || '—', `P1 · ${lead ? Math.round(lead.speed || 0) : 0} km/h`, ''),
      kpi('Überholen', 'Verboten', f === 'sc' ? 'Safety Car' : 'Delta einhalten', 'y')].join('');
  }
  const fastest = d.filter((x) => x.best != null).sort((a, b) => a.best - b.best)[0];
  const pits = d.reduce((n, x) => n + (x.stops || 0), 0);
  return [
    kpi(s.type === 'race' ? 'Runde' : 'Session', s.type === 'race' ? `${s.lap || '–'}${s.totalLaps ? '/' + s.totalLaps : ''}` : s.name || '—', s.totalLaps && s.lap ? `${s.totalLaps - s.lap} Runden verbleibend` : '', 'muted'),
    kpi('Schnellste Runde', fmtLap(fastest?.best), fastest ? fastest.code : '—', 'p'),
    kpi('Leader', lead?.code || '—', lead ? `${Math.round(lead.speed || 0)} km/h` : '', ''),
    kpi('Boxenstopps', String(pits), 'gesamt', 'muted')].join('');
}

function timingTable(state, sel) {
  const s = state.session;
  const rows = state.drivers;
  if (!rows.length) return '<div class="empty">Keine Fahrerdaten verfügbar.</div>';
  if (s.type === 'quali' || s.type === 'practice') {
    const head = '<tr><th>Pos</th><th>Fahrer</th><th>Reifen</th><th class="r">Beste Zeit</th><th class="r">Abstand</th><th class="r">Letzte Runde</th><th class="r">S1</th><th class="r">S2</th><th class="r">S3</th><th>Status</th></tr>';
    const pole = rows.find((x) => x.best != null)?.best;
    const body = rows.map((d, i) => {
      const cls = [i === 0 ? 'lead' : '', d.num === sel ? 'sel' : '', s.cutoff && i === s.cutoff - 1 ? 'cut' : ''].join(' ').trim();
      const best = d.best != null ? (i === 0 ? `<span class="p">${fmtLap(d.best)}</span>` : fmtLap(d.best)) : '—';
      return `<tr class="${cls}" data-num="${d.num}" tabindex="0"><td class="pos">${d.pos}</td><td><span class="code" title="${esc(d.name || '')}">${esc(d.code)}</span></td><td>${tyre(d.tyre)}</td><td class="mono r">${best}</td><td class="mono r">${d.best != null && i ? fmtGap(d.best - pole) : i === 0 ? 'Pole' : '—'}</td><td class="mono r">${fmtLap(d.last)}</td>${[0, 1, 2].map((k) => `<td class="mono r">${sec(d.sectors?.[k], d.sectorCls?.[k])}</td>`).join('')}<td>${d.onTrack ? '<span class="drs">PUSH</span>' : '<span class="drs off">BOX</span>'}</td></tr>`;
    }).join('');
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }
  const head = '<tr><th>Pos</th><th>Fahrer</th><th>Reifen</th><th class="r">Abstand</th><th class="r">Intervall</th><th class="r">Letzte Runde</th><th class="r">S1</th><th class="r">S2</th><th class="r">S3</th><th class="r">km/h</th><th>Gas / Bremse</th><th class="r">Gang</th><th>DRS</th><th>Status</th></tr>';
  const frozen = state.flag === 'red';
  const body = rows.map((d, i) => {
    const cls = [i === 0 ? 'lead' : '', d.num === sel ? 'sel' : ''].join(' ').trim();
    const status = d.pit ? '<span class="pit">PIT</span>' : frozen ? '<span class="pit">BOX</span>' : '';
    return `<tr class="${cls}" data-num="${d.num}" tabindex="0"><td class="pos">${d.pos}</td><td><span class="code" title="${esc(d.name || '')}">${esc(d.code)}</span></td><td>${tyre(d.tyre)}</td><td class="mono r">${fmtGap(d.gap, i === 0)}</td><td class="mono r">${i === 0 ? '—' : fmtGap(d.interval)}</td><td class="mono r">${fmtLap(d.last)}</td>${[0, 1, 2].map((k) => `<td class="mono r">${sec(d.sectors?.[k], d.sectorCls?.[k])}</td>`).join('')}<td class="mono r">${d.speed != null ? Math.round(d.speed) : '—'}</td><td>${bar(d.throttle)} ${bar(d.brake, 'b')}</td><td class="mono r">${d.gear ?? '—'}</td><td>${d.drs ? '<span class="drs">DRS</span>' : '<span class="drs off">—</span>'}</td><td>${status}</td></tr>`;
  }).join('');
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function detail(state, sel, hist, ref) {
  const d = state.drivers.find((x) => x.num === sel) || state.drivers[0];
  if (!d) return '';
  const h = hist.get(d.num) || [];
  const f = state.flag;
  const legendRef = state.session.type === 'quali' ? '<span><i style="background:#b14bff"></i>Pole-Runde</span>' : '';
  return `<div class="sec"><div class="sech"><h3 class="disp">Telemetrie · ${esc(d.code)} · P${d.pos}</h3><span class="label">Letzte Samples</span></div><div class="two"><div class="card traces">${tracesSvg(h, state.session.type === 'quali' ? ref : null)}<div class="legend"><span><i></i>Geschwindigkeit</span><span><i style="background:#9a9aa6;height:2px"></i>Gas</span><span><i style="background:repeating-linear-gradient(90deg,#f5f5f3 0 4px,transparent 4px 7px);height:2px"></i>Bremse</span>${legendRef}</div></div><div class="kpis">${
    kpi('Geschwindigkeit', d.speed != null ? String(Math.round(d.speed)) : '—', 'km/h', 'muted')}${
    kpi('Gang / U/min', `${d.gear ?? '—'} · ${d.rpm != null ? (d.rpm / 1000).toFixed(1) + 'k' : '—'}`, 'Bereich 8.0–12.5k', f === 'sc' ? 'y' : 'muted')}${
    kpi('Gas / Bremse', `${Math.round(d.throttle || 0)}% / ${Math.round(d.brake || 0)}%`, d.brake > 0 ? 'bremst' : 'Gas', 'muted')}${
    kpi('DRS', d.drs ? 'Offen' : 'Zu', f === 'sc' || f === 'red' ? 'Gesperrt' : '', d.drs ? 'g' : 'muted')}</div></div></div>`;
}

function upcomingBody(state) {
  const u = state.upcoming || {};
  const cd = splitCountdown((u.startsAt - state.now) / 1000);
  const cell = (v, l) => `<div><span class="v disp mono">${String(v).padStart(2, '0')}</span><span class="label">${l}</span></div>`;
  const facts = (u.facts || []).map(([l, v]) => `<div><span class="label">${esc(l)}</span><div class="mono" style="font-size:18px;font-weight:700">${esc(v)}</div></div>`).join('');
  const hero = `<div class="card hl"><span class="label">${esc(u.nextLabel || 'Nächste Session')}</span><h2 class="disp big">${esc(u.meeting || '—')}</h2><span class="muted">${esc(u.circuit || '')}</span><div class="cd" style="margin-top:12px">${cell(cd.d, 'Tage')}${cell(cd.h, 'Std')}${cell(cd.m, 'Min')}${cell(cd.s, 'Sek')}</div><div style="margin-top:12px" class="two">${facts}</div></div>`;
  const rows = (arr) => (arr || []).map(([a, b]) => `<div class="row"><span>${esc(a)}</span><span class="mono">${esc(b)}</span></div>`).join('');
  const stand = (u.standings || []).map((r, i) => `<tr class="${i === 0 ? 'lead' : ''}"><td class="pos">${i + 1}</td><td><span class="code">${esc(r.code)}</span></td><td class="mono r">${r.points}</td><td class="mono r">${r.wins}</td></tr>`).join('');
  return `<div class="hero"><div class="card map"><div class="sech"><span class="label">Streckenlayout</span><span class="label">${esc(u.circuit || '')}</span></div>${trackSvg(state, null)}</div>${hero}</div>
  <div class="two"><div class="sec"><div class="sech"><h3 class="disp">Zeitplan</h3><span class="label">Ortszeit</span></div><div class="card">${rows(u.schedule)}</div></div><div class="sec"><div class="sech"><h3 class="disp">Wetter</h3><span class="label">Prognose</span></div><div class="card">${rows(u.weather)}</div></div></div>
  ${stand ? `<div class="sec"><div class="sech"><h3 class="disp">Fahrerwertung</h3><span class="label">Top 10</span></div><div class="tw"><table style="min-width:0"><thead><tr><th>Pos</th><th>Fahrer</th><th class="r">Punkte</th><th class="r">Siege</th></tr></thead><tbody>${stand}</tbody></table></div></div>` : ''}`;
}

export function renderSideHead(state) {
  const sub = state.session.type === 'upcoming' ? 'Offline' : state.flag === 'sc' ? 'Safety Car' : state.flag === 'red' ? 'Unterbrochen' : 'Live';
  return `<h3 class="disp">Funk</h3><span class="label">${sub}</span>`;
}

function toolbar(ui) {
  if (!ui.demo) return '';
  const b = (a, t) => `<button data-action="${a}">${t}</button>`;
  return `<div class="toolbar" role="toolbar" aria-label="Demo-Steuerung"><span class="label">Demo</span>${b('ev-green', 'Grün')}${b('ev-yellow', 'Gelb')}${b('ev-sc', 'Safety Car')}${b('ev-vsc', 'VSC')}${b('ev-red', 'Rote Flagge')}${b('ev-rain', 'Regen')}<span class="label" style="margin-left:auto">Simulierte Daten</span></div>`;
}

/** Kopfzeile, Banner und Hauptbereich. Die Seitenleiste lebt dauerhaft in main.js (Audio/Dropdowns). */
export function renderChrome(state, ui) {
  return `${topbar(state, ui)}${toolbar(ui)}${ui.view === 'calendar' ? '' : banner(state)}`;
}

export function renderMain(state, ui, hist, ref) {
  const t = state.session.type;
  if (t === 'upcoming') return upcomingBody(state);
  const label = t === 'quali' ? 'Qualifying' : t === 'practice' ? 'Training' : 'Rennen';
  const ttl = state.flag === 'sc' ? 'Live-Timing · Safety Car' : state.flag === 'red' ? 'Aufstellung beim Restart' : t === 'quali' ? 'Qualifying-Ergebnis' : t === 'practice' ? 'Trainingsergebnis' : 'Live-Timing';
  return `<div class="hero"><div class="card map"><div class="sech"><span class="label">Streckenlayout · ${label}${state.session.lap ? ' · Runde ' + state.session.lap : ''}</span><span class="label">${esc(state.session.circuit || '')}</span></div>${trackSvg(state, ui.sel)}</div><div class="kpis">${kpisFor(state)}</div></div>
    <div class="sec"><div class="sech"><h3 class="disp">${ttl}</h3><span class="label">Zeile anklicken für Telemetrie</span></div><div class="tw">${timingTable(state, ui.sel)}</div></div>
    ${detail(state, ui.sel, hist, ref)}`;
}

const miniCache = new Map();
function miniFor(db, race) {
  const k = `${race.circuit}|${race.location}|${race.year}`;
  if (miniCache.has(k)) return miniCache.get(k);
  let svg = '';
  const l = db && findLayout(db, { circuit_short_name: race.circuit, location: race.location, country_name: race.country, year: race.year }, race.year);
  if (l) svg = miniTrackSvg(samplePath(l.d, 140), l.rotate, `Streckenlayout ${race.meeting}`);
  miniCache.set(k, svg);
  return svg;
}

const STATUS = { done: ['Beendet', ''], live: ['Live', 'live'], upcoming: ['Geplant', ''] };

/** Rennkalender eines Jahres. cal = { year, races, demo } oder null während des Ladens. */
export function renderCalendar(cal, ui, db) {
  const years = yearsFor();
  const opts = years.map((y) => `<option value="${y}"${y === ui.year ? ' selected' : ''}>${y}</option>`).join('');
  const head = `<div class="sech"><h3 class="disp">Rennkalender</h3><label class="label" style="display:flex;gap:8px;align-items:center">Saison <select class="trsel" data-action="year" aria-label="Saison wählen">${opts}</select></label></div>`;
  if (!cal) return `<div class="sec">${head}<div class="empty">Kalender wird geladen …</div></div>`;
  if (cal.error) return `<div class="sec">${head}<div class="empty" role="alert">⚠ ${esc(cal.error)}</div></div>`;
  if (!cal.races.length) return `<div class="sec">${head}<div class="empty">Keine Rennen für ${cal.year} gefunden.</div></div>`;
  const done = cal.races.filter((r) => r.status === 'done').length;
  const fmt = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: '2-digit', month: 'short' });
  const cards = cal.races.map((r) => {
    const [label, cls] = STATUS[r.status];
    const nextTag = r.next && r.status !== 'live' ? '<span class="chip on">Nächstes Rennen</span>' : '';
    const live = r.status === 'live' ? '<span class="chip live"><span class="dot red"></span>Live</span>' : r.status === 'done' ? `<span class="chip">${label}</span>` : '';
    return `<button type="button" class="race${r.status === 'done' ? ' done' : ''}${r.next ? ' next' : ''}" data-action="open-race" data-key="${esc(r.key ?? '')}" data-circuit="${esc(r.circuit)}" aria-label="${esc(`Runde ${r.round}: ${r.meeting}, ${fmt.format(r.start)}`)}">
      <span class="rn disp">${String(r.round).padStart(2, '0')}</span>
      <span class="rt"><strong class="title">${esc(r.meeting)}</strong><span class="muted">${esc([r.location, r.country].filter(Boolean).join(' · '))}</span><span class="mono">${esc(fmt.format(r.start))}</span><span class="chips">${nextTag}${live}</span></span>
      <span class="rm">${miniFor(db, r)}</span></button>`;
  }).join('');
  const note = cal.demo ? '<p class="fine" style="padding:0">Demo: Strecken des Jahres mit erfundenen Terminen, alle 14 Tage ab Mitte März. Echte Termine: ?source=openf1</p>' : '';
  return `<div class="sec">${head}<p class="muted">${cal.races.length} Rennen · ${done} beendet</p><div class="cal">${cards}</div>${note}</div>`;
}
