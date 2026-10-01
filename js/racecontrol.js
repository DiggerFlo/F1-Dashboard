import { t, tl } from './i18n.js';

// Race-Control-Meldungen (englisch, GROSSBUCHSTABEN) für die Anzeige aufbereiten: Überschrift in der Sprache der Oberfläche, Art, Farbton, genannte Fahrer.
// Unbekannte Meldungen (und die deutschen der Demo) bleiben im Wortlaut, nur Großschreibung wird beruhigt.

/** Sätze in normaler Schreibweise; Texte, die schon normal geschrieben sind, bleiben unverändert. */
export function sentence(txt) {
  const str = String(txt || '').trim();
  const letters = str.replace(/[^A-Za-zÄÖÜäöü]/g, '');
  if (letters.length < 4 || letters.replace(/[^A-ZÄÖÜ]/g, '').length / letters.length < 0.8) return str;
  return str.toLowerCase()
    .replace(/(^\s*|[.:!?]\s+|-\s+)([a-zäöü])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(fia|f1|drs|vsc|sc|dnf|dns|dsq)\b/g, (w) => w.toUpperCase())
    .replace(/\(([a-z]{3})\)/g, (m, c) => `(${c.toUpperCase()})`);
}

const CAT = ['flag', 'sc', 'ovt', 'weather', 'track', 'pit', 'steward', 'info']; // Schlüssel rc.cat.*

/**
 * @returns { tone: 'yellow'|'red'|'green'|'blue'|'steward'|'info', icon, cat, title, detail, codes }
 * m: { text, tag?, level? } wie in state.feed (kind 'rc').
 */
export function describeRc(m) {
  const raw = String(m.text || '').trim();
  const stew = /^FIA STEWARDS/i.test(raw); // das Präfix steckt schon in der Art "Rennkommissare"
  const text = raw.replace(/^FIA STEWARDS:\s*/i, '');
  const T = text.toUpperCase();
  const codes = [...new Set([...text.matchAll(/\(([A-Z]{3})\)/g)].map((x) => x[1]))];
  const num = (re) => (T.match(re) || [])[1];
  const sector = num(/SECTOR (\d+)/), turn = num(/TURN (\d+)/);
  const mk = (tone, icon, cat, title, detail = null) => ({ tone, icon, cat: CAT.includes(cat) ? t(`rc.cat.${cat}`) : cat, title, detail, codes });
  let r = null;
  if (/^DOUBLE YELLOW IN TRACK SECTOR/.test(T)) r = mk('yellow', 'warn', 'flag', t('rc.doubleYellow', { n: sector }));
  else if (/^YELLOW IN TRACK SECTOR/.test(T)) r = mk('yellow', 'warn', 'flag', t('rc.yellow', { n: sector }));
  else if (/^CLEAR IN TRACK SECTOR/.test(T)) r = mk('green', 'ok', 'flag', t('rc.clearSector', { n: sector }));
  else if (/^TRACK CLEAR/.test(T)) r = mk('green', 'ok', 'flag', t('rc.trackClear'));
  else if (/RED FLAG/.test(T)) r = mk('red', 'flag', 'flag', t('rc.red'), sentence(text));
  else if (/CHEQUERED/.test(T)) r = mk('info', 'flag', 'flag', t('rc.chequered'));
  else if (/BLACK AND WHITE FLAG/.test(T)) r = mk('steward', 'flag', 'flag', t('rc.bw'), sentence(text));
  else if (/BLUE FLAG/.test(T)) r = mk('blue', 'flag', 'flag', t('rc.blue'), sentence(text));
  else if (/GREEN LIGHT - PIT EXIT OPEN/.test(T)) r = mk('green', 'ok', 'pit', t('rc.pitOpen'));
  else if (/PIT EXIT CLOSED/.test(T)) r = mk('info', 'info', 'pit', t('rc.pitClosed'));
  else if (/^OVERTAKE ENABLED/.test(T)) r = mk('green', 'bolt', 'ovt', t('rc.ovtOn'));
  else if (/^OVERTAKE DISABLED/.test(T)) r = mk('info', 'bolt', 'ovt', t('rc.ovtOff'));
  else if (/^DRS ENABLED/.test(T)) r = mk('green', 'bolt', 'ovt', t('rc.drsOn'), /ZONE/.test(T) ? sentence(text) : null);
  else if (/^DRS DISABLED/.test(T)) r = mk('info', 'bolt', 'ovt', t('rc.drsOff'), /ZONE/.test(T) ? sentence(text) : null);
  else if (/VIRTUAL SAFETY CAR/.test(T)) r = mk('yellow', 'car', 'sc', /ENDING/.test(T) ? t('rc.vscEnd') : t('rc.vsc'), sentence(text));
  else if (/LAPPED CARS MAY NOW OVERTAKE THE SAFETY CAR/.test(T)) r = mk('yellow', 'car', 'sc', t('rc.lapped'), sentence(text));
  else if (/SAFETY CAR DEPLOYED/.test(T)) r = mk('yellow', 'car', 'sc', t('rc.scOut'));
  else if (/SAFETY CAR IN THIS LAP/.test(T)) r = mk('yellow', 'car', 'sc', t('rc.scIn'), t('rc.scInDetail'));
  else if (/SAFETY CAR/.test(T)) r = mk('yellow', 'car', 'sc', t('rc.sc'), sentence(text));
  else if (/RISK OF RAIN/.test(T)) r = mk('blue', 'rain', 'weather', t('rc.rain', { n: num(/(\d+) ?%/) ?? '–' }));
  else if (/RECOVERY VEHICLE/.test(T)) r = mk('yellow', 'tool', 'track', turn ? t('rc.recoveryTurn', { n: turn }) : t('rc.recovery'));
  else if (/^RACE START|SESSION STARTED/.test(T)) r = mk('green', 'flag', 'info', /^RACE START/.test(T) ? t('rc.raceStart') : t('rc.sessionStart'));
  else if (/FALSE START/.test(T)) r = mk('steward', 'steward', 'steward', /PENALTY/.test(T) ? t('rc.falseStartPen') : t('rc.falseStart'), sentence(text));
  else if (/TIME PENALTY/.test(T)) r = mk('steward', 'steward', 'steward', num(/(\d+) SECOND/) ? t('rc.timePenalty', { n: num(/(\d+) SECOND/) }) : t('rc.timePenaltyNone'), sentence(text));
  else if (/NO FURTHER (INVESTIGATION|ACTION)/.test(T)) r = mk('steward', 'steward', 'steward', t('rc.noFurther'), sentence(text));
  else if (/AFTER THE RACE/.test(T)) r = mk('steward', 'steward', 'steward', t('rc.afterRace'), sentence(text));
  else if (/UNDER INVESTIGATION/.test(T)) r = mk('steward', 'steward', 'steward', t('rc.investigated'), sentence(text));
  else if (/DELETED/.test(T)) r = mk('steward', 'steward', 'steward', t('rc.deleted'), sentence(text));
  else if (/INCIDENT INVOLVING/.test(T) && /NOTED/.test(T)) r = mk('steward', 'steward', 'steward', t('rc.noted'), sentence(text));
  else if (stew) r = mk('steward', 'steward', 'steward', t('rc.stewards'), sentence(text));
  if (r) return r;
  // Fallback (auch die deutschen Meldungen der Demo): Farbton nach Stufe und Art, Wortlaut bleibt
  const tag = String(m.tag || '').toUpperCase();
  const tone = m.level === 'red' ? 'red' : m.level === 'yellow' ? 'yellow' : /^(WEATHER|WETTER)$/.test(tag) ? 'blue' : /PENALTY|STRAFE|STEWARD/.test(tag) ? 'steward' : 'info';
  const icon = tone === 'red' ? 'flag' : tone === 'yellow' ? 'warn' : tone === 'blue' ? 'rain' : tone === 'steward' ? 'steward' : /BOX/.test(tag) ? 'tool' : 'info';
  const catLabel = tag ? (tl(`rc.tag.${tag}`) !== `rc.tag.${tag}` ? tl(`rc.tag.${tag}`) : tag.charAt(0) + tag.slice(1).toLowerCase()) : t('rc.cat.info');
  return mk(tone, icon, catLabel, sentence(text) || '—');
}
