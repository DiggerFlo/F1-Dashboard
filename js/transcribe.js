// Transkription von Team-Funk komplett im Browser (Whisper via transformers.js, Modell wird einmal vom CDN geladen) oder, in der Simulation,
// aus dem bekannten Text der Demo. Es verlässt kein Audio den Browser.
import { t } from './i18n.js';

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
const LOCAL_MODEL = 'Xenova/whisper-tiny.en';

/** Engine einer Nachricht: Demo-Funk hat gesprochenen Text, echter Funk Audio. */
export const engineFor = (msg) => (msg.speech ? 'demo' : 'local');

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

async function demo(msg, { delay = 700 }) {
  await new Promise((res) => setTimeout(res, delay));
  return msg.speech;
}

/** Transkribiert eine Funknachricht ({url} oder {speech}). engine: 'local' (Browser) oder 'demo'. */
export async function transcribe(engine, msg, opts = {}) {
  if (engine === 'demo') return demo(msg, opts);
  if (!msg.url) throw new Error('Diese Nachricht hat kein Audio.');
  try {
    if (engine === 'local') return await local(msg, opts);
  } catch (e) {
    if (e instanceof TypeError) throw new Error(t('tr.err.network'));
    throw e;
  }
  throw new Error(t('tr.err.unknown', { engine }));
}

export function _resetForTests() { pipePromise = null; }
