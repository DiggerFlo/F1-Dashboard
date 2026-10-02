import { useEffect, useState } from 'react';
import { fmtClock, splitCountdown } from '../../js/format.js';
import { t } from '../../js/i18n.js';
import { sessionLabel } from '../../js/sessions.js';
import { plannedMinutes } from '../../js/livelock.js';

/** Flagge (Mast mit wehendem Tuch), Farbe über currentColor; das Tuch wellt sich. */
const Flag = ({ className = '' }) => (
  <svg className={`bflag ${className}`} viewBox="0 0 48 48" aria-hidden="true">
    <path d="M8 4v40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path className="cloth" d="M10 7c7-4 11 4 18 0s9-2 10 0v18c-1-2-3-3-10 0s-11-4-18 0z" fill="currentColor" />
  </svg>
);

const cell = (v, l) => <div key={l} className="cdc"><span className="v">{String(v).padStart(2, '0')}</span><span className="label">{l}</span></div>;

/**
 * Countdown bis zum Start einer Session. Bei 0 läuft einmal eine kurze Animation (Flagge, "Session gestartet"), danach steht ein Live-Feld
 * mit vergangener Zeit und geplanter Dauer (ohne OpenF1 gibt es sonst keine Daten zur Session). Wer die Seite erst nach dem Start öffnet,
 * sieht direkt das Live-Feld. Beginnt eine neue Session in der Zukunft, zählt wieder der Countdown.
 */
export function Countdown({ startsAt, now, label }) {
  const secs = (startsAt - now) / 1000;
  const started = secs <= 0;
  const [phase, setPhase] = useState(started ? 'live' : 'count');
  useEffect(() => { setPhase((p) => (started ? (p === 'count' ? 'go' : p) : 'count')); }, [started]);
  useEffect(() => {
    if (phase !== 'go') return undefined;
    const id = setTimeout(() => setPhase('live'), 3600);
    return () => clearTimeout(id);
  }, [phase]);

  const shown = !started ? 'count' : phase === 'count' ? 'go' : phase; // ohne Zwischenbild beim Übergang
  if (shown === 'count') {
    const cd = splitCountdown(secs);
    return <div className="cd" role="timer" aria-label={t('up.countdown')}>{cell(cd.d, t('up.days'))}{cell(cd.h, t('up.hours'))}{cell(cd.m, t('up.min'))}{cell(cd.s, t('up.sec'))}</div>;
  }
  if (shown === 'go') {
    return <div className="goanim" role="status"><Flag className="big" /><strong className="disp">{t('up.started')}</strong></div>;
  }
  const elapsed = Math.max(0, -secs);
  const planned = plannedMinutes(label) * 60;
  const pct = Math.min(1, elapsed / planned);
  return (
    <div className="livepanel" role="status">
      <Flag />
      <div className="lpbody">
        <strong className="disp">{t('up.running', { name: sessionLabel(label) })}</strong>
        <span className="mono lpt">{t('up.since', { time: fmtClock(elapsed) })} · {t('up.planned', { min: plannedMinutes(label) })}</span>
        <div className="lpbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label={t('up.progress')}><i style={{ width: `${pct * 100}%` }} /></div>
        <span className="lpnote">{t('up.liveNote')}</span>
      </div>
    </div>
  );
}
