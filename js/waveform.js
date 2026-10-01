// Wellenformen für Funksprüche: aus echten Audiodaten, aus dem gesprochenen Text (Demo) oder als Ersatz zufällig, aber stabil.

export const BARS = 44;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Dauer als m:ss */
export function fmtDur(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '0:00';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Ausschläge aus Audio-Samples: je Balken der größte Betrag im Abschnitt, auf 0..1 normiert (mit Mindesthöhe). */
export function peaksFromSamples(samples, n = BARS) {
  const out = new Array(n).fill(0);
  if (!samples || !samples.length) return out.map(() => 0.08);
  const step = samples.length / n;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step));
    let m = 0;
    for (let k = a; k < b && k < samples.length; k++) { const v = Math.abs(samples[k]); if (v > m) m = v; }
    out[i] = m;
  }
  const max = Math.max(...out) || 1;
  return out.map((v) => Math.max(0.08, clamp01(v / max)));
}

/** Zufallszahlen aus einem Text (stabil, damit die Form beim Neuzeichnen gleich bleibt). */
function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

/** Ersatzform, wenn das Audio nicht dekodiert werden kann: sprachähnliche Hüllkurve mit Pausen. */
export function pseudoPeaks(seed, n = BARS) {
  const r = rng(seed);
  const out = [];
  let level = 0.5;
  for (let i = 0; i < n; i++) {
    level = clamp01(level + (r() - 0.5) * 0.7);
    const pause = r() < 0.12;
    out.push(pause ? 0.1 : Math.max(0.15, level));
  }
  return out;
}

/** Form aus dem gesprochenen Text: Vokale laut, Konsonanten leiser, Leerzeichen und Satzzeichen als Pause. */
export function peaksFromText(text, n = BARS) {
  const s = String(text || '');
  if (!s) return pseudoPeaks('leer', n);
  const amp = [...s.toLowerCase()].map((c) => (/[aeiouyäöü]/.test(c) ? 0.95 : /[a-zß0-9]/.test(c) ? 0.55 : /[,.;:!?]/.test(c) ? 0.02 : 0.08));
  const r = rng(s);
  const out = [];
  const step = amp.length / n;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step));
    const part = amp.slice(a, b);
    const v = part.reduce((x, y) => x + y, 0) / part.length;
    out.push(Math.max(0.1, clamp01(v * (0.8 + r() * 0.4))));
  }
  const max = Math.max(...out) || 1;
  return out.map((v) => Math.max(0.1, v / max));
}

/** Geschätzte Sprechdauer in Sekunden (Funk wird schnell gesprochen). */
export function estimateSpeech(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.5, words * 0.38);
}

const cache = new Map();
let active = 0;
const queue = [];
let ctx = null;

function pump() {
  while (active < 2 && queue.length) { const job = queue.shift(); active++; job().finally(() => { active--; pump(); }); }
}

/** Audio laden und dekodieren -> { peaks, duration }. Höchstens zwei gleichzeitig, Ergebnisse werden gemerkt. */
export function loadPeaks(url, n = BARS, { fetchImpl = (...a) => fetch(...a), audioContext = null } = {}) {
  const key = `${url}|${n}`;
  if (cache.has(key)) return cache.get(key);
  const p = new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const res = await fetchImpl(url);
        if (!res.ok) throw new Error(`Audio ${res.status}`);
        const buf = await res.arrayBuffer();
        const c = audioContext || ctx || (ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)());
        const audio = await c.decodeAudioData(buf);
        resolve({ peaks: peaksFromSamples(audio.getChannelData(0), n), duration: audio.duration });
      } catch (e) { cache.delete(key); reject(e); }
    });
    pump();
  });
  cache.set(key, p);
  return p;
}
