import { esc, fmtTime } from './format.js';
import { enginesFor, transcribe } from './transcribe.js';

/**
 * Seitenleiste mit Funk und Race-Control. Die Elemente bleiben beim Aktualisieren bestehen,
 * damit Audio, offene Dropdowns und Transkripte nicht zurückgesetzt werden.
 */
export function createFeed({ proxy = null, getKey = () => null } = {}) {
  const el = document.createElement('div');
  el.className = 'sidebody';
  const nodes = new Map();
  const tstate = new Map(); // id -> { status, text, pct, error }

  function transcriptHtml(id) {
    const st = tstate.get(id);
    if (!st) return '';
    if (st.status === 'loading') return `<p class="tr muted" role="status">${st.pct != null ? `Modell wird geladen … ${st.pct} %` : 'Transkribiere …'}</p>`;
    if (st.status === 'error') return `<p class="tr err" role="alert">⚠ ${esc(st.error)}</p>`;
    return `<p class="tr"><span class="label">Transkript</span><br>${esc(st.text)}</p>`;
  }

  function paintTranscript(node, id) {
    node.querySelector('.trslot').innerHTML = transcriptHtml(id);
  }

  function create(m) {
    const node = document.createElement('div');
    node.dataset.id = m.id;
    if (m.kind === 'radio') {
      node.className = 'msg';
      const opts = enginesFor(m).map((e) => `<option value="${e.id}">${esc(e.label)}</option>`).join('');
      const player = m.url
        ? `<audio controls preload="none" src="${esc(m.url)}"></audio>`
        : m.speech ? '<button type="button" class="speak" data-speak>▶ Abspielen</button>' : '';
      node.innerHTML = `<div class="meta"><span class="who">${esc(m.code || '—')}</span><span class="t mono">${fmtTime(m.t)}</span><span class="tag">${esc(m.tag || 'FUNK')}</span></div>${m.text ? `<p>${esc(m.text)}</p>` : ''}${player}${
        m.url || m.speech ? `<select class="trsel" aria-label="Funkspruch transkribieren"><option value="">Transkribieren …</option>${opts}</select>` : ''}<div class="trslot"></div>`;
      node.addEventListener('change', (e) => {
        if (!e.target.classList.contains('trsel') || !e.target.value) return;
        run(m, node, e.target.value);
        e.target.value = '';
      });
      node.addEventListener('click', (e) => {
        if (!e.target.closest('[data-speak]')) return;
        const synth = window.speechSynthesis;
        if (!synth) return;
        if (synth.speaking) { synth.cancel(); return; }
        const u = new SpeechSynthesisUtterance(m.speech);
        u.lang = 'de-DE';
        synth.speak(u);
      });
    } else {
      const cls = m.level === 'red' ? ' rf' : m.level === 'yellow' ? ' fy' : '';
      node.className = `msg rc${cls}`;
      node.innerHTML = `<div class="meta"><span class="label">Race Control</span><span class="t mono">${fmtTime(m.t)}</span><span class="tag${m.level === 'yellow' ? ' y' : ''}">${esc(m.tag || 'INFO')}</span></div><p>${esc(m.text)}</p>`;
    }
    if (tstate.has(m.id)) paintTranscript(node, m.id);
    return node;
  }

  async function run(m, node, engine) {
    const st = { status: 'loading', pct: null };
    tstate.set(m.id, st);
    paintTranscript(node, m.id);
    try {
      let key = null;
      const text = await transcribe(engine, m, {
        proxy,
        getKey: () => (key = getKey()),
        onProgress: (pct) => { st.pct = pct; paintTranscript(node, m.id); },
      });
      tstate.set(m.id, { status: 'done', text: text || '(kein Text erkannt)' });
    } catch (e) {
      tstate.set(m.id, { status: 'error', error: e.message });
    }
    paintTranscript(node, m.id);
  }

  function update(items) {
    const list = items.slice(0, 40);
    const keep = new Set(list.map((m) => m.id));
    for (const [id, n] of nodes) if (!keep.has(id)) { n.remove(); nodes.delete(id); }
    list.forEach((m, i) => {
      let n = nodes.get(m.id);
      if (!n) { n = create(m); nodes.set(m.id, n); }
      if (el.children[i] !== n) el.insertBefore(n, el.children[i] || null);
    });
    if (!list.length && !el.querySelector('.empty')) el.innerHTML = '<div class="empty">Noch keine Meldungen.</div>';
    else if (list.length) el.querySelector(':scope > .empty')?.remove();
  }

  return { el, update };
}
