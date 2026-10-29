// Takt der Datenquelle (Millisekunden zwischen zwei Zuständen). Anzeigen blenden Werte über diese Zeit weich zum neuen Wert,
// statt bei jedem Zustand zu springen. useDashboard misst den Takt, die Überblendung (Tween, CSS) liest ihn.
let ms = 500;

export const getTick = () => ms;

/** Neuen Abstand zweier Zustände eintragen (gleitender Mittelwert, Ausreißer begrenzt) und als CSS-Variable --tick bereitstellen. */
export function noteTick(interval) {
  ms = Math.round(ms * 0.7 + Math.min(3000, Math.max(100, interval)) * 0.3);
  try { document.documentElement.style.setProperty('--tick', `${ms}ms`); } catch { /* ohne DOM */ }
  return ms;
}
