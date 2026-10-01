# Streckenlayouts

`circuits.json` und `../js/sources/demo-track.js` enthalten Streckenlayouts aus
[julesr0y/f1-circuits-svg](https://github.com/julesr0y/f1-circuits-svg),
© 2024–2026 ROY Jules (julesr0y), lizenziert unter
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

Änderungen: Aus den SVG-Dateien (Stil `minimal/white`) wurden nur die Pfaddaten und die Saisons
übernommen, Layouts mit Einsatz ab 2012 ausgewählt und in JSON beziehungsweise (für Monza) in eine
Punktliste umgewandelt. Die Daten werden zur Laufzeit neu gezeichnet. Erzeugt mit
`node scripts/build-circuits.mjs <pfad-zum-checkout>`.
