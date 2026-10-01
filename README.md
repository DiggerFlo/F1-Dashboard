# Pitwall – F1 Live-Dashboard

Dashboard mit Streckenlayout und Fahrerpositionen, Live-Timing, Telemetrie je Fahrer und einer Seitenleiste für Funk und Race-Control-Meldungen. Die Ansicht reagiert auf den Session-Status:

| Zustand | Darstellung |
| --- | --- |
| Keine Session / vor dem Rennen | Vorschau: Streckenlayout mit Kurven, Countdown, Zeitplan, Wetter, Fahrerwertung |
| Rennen / Training | Positionen auf der Karte, Timing mit Abständen, Sektoren, Reifen, Gas/Bremse, DRS |
| Qualifying | Session-Timer, beste Zeiten, Cut-Off-Linie, Sektorfarben, Pole-Vergleich in der Telemetrie |
| Safety Car / VSC / Gelb | Gelbes Banner, gelbe Strecke, SC-Marker, neutralisierte Anzeige |
| Rote Flagge | Rotes Banner, Unterbrechungsdauer, eingefrorene Werte |

Design: Ant Design 5 im dunklen Pitwall-Theme (dunkel, kantig, Barlow Condensed / Inter / JetBrains Mono). Timing-Farben: Lila = schnellste Zeit, Grün = persönliche Bestzeit, Gelb = langsamer (immer mit Symbol, nicht nur Farbe).

## Starten

```
npm install
npm start          # Vite-Dev-Server, http://localhost:8080
npm run build      # Produktions-Build nach dist/
npm test           # Tests (Vitest)
```

Benötigt Node 18 oder neuer. Das UI ist React 18 mit Ant Design 5 (dunkles Theme in `src/theme.js`).

## Veröffentlichen auf GitHub Pages

Die App ist eine reine statische Seite (`npm run build` erzeugt `dist/`, `base` ist relativ), sie läuft also auch unter einem Unterpfad wie `https://<nutzer>.github.io/<repository>/`. Der Workflow `.github/workflows/deploy.yml` baut sie bei jedem Push auf `main` oder auf den aktuellen Standardbranch (`claude/f1-dashboard-telemetry-76buoj`, siehe `deploy.yml`), führt die Tests aus und veröffentlicht `dist/`.

1. Den Workflow `deploy.yml` committen und pushen. Ein Push auf den Standardbranch genügt; wer lieber einen `main`-Branch nutzt, legt ihn an und stellt ihn unter Settings > Branches als Standard ein.
2. Im Repository **Settings > Pages > Build and deployment > Source** auf **GitHub Actions** stellen (einmalig).
3. Unter **Actions** läuft "Deploy to GitHub Pages"; danach ist die Seite unter der oben genannten Adresse erreichbar. Mit "Run workflow" lässt sich ein Neuaufbau von Hand starten.

Grenzen auf GitHub Pages: Es gibt keinen Server, der `/f1static/` weiterreicht (nur Dev-Server und `vite preview`). Funk-Aufnahmen lassen sich abspielen, ihre echte Wellenform und die Transkription brauchen aber CORS; ohne Proxy zeigt der Player eine Ersatzform. Alle Daten (OpenF1, Jolpica, MultiViewer, Fahrerfotos) kommen direkt aus dem Browser.

## Datenquellen

URL-Parameter wählen die Quelle:

- **Demo (Standard)** – Wiederholung eines echten, beendeten Rennens mit Daten aus OpenF1: Telemetrie, Positionen, Abstände, Reifen, Funk (echte MP3), Race Control und Wetter. Die Daten werden beim Abspielen in Zeitfenstern von 4 Minuten in den Speicher geladen (nur temporär, nichts wird gespeichert) und lokal abgespielt, ein Fenster braucht nur vier API-Aufrufe für alle Fahrer. Oben stehen Pause, Tempo (1× bis 8×, `?speed=`) und eine Zeitleiste zum Springen. Ein Klick auf ein Rennen im Kalender spielt dieses Rennen ab, die Tabs Qualifying und Training die jeweilige Session. `?session=<session_key>` wählt gezielt eine Session. Ist OpenF1 nicht erreichbar, wechselt die Demo nach 30 s auf die Simulation.
- **Simulation** – `?source=sim`: erfundene Daten mit Schaltflächen, um Flaggen selbst auszulösen (Grün, Gelb, Safety Car, VSC, Rot, Regen). `&scenario=race|quali|upcoming|auto`
- **Echtdaten** – `?source=openf1` (Schalter „Echtdaten“ im Kopf):
  - Läuft gerade eine Session, werden Live-Daten gezeigt (Abruf alle 2 s). Live-Zugriff braucht ein Token: `&token=…`
  - Sonst wird die letzte Session wie in der Demo als Wiederholung abgespielt (`&speed=8`). `&session=<session_key>` oder `&type=race|quali|practice|upcoming` wählt gezielt.
  - Ohne Session in den nächsten 4 Tagen, mit kommender Session: Vorschau mit Countdown, Zeitplan, Wertungen (Jolpica F1).

**Große Bildschirme:** Die Seite nutzt die volle Breite bis 2560 x 1440 (und darüber zentriert). Dafür sind alle Größen im Stylesheet in `rem` angegeben; die Wurzelschrift wächst mit der Bildschirmbreite (16 px bis 1919 px, 18 px ab 1920 px, 20,8 px ab 2300 px), so skaliert die gesamte Oberfläche gleichmäßig. Ant Design rechnet in px und wird mit demselben Faktor skaliert (`src/useScale.js`, `scaledTheme` in `src/theme.js`); Fotos und Avatare nehmen ihre Größe ebenfalls in `rem`. Neue Größen also in `rem` angeben (Linien und Rahmen bis 3 px dürfen px bleiben), Media-Queries bleiben in px.

**Sprache:** Die Oberfläche gibt es auf Deutsch und Englisch. Das Sprachmenü sitzt rechts in der Kopfzeile, die Wahl wird im Browser gespeichert. Ohne Wahl gilt die Browsersprache (Deutsch, sonst Englisch); `?lang=en` bzw. `?lang=de` erzwingt eine Sprache. Alle Texte stehen in `js/locales/de.js` und `js/locales/en.js` (gleiche Schlüssel, `{name}` als Platzhalter, `_one`/`_other` für Mehrzahl) und werden mit `t(schlüssel, werte)` aus `js/i18n.js` geholt, auch in der Datenschicht. Ein Test prüft, dass beide Dateien dieselben Schlüssel und Platzhalter haben und dass jeder im Code verwendete Schlüssel existiert. Neue Texte also in beiden Dateien ergänzen. Datumsformate, Dezimaltrenner und die Sprache der Sprachausgabe folgen der Wahl; Race-Control-Meldungen werden bekannte Muster übersetzt, der Originaltext bleibt englisch. Bereits erzeugte Demo-Meldungen der Simulation bleiben in der Sprache, in der sie entstanden sind.

**Anfragelimit und Zwischenspeicher:** OpenF1 erlaubt ohne Zugangsschlüssel nur etwa 30 Anfragen pro Minute, die Quelle hält sich mit höchstens 28 daran (und höchstens 3 pro Sekunde, laut OpenF1-Dokumentation). Ein Sessionwechsel braucht rund 12 Anfragen; direkt nach dem Start kann er deshalb bis zu einer Minute warten (die Ladeanzeige weist darauf hin). Die stabilen Stammdaten beendeter Sessions (Fahrer, Runden, Boxenstopps, Race Control, Funk, Wetter, Positionen) werden deshalb im Browser zwischengespeichert (`localStorage`, die letzten 6 Sessions, `js/cache.js`). Neuladen und Zurückwechseln kosten dann kaum noch Anfragen. Die Telemetrie-Zeitfenster werden nicht gespeichert.

**Safety Car:** OpenF1 liefert keine Position des Safety Cars. Bei „Safety Car ausgerückt“ wird es knapp (etwa 1,2 % einer Runde) vor dem Führenden auf der Strecke gezeichnet, das ist eine Näherung. Beim Virtual Safety Car gibt es kein Fahrzeug.

Grenzen der OpenF1-Anbindung: Funk gibt es nur als Audio (Transkript über die Auswahl im Funk-Eintrag), Qualifying zeigt die beste Runde statt getrennter Q1/Q2/Q3, die Rundenzahl des Rennens ist nicht bekannt, und die Wetter-Prognose fehlt in der Vorschau. Boxenstopps stammen in der Wiederholung aus dem OpenF1-Endpunkt `pit`, in Live-Daten sind sie noch nicht erfasst.

## Teamfarben und flüssige Bewegung

- **Teamfarben:** Punkte auf der Karte, ein Balken neben dem Kürzel in den Tabellen und die Überholhinweise tragen die Teamfarbe. Die Demo nutzt erfundene Teams mit eigenen Farben, mit OpenF1 kommen die echten Farben aus `team_colour` (`color`/`team` im Fahrer-Zustand). Farben werden vor der Verwendung als `#rrggbb` geprüft. Der Leader hat zusätzlich einen roten Ring. Die Timing-Farben (Lila/Grün/Gelb) bleiben der Zeitenanzeige vorbehalten.
- **Flüssige Bewegung:** Die Daten kommen nur alle 0,5 bis 2 s. Ein Animator (`createCarAnimator`) rechnet jede Position auf den Anteil der Runde um und fährt zwischen zwei Datenständen entlang der Strecke (nicht auf der Sehne, auch über die Ziellinie), 60 Bilder pro Sekunde. Die Anzeige läuft dadurch ein Update hinter den Daten her. Große Sprünge (Boxengasse, Neustart) werden nicht überblendet.

## Überholhinweise

Wenn im Rennen ein Auto ein anderes überholt, fährt oben rechts ein kleiner Hinweis herein („MOR überholt KRN · P2“), maximal vier gleichzeitig, jeweils 5 Sekunden. Erkannt wird aus dem Vergleich zweier Zustände, also mit jeder Datenquelle. Nicht gemeldet werden Positionswechsel durch Boxenstopps, unter Safety Car/VSC/Rot, nach der Zielflagge und außerhalb des Rennens. Der Schalter „Überholungen an/aus“ in der Kopfzeile schaltet die Hinweise ab. Hinweise werden den Screenreadern vorgelesen (`aria-live`) und respektieren „Bewegung reduzieren“.

Die Demo enthält dafür Tagesform und Windschatten (Überholungen im Rennen), ein Training als eigene Session, Boxenstopp-, Schnellste-Runde-, Strafen- und Wetter-Meldungen sowie einen Regen-Knopf.

## Qualität

- **Schriften selbst gehostet** (`fonts/`, OFL, keine Anfragen an Google), `font-display: swap`, Vorab-Laden der wichtigsten Schnitte.
- **Barrierefrei bedient:** Skip-Link, Landmarken und Überschriftenhierarchie, Tabellen mit Beschriftung, `aria-current` in der Navigation, `aria-live` für Hinweise, sichtbare Fokusrahmen, Timing-Farben immer mit Symbol, `prefers-reduced-motion` wird respektiert.
- **Responsiv:** Tabellen scrollen seitlich, die Seitenleiste rutscht auf Handybreite unter den Inhalt.
- **Zustände:** Ladeanzeige, Fehlerleiste bei Verbindungsproblemen, leere Zustände. Alle Texte aus externen Quellen werden escaped, Farben validiert.
- **CI:** `npm test` läuft bei jedem Push (`.github/workflows/test.yml`).

## Rennkalender

Tab **Kalender**: alle Rennen einer Saison als Karten mit Runde, Name, Ort, Datum, Streckenlayout und Status (beendet, live, nächstes Rennen). Die Saison wählst du im Dropdown (ab 2023, so weit reichen die OpenF1-Daten). Ein Klick auf ein Rennen öffnet es: bei OpenF1 als Wiederholung bzw. Live-Ansicht, bei einem zukünftigen Rennen als Vorschau mit Countdown. Im Demo-Modus zeigt der Kalender die Strecken des Jahres mit erfundenen Terminen.

## Streckenlayouts

Die Karten nutzen die Layouts aus [julesr0y/f1-circuits-svg](https://github.com/julesr0y/f1-circuits-svg) (CC BY 4.0, Namensnennung in `public/data/ATTRIBUTION.md` und in der Seitenleiste). `public/data/circuits.json` enthält alle Layouts mit Einsatz ab 2012. Neu erzeugen: `node scripts/build-circuits.mjs <pfad-zum-checkout>`.

Mit OpenF1-Daten wird das Layout über `circuit_short_name`/`location` der Session gewählt (Saison bestimmt die Variante) und die Positionsdaten der Fahrer per Drehung, Skalierung und Spiegelung darauf abgebildet. Passt die Abbildung nicht (Abweichung > 8 % des Streckenradius), zeigt die App stattdessen den Umriss aus den Positionsdaten. Die Ausrichtung folgt `f1-orientation` wie auf formula1.com.

## Funk abspielen und transkribieren

Jeder Funkspruch hat einen Audio-Player und ein Dropdown **Transkribieren …**:

- **Lokal im Browser (Whisper):** läuft per transformers.js (Modell `whisper-tiny.en`, lädt beim ersten Mal ca. 40 MB vom CDN). Kein Key, nichts verlässt den Browser außer dem Modell-Download.
- **OpenAI Whisper API:** fragt beim ersten Mal nach einem API-Key (nur in `sessionStorage` dieses Tabs, nur an api.openai.com gesendet).
- **Demo:** In der Simulation hat der Funk keinen Text, sondern nur gesprochenen Inhalt. „Abspielen“ nutzt die Sprachausgabe des Browsers, das Demo-Transkript liefert den Text.

Seitenleiste und Audio werden nicht neu aufgebaut, laufende Wiedergabe, offene Dropdowns und fertige Transkripte bleiben beim Live-Update erhalten. Sperrt der Audio-Server CORS, hilft `?proxy=https://dein-proxy/?u={url}`.

## Funk in der Simulation

Die Simulation (`?source=sim`) spielt echte Team-Funksprüche der jeweiligen Fahrer. `public/data/radio.json` enthält pro Clip den Link zur Aufnahme auf livetiming.formula1.com, die Dauer und die vorberechnete Wellenform. Die MP3-Dateien liegen nicht im Repository. Neu erzeugen: `node scripts/build-radio.mjs [Jahr] [Clips pro Fahrer]`.

Die Aufnahmen kommen ohne CORS-Header. Abspielen funktioniert trotzdem, für Wellenform und Transkription liest der Vite-Server (`npm start`, `npm run preview`) sie über den Proxy `/f1static`. Auf reinem statischem Hosting fehlt der Proxy, dann erscheint eine Ersatz-Wellenform; mit `?proxy=https://dein-proxy/?u={url}` lässt sich ein eigener Proxy angeben.

## OpenF1-Limits

OpenF1 begrenzt die Anfragen (HTTP 429) und antwortet bei Abfragen ohne Treffer mit 404. `createOpenF1Client` stellt die Anfragen deshalb nacheinander (mindestens 0,34 s Abstand, also höchstens 3 pro Sekunde, ohne Token höchstens 28 pro Minute; laut OpenF1-Dokumentation liegt das Limit bei 3 pro Sekunde und 30 pro Minute), wartet bei 429/503 und wiederholt, und behandelt 404 als leere Liste. Ein Sessionwechsel braucht rund 18 Anfragen, bei mehreren Wechseln direkt hintereinander kann es deshalb kurz warten. Live wird gestaffelt abgefragt: Fahrzeuge alle 2 s, Abstände/Positionen/Race Control alle 6 s, Runden/Reifen/Funk/Wetter alle 15 s. Wiederholungen brauchen dagegen nur den Puffer (siehe oben). Mit `?token=` gelten die höheren Limits für angemeldete Nutzer.

## Aufbau

```
index.html, vite.config.js    Einstieg und Build
src/main.jsx, src/App.jsx      React-Wurzel, Layout, Überholhinweise (antd notification)
src/useDashboard.js            Datenquelle, Zustand, Auswahl, Kalender laden
src/theme.js, src/styles.css   Ant-Design-Theme und Pitwall-Styles
src/components/                Chrome (Kopf, Banner), Main (KPIs, Tabellen, Telemetrie), Calendar, Feed
js/track.js                    Streckenkarte und Telemetrie-Verlauf (SVG-Strings), Fahrzeug-Animation
js/svgpath.js, js/fit.js       SVG-Pfad -> Punkte, Anpassung der Positionsdaten ans Layout
js/circuits.js, js/calendar.js Session -> Layout, Rennkalender (OpenF1 bzw. Demo)
js/overtakes.js                Überholungen erkennen
js/transcribe.js               Transkriptions-Engines (lokal, OpenAI, Demo)
js/format.js                   Formatierung, Timing-Klassen, HTML-Escaping
js/sources/demo.js             Simulation (Engine ohne Timer, testbar)
js/sources/openf1.js           OpenF1-Adapter (live und Wiederholung)
js/sources/replay-buffer.js    Zeitfenster-Puffer der Wiederholung
js/sources/replay-demo.js      Demo mit echten Daten, Rückfall auf die Simulation
js/sources/jolpica.js          Jolpica F1: Kalender, Wertungen, Ergebnisse
js/waveform.js, js/teams.js    Wellenformen, Team- und Reifenfarben
public/data/circuits.json      Layouts (generiert, CC BY 4.0)
```

Eine Datenquelle liefert `start(onState)`, `stop()`, `select(type)` und `trigger(event)`. `onState` bekommt:

```
{ now, flag: 'green'|'yellow'|'sc'|'vsc'|'red'|'chequered',
  session: { type: 'race'|'quali'|'practice'|'upcoming', name, circuit, lap, totalLaps, remaining, cutoff, flagSince, phase },
  drivers: [{ num, code, pos, gap, interval, last, best, sectors[3], sectorCls[3], tyre, speed, throttle, brake, gear, rpm, drs, x, y, onTrack, pit }],
  feed: [{ kind: 'radio'|'rc', t, code, tag, text, url, level }],
  track: { points, sectors, turns }, weather, upcoming, safetyCar, sourceNote }
```

Eine weitere Quelle (z. B. FastF1-Proxy oder eigenes Backend) muss nur diesen Zustand erzeugen. Texte aus externen Quellen werden von React escaped, Farben laufen durch `safeColor`.
