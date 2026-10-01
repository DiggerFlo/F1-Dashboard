// Race-Control-Meldungen (englisch, GROSSBUCHSTABEN) für die Anzeige aufbereiten: deutsche Überschrift, Art, Farbton, genannte Fahrer.
// Unbekannte Meldungen (und die deutschen der Demo) bleiben im Wortlaut, nur Großschreibung wird beruhigt.

/** Sätze in normaler Schreibweise; Texte, die schon normal geschrieben sind, bleiben unverändert. */
export function sentence(t) {
  const str = String(t || '').trim();
  const letters = str.replace(/[^A-Za-zÄÖÜäöü]/g, '');
  if (letters.length < 4 || letters.replace(/[^A-ZÄÖÜ]/g, '').length / letters.length < 0.8) return str;
  return str.toLowerCase()
    .replace(/(^\s*|[.:!?]\s+|-\s+)([a-zäöü])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(fia|f1|drs|vsc|sc|dnf|dns|dsq)\b/g, (w) => w.toUpperCase())
    .replace(/\(([a-z]{3})\)/g, (m, c) => `(${c.toUpperCase()})`);
}

const CAT = { flag: 'Flagge', sc: 'Safety Car', ovt: 'Overtake', weather: 'Wetter', track: 'Strecke', pit: 'Boxen', steward: 'Rennkommissare', info: 'Rennleitung' };

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
  const mk = (tone, icon, cat, title, detail = null) => ({ tone, icon, cat: CAT[cat] || cat, title, detail, codes });
  let r = null;
  if (/^DOUBLE YELLOW IN TRACK SECTOR/.test(T)) r = mk('yellow', 'warn', 'flag', `Doppelgelb · Sektor ${sector}`);
  else if (/^YELLOW IN TRACK SECTOR/.test(T)) r = mk('yellow', 'warn', 'flag', `Gelb · Sektor ${sector}`);
  else if (/^CLEAR IN TRACK SECTOR/.test(T)) r = mk('green', 'ok', 'flag', `Frei · Sektor ${sector}`);
  else if (/^TRACK CLEAR/.test(T)) r = mk('green', 'ok', 'flag', 'Strecke frei');
  else if (/RED FLAG/.test(T)) r = mk('red', 'flag', 'flag', 'Rote Flagge', sentence(text));
  else if (/CHEQUERED/.test(T)) r = mk('info', 'flag', 'flag', 'Zielflagge');
  else if (/BLACK AND WHITE FLAG/.test(T)) r = mk('steward', 'flag', 'flag', 'Schwarz-weiße Flagge', sentence(text));
  else if (/BLUE FLAG/.test(T)) r = mk('blue', 'flag', 'flag', 'Blaue Flagge', sentence(text));
  else if (/GREEN LIGHT - PIT EXIT OPEN/.test(T)) r = mk('green', 'ok', 'pit', 'Boxenausfahrt offen');
  else if (/PIT EXIT CLOSED/.test(T)) r = mk('info', 'info', 'pit', 'Boxenausfahrt geschlossen');
  else if (/^OVERTAKE ENABLED/.test(T)) r = mk('green', 'bolt', 'ovt', 'Overtake freigegeben');
  else if (/^OVERTAKE DISABLED/.test(T)) r = mk('info', 'bolt', 'ovt', 'Overtake gesperrt');
  else if (/^DRS ENABLED/.test(T)) r = mk('green', 'bolt', 'ovt', 'DRS freigegeben', /ZONE/.test(T) ? sentence(text) : null);
  else if (/^DRS DISABLED/.test(T)) r = mk('info', 'bolt', 'ovt', 'DRS gesperrt', /ZONE/.test(T) ? sentence(text) : null);
  else if (/VIRTUAL SAFETY CAR/.test(T)) r = mk('yellow', 'car', 'sc', /ENDING/.test(T) ? 'Virtual Safety Car endet' : 'Virtual Safety Car', sentence(text));
  else if (/LAPPED CARS MAY NOW OVERTAKE THE SAFETY CAR/.test(T)) r = mk('yellow', 'car', 'sc', 'Überrundete dürfen vorbei', sentence(text));
  else if (/SAFETY CAR DEPLOYED/.test(T)) r = mk('yellow', 'car', 'sc', 'Safety Car ausgerückt');
  else if (/SAFETY CAR IN THIS LAP/.test(T)) r = mk('yellow', 'car', 'sc', 'Safety Car kommt herein', 'In dieser Runde');
  else if (/SAFETY CAR/.test(T)) r = mk('yellow', 'car', 'sc', 'Safety Car', sentence(text));
  else if (/RISK OF RAIN/.test(T)) r = mk('blue', 'rain', 'weather', `Regenrisiko ${num(/(\d+) ?%/) ?? '–'} %`);
  else if (/RECOVERY VEHICLE/.test(T)) r = mk('yellow', 'tool', 'track', turn ? `Bergungsfahrzeug · Kurve ${turn}` : 'Bergungsfahrzeug auf der Strecke');
  else if (/^RACE START|SESSION STARTED/.test(T)) r = mk('green', 'flag', 'info', /^RACE START/.test(T) ? 'Rennstart' : 'Session gestartet');
  else if (/FALSE START/.test(T)) r = mk('steward', 'steward', 'steward', /PENALTY/.test(T) ? 'Strafe für Frühstart' : 'Frühstart', sentence(text));
  else if (/TIME PENALTY/.test(T)) r = mk('steward', 'steward', 'steward', `${num(/(\d+) SECOND/) ?? ''} s Zeitstrafe`.trim(), sentence(text));
  else if (/NO FURTHER (INVESTIGATION|ACTION)/.test(T)) r = mk('steward', 'steward', 'steward', 'Keine weitere Untersuchung', sentence(text));
  else if (/AFTER THE RACE/.test(T)) r = mk('steward', 'steward', 'steward', 'Untersuchung nach dem Rennen', sentence(text));
  else if (/UNDER INVESTIGATION/.test(T)) r = mk('steward', 'steward', 'steward', 'Wird untersucht', sentence(text));
  else if (/DELETED/.test(T)) r = mk('steward', 'steward', 'steward', 'Rundenzeit gestrichen', sentence(text));
  else if (/INCIDENT INVOLVING/.test(T) && /NOTED/.test(T)) r = mk('steward', 'steward', 'steward', 'Vorfall notiert', sentence(text));
  else if (stew) r = mk('steward', 'steward', 'steward', 'Rennkommissare', sentence(text));
  if (r) return r;
  // Fallback (auch die deutschen Meldungen der Demo): Farbton nach Stufe und Art, Wortlaut bleibt
  const tag = String(m.tag || '').toUpperCase();
  const tone = m.level === 'red' ? 'red' : m.level === 'yellow' ? 'yellow' : tag === 'WETTER' ? 'blue' : /STRAFE|STEWARD/.test(tag) ? 'steward' : 'info';
  const icon = tone === 'red' ? 'flag' : tone === 'yellow' ? 'warn' : tone === 'blue' ? 'rain' : tone === 'steward' ? 'steward' : /BOX/.test(tag) ? 'tool' : 'info';
  return mk(tone, icon, tag ? tag.charAt(0) + tag.slice(1).toLowerCase() : 'info', sentence(text) || '—');
}
