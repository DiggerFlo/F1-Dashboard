// Übersetzung (Deutsch/Englisch). t() ist rein und auch in der Datenschicht nutzbar; die Sprache ist ein kleiner globaler Zustand,
// auf den React über useLang (src/useLang.js) reagiert. Texte stehen in js/locales/de.js und en.js, Schlüssel sind in beiden gleich.
import de from './locales/de.js';
import en from './locales/en.js';

export const LANGS = ['de', 'en'];
const DICTS = { de, en };
const STORE_KEY = 'pitwall.lang';

let lang = 'de'; // Voreinstellung der Bibliothek; im Browser setzt initLang() die Sprache des Nutzers
const subs = new Set();

export const getLang = () => lang;
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export function setLang(next, { persist = true } = {}) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  if (persist) { try { localStorage.setItem(STORE_KEY, next); } catch { /* optional */ } }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  subs.forEach((fn) => fn());
}

/** Sprache im Browser bestimmen: ?lang=, gespeicherte Wahl, Browsersprache, sonst Deutsch. */
export function initLang() {
  let pick = null;
  try { pick = new URLSearchParams(location.search).get('lang') || localStorage.getItem(STORE_KEY); } catch { /* optional */ }
  if (!LANGS.includes(pick)) pick = typeof navigator !== 'undefined' && /^de\b/i.test(navigator.language || '') ? 'de' : typeof navigator !== 'undefined' && navigator.language ? 'en' : 'de';
  setLang(pick, { persist: false });
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

/**
 * Text zu einem Schlüssel; {name} wird ersetzt. Mit vars.n wird `${key}_one` bzw. `${key}_other` bevorzugt, wenn es sie gibt.
 * Fehlt ein Schlüssel in der Sprache, gilt der deutsche Text, sonst der Schlüssel selbst.
 */
export function t(key, vars) {
  const d = DICTS[lang];
  let s;
  if (vars && typeof vars.n === 'number') {
    const pk = `${key}_${vars.n === 1 ? 'one' : 'other'}`;
    s = d[pk] ?? DICTS.de[pk];
  }
  s = s ?? d[key] ?? DICTS.de[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : s;
}

/** Übersetzt, wenn der Text ein Schlüssel ist, sonst unverändert (z. B. Rennname statt "tab.race"). */
export const tl = (keyOrText) => (keyOrText in DICTS[lang] || keyOrText in DICTS.de ? t(keyOrText) : keyOrText);

/** BCP-47-Tag für Intl (Datum/Zeit) und für die Sprachausgabe. */
export const locale = () => (lang === 'de' ? 'de-CH' : 'en-GB');
export const speechLang = () => (lang === 'de' ? 'de-DE' : 'en-GB');

/** Dezimaltrenner der Sprache in einen mit Punkt formatierten Text einsetzen ("2.4 s" -> "2,4 s"). */
export const dec = (s) => (lang === 'de' ? String(s).replace('.', ',') : String(s));
