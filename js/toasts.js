import { esc, safeColor } from './format.js';

/** Kleine Hinweise, die von der Seite hereinfahren (z. B. "VAL überholt KRN"). */
export function createToasts({ max = 4, ttl = 5000, cooldown = 8000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toasts';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const last = new Map();

  function show({ by, over, pos, byColor, overColor }) {
    const key = `${by}>${over}`;
    const now = Date.now();
    if (now - (last.get(key) || 0) < cooldown) return;
    last.set(key, now);
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span class="ar" aria-hidden="true"></span><span class="tx"><span class="tc" style="background:${safeColor(byColor) || 'var(--line)'}"></span><strong class="code">${esc(by)}</strong> überholt <span class="tc" style="background:${safeColor(overColor) || 'var(--line)'}"></span><strong class="code">${esc(over)}</strong></span><span class="mono muted">P${pos}</span>`;
    el.prepend(t);
    while (el.children.length > max) el.lastElementChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ttl);
  }

  return { el, show, clear() { el.innerHTML = ''; last.clear(); } };
}
