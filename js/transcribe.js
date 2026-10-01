// Transkription von Team-Funk. Engines: lokal im Browser (Whisper via transformers.js),
// OpenAI-Whisper-API oder Demo (bekannter Text der Simulation).

export const ENGINES = [
  { id: 'local', label: 'Lokal im Browser (Whisper)' },
  { id: 'openai', label: 'OpenAI Whisper API' },
];
export const DEMO_ENGINE = { id: 'demo', label: 'Demo-Transkript' };

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
const LOCAL_MODEL = 'Xenova/whisper-tiny.en';

export const enginesFor = (msg) => (msg.speech ? [DEMO_ENGINE] : ENGINES);

/** Audio-URL, optional über einen Proxy (Vorlage mit {url}), falls die Quelle kein CORS erlaubt. */
export function audioUrl(url, proxy) {
  if (proxy === 'local') return url.replace(/^https:\/\/livetiming\.formula1\.com\//, '/f1static/'); // Proxy des Vite-Servers (siehe vite.config.js)
  return proxy ? proxy.replace('{url}', encodeURIComponent(url)) : url;
}

let pipePromise = null;

async function local(msg, { onProgress, proxy, loader }) {
  if (!pipePromise) {
    pipePromise = (loader || (() => import(/* @vite-ignore */ TRANSFORMERS_CDN)))()
      .then((m) => m.pipeline('automatic-speech-recognition', LOCAL_MODEL, {
        progress_callback: (p) => { if (p.status === 'progress' && onProgress) onProgress(Math.round(p.progress || 0)); },
      }))
      .catch((e) => { pipePromise = null; throw e; });
  }
  const pipe = await pipePromise;
  const out = await pipe(audioUrl(msg.url, proxy));
  return String(out.text || '').trim();
}

async function openai(msg, { proxy, getKey, fetchImpl }) {
  const key = getKey && getKey();
  if (!key) throw new Error('Kein API-Key angegeben.');
  const audio = await fetchImpl(audioUrl(msg.url, proxy));
  if (!audio.ok) throw new Error(`Audio nicht ladbar (${audio.status}). Evtl. blockiert CORS, siehe ?proxy=.`);
  const fd = new FormData();
  fd.append('file', await audio.blob(), 'radio.mp3');
  fd.append('model', 'whisper-1');
  const r = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
  if (!r.ok) throw new Error(`OpenAI-Fehler ${r.status}`);
  return String((await r.json()).text || '').trim();
}

async function demo(msg, { delay = 700 }) {
  await new Promise((res) => setTimeout(res, delay));
  return msg.speech;
}

/** Transkribiert eine Funknachricht ({url} oder {speech}) mit der gewählten Engine. */
export async function transcribe(engine, msg, opts = {}) {
  const o = { fetchImpl: globalThis.fetch?.bind(globalThis), ...opts };
  if (engine === 'demo') return demo(msg, o);
  if (!msg.url) throw new Error('Diese Nachricht hat kein Audio.');
  try {
    if (engine === 'local') return await local(msg, o);
    if (engine === 'openai') return await openai(msg, o);
  } catch (e) {
    if (e instanceof TypeError) throw new Error('Audio oder Modell konnte nicht geladen werden (Netzwerk/CORS). Mit ?proxy=… lässt sich ein Proxy setzen.');
    throw e;
  }
  throw new Error(`Unbekannte Engine: ${engine}`);
}

export function _resetForTests() { pipePromise = null; }
