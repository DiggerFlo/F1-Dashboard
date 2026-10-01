// Erzeugt public/data/radio.json: echte Team-Funksprüche (OpenF1 team_radio, Aufnahmen von livetiming.formula1.com)
// für die Demo. Die MP3-Dateien werden nicht gespeichert, sondern bleiben Links. Pro Clip werden Dauer und
// Wellenform berechnet, weil der Browser die Aufnahmen wegen fehlender CORS-Header nicht selbst dekodieren kann.
//   node scripts/build-radio.mjs [Jahr=2025] [Clips pro Fahrer=3]
import { writeFileSync } from 'node:fs';
import decode from 'audio-decode';
import { createOpenF1Client } from '../js/sources/openf1.js';
import { peaksFromSamples, BARS } from '../js/waveform.js';

const year = Number(process.argv[2]) || 2025;
const perDriver = Number(process.argv[3]) || 3;
// Fahrer der Demo (siehe js/sources/demo.js)
const CODES = ['NOR', 'PIA', 'LEC', 'HAM', 'VER', 'TSU', 'RUS', 'ANT', 'ALB', 'SAI', 'LAW', 'HAD', 'ALO', 'STR', 'OCO', 'BEA', 'HUL', 'BOR', 'GAS', 'COL'];

const get = createOpenF1Client({ minGap: 500 });
const sessions = (await get(`sessions?year=${year}&session_name=Race`)).sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
const out = [];
const count = (code) => out.filter((c) => c.code === code).length;

for (const s of sessions) {
  if (CODES.every((c) => count(c) >= perDriver)) break;
  const [drivers, radio] = await Promise.all([get(`drivers?session_key=${s.session_key}`), get(`team_radio?session_key=${s.session_key}`)]);
  const info = new Map(drivers.map((d) => [d.driver_number, d]));
  console.log(`${s.location} ${year}: ${radio.length} Funksprüche`);
  for (const r of radio) {
    const d = info.get(r.driver_number);
    const code = d?.name_acronym;
    if (!code || !CODES.includes(code) || count(code) >= perDriver || !r.recording_url) continue;
    try {
      const res = await fetch(r.recording_url);
      if (!res.ok) continue;
      const audio = await decode(Buffer.from(await res.arrayBuffer()));
      const samples = audio.channelData[0];
      const duration = samples.length / audio.sampleRate;
      if (duration < 3 || duration > 30) continue;
      const peaks = peaksFromSamples(samples, BARS).map((v) => Math.round(v * 100) / 100);
      out.push({ code, team: d.team_name || null, url: r.recording_url, date: r.date, session: `${s.location} ${year}`, duration: Math.round(duration * 10) / 10, peaks });
      console.log(`  ${code} ${duration.toFixed(1)} s`);
    } catch (e) { console.log(`  übersprungen: ${e.message}`); }
  }
}
out.sort((a, b) => a.code.localeCompare(b.code) || a.date.localeCompare(b.date));
writeFileSync('public/data/radio.json', JSON.stringify(out));
console.log(`${out.length} Clips für ${new Set(out.map((c) => c.code)).size} Fahrer geschrieben.`);
