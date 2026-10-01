# Streckenlayouts

`circuits.json` und `../js/sources/demo-track.js` enthalten Streckenlayouts aus
[julesr0y/f1-circuits-svg](https://github.com/julesr0y/f1-circuits-svg),
© 2024–2026 ROY Jules (julesr0y), lizenziert unter
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

Änderungen: Aus den SVG-Dateien (Stil `minimal/white`) wurden nur die Pfaddaten und die Saisons
übernommen, Layouts mit Einsatz ab 2012 ausgewählt und in JSON beziehungsweise (für Monza) in eine
Punktliste umgewandelt. Die Daten werden zur Laufzeit neu gezeichnet. Erzeugt mit
`node scripts/build-circuits.mjs <pfad-zum-checkout>`.

# Fahrerfotos

Die Porträts der Fahrer werden zur Laufzeit direkt von `media.formula1.com` geladen (Adresse aus dem Feld
`headshot_url` der OpenF1-API). Sie werden nicht gespeichert oder mitgeliefert. Die Rechte liegen bei der
Formula One Group beziehungsweise den Fahrern. Inoffizielles Fan-Projekt, nicht mit der Formula 1 verbunden.

# Streckendaten (Marshal-Sektoren, Boxenverlustzeit)

Die Sektoren für Flaggen und die typische Boxenverlustzeit stammen aus der öffentlichen API von
[MultiViewer](https://multiviewer.app) (`api.multiviewer.app`). Ohne diese Daten bleibt die Flagge auf der
ganzen Strecke und der Zeitverlust wird nicht angezeigt.

# Länderflaggen

Die Flaggen im Kalender und in der Vorschau stammen aus dem Paket [flag-icons](https://github.com/lipis/flag-icons)
(MIT-Lizenz, © Panayiotis Lipiridis) und werden lokal mit der App ausgeliefert.
