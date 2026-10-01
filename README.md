# Pitwall – F1 Live-Dashboard

Dashboard mit Streckenlayout und Fahrerpositionen, Live-Timing, Telemetrie je Fahrer und einer Seitenleiste für Funk und Race-Control-Meldungen. Die Ansicht reagiert auf den Session-Status:

| Zustand | Darstellung |
| --- | --- |
| Keine Session / vor dem Rennen | Vorschau: Streckenlayout mit Kurven, Countdown, Zeitplan, Wetter, Fahrerwertung |
| Rennen / Training | Positionen auf der Karte, Timing mit Abständen, Sektoren, Reifen, Gas/Bremse, DRS |
| Qualifying | Session-Timer, beste Zeiten, Cut-Off-Linie, Sektorfarben, Pole-Vergleich in der Telemetrie |
| Safety Car / VSC / Gelb | Gelbes Banner, gelbe Strecke, SC-Marker, neutralisierte Anzeige |
| Rote Flagge | Rotes Banner, Unterbrechungsdauer, eingefrorene Werte |

Design: Design-System *Pitwall* (dunkel, kantig, Barlow Condensed / Inter / JetBrains Mono). Timing-Farben: Lila = schnellste Zeit, Grün = persönliche Bestzeit, Gelb = langsamer (immer mit Symbol, nicht nur Farbe).

## Starten

```
npm start          # http://localhost:8080
npm test           # Tests (node:test, keine Abhängigkeiten)
```

Keine Build-Schritte und keine Abhängigkeiten: statische Dateien mit ES-Modulen.

## Datenquellen

URL-Parameter wählen die Quelle:

- **Demo (Standard)** – Simulation, durchläuft automatisch Rennen → Safety Car → Rote Flagge → Qualifying → Vorschau. Oben gibt es Schaltflächen, um Flaggen selbst auszulösen. `?scenario=race|quali|upcoming|auto`
- **OpenF1** – `?source=openf1` nutzt die [OpenF1-API](https://openf1.org).
  - Läuft gerade eine Session, werden Live-Daten gezeigt. Live-Zugriff braucht ein Token: `?source=openf1&token=…`
  - Sonst wird die letzte Session als **Wiederholung** abgespielt (`&speed=8`). `&session=<session_key>` oder `&type=race|quali|practice|upcoming` wählt gezielt.
  - Ohne Session in den nächsten 4 Tagen, mit kommender Session: Vorschau mit Countdown.

Grenzen der OpenF1-Anbindung: Funk gibt es nur als Audio (kein Transkript), Qualifying zeigt die beste Runde statt getrennter Q1/Q2/Q3, die Rundenzahl des Rennens ist nicht bekannt, Wetter-Prognose und Fahrerwertung fehlen in der Vorschau. Die Anbindung wurde ohne Netzzugang entwickelt und ist nur durch Unit-Tests der Flaggen-Logik abgedeckt, nicht gegen die echte API geprüft.

## Streckenlayouts

Die Karten nutzen die Layouts aus [julesr0y/f1-circuits-svg](https://github.com/julesr0y/f1-circuits-svg) (CC BY 4.0, Namensnennung in `data/ATTRIBUTION.md` und in der Seitenleiste). `data/circuits.json` enthält alle Layouts mit Einsatz ab 2012. Neu erzeugen: `node scripts/build-circuits.mjs <pfad-zum-checkout>`.

Mit OpenF1-Daten wird das Layout über `circuit_short_name`/`location` der Session gewählt (Saison bestimmt die Variante) und die Positionsdaten der Fahrer per Drehung, Skalierung und Spiegelung darauf abgebildet. Passt die Abbildung nicht (Abweichung > 8 % des Streckenradius), zeigt die App stattdessen den Umriss aus den Positionsdaten. Die Ausrichtung folgt `f1-orientation` wie auf formula1.com.

## Funk abspielen und transkribieren

Jeder Funkspruch hat einen Audio-Player und ein Dropdown **Transkribieren …**:

- **Lokal im Browser (Whisper):** läuft per transformers.js (Modell `whisper-tiny.en`, lädt beim ersten Mal ca. 40 MB vom CDN). Kein Key, nichts verlässt den Browser außer dem Modell-Download.
- **OpenAI Whisper API:** fragt beim ersten Mal nach einem API-Key (nur in `sessionStorage` dieses Tabs, nur an api.openai.com gesendet).
- **Demo:** In der Simulation hat der Funk keinen Text, sondern nur gesprochenen Inhalt. „Abspielen“ nutzt die Sprachausgabe des Browsers, das Demo-Transkript liefert den Text.

Seitenleiste und Audio werden nicht neu aufgebaut, laufende Wiedergabe, offene Dropdowns und fertige Transkripte bleiben beim Live-Update erhalten. Sperrt der Audio-Server CORS, hilft `?proxy=https://dein-proxy/?u={url}`.

## Aufbau

```
index.html, css/styles.css     Pitwall-Tokens und Komponenten
js/main.js                     Quelle wählen, rendern, Klicks
js/views.js                    alle Ansichten aus einem normalisierten Zustand
js/track.js                    Streckenkarte und Telemetrie-Verlauf (SVG)
js/svgpath.js, js/fit.js       SVG-Pfad -> Punkte, Anpassung der Positionsdaten ans Layout
js/circuits.js                 Session -> Layout (Aliase, Saison)
data/circuits.json             Layouts (generiert, CC BY 4.0)
js/feed.js                     Seitenleiste: Audio, Dropdown, Transkripte
js/transcribe.js               Transkriptions-Engines (lokal, OpenAI, Demo)
js/format.js                   Formatierung, Timing-Klassen, HTML-Escaping
js/sources/demo.js             Simulation (Engine ohne Timer, testbar)
js/sources/openf1.js           OpenF1-Adapter
```

Eine Datenquelle liefert `start(onState)`, `stop()`, `select(type)` und `trigger(event)`. `onState` bekommt:

```
{ now, flag: 'green'|'yellow'|'sc'|'vsc'|'red'|'chequered',
  session: { type: 'race'|'quali'|'practice'|'upcoming', name, circuit, lap, totalLaps, remaining, cutoff, flagSince, phase },
  drivers: [{ num, code, pos, gap, interval, last, best, sectors[3], sectorCls[3], tyre, speed, throttle, brake, gear, rpm, drs, x, y, onTrack, pit }],
  feed: [{ kind: 'radio'|'rc', t, code, tag, text, url, level }],
  track: { points, sectors, turns }, weather, upcoming, safetyCar, sourceNote }
```

Eine weitere Quelle (z. B. FastF1-Proxy oder eigenes Backend) muss nur diesen Zustand erzeugen. Alle Texte aus externen Quellen werden vor dem Rendern HTML-escaped.
