import { useEffect, useRef, useState } from 'react';
import { CaretRightFilled, PauseOutlined } from '@ant-design/icons';
import { audioUrl } from '../../js/transcribe.js';
import { BARS, estimateSpeech, fmtDur, loadPeaks, peaksFromText, pseudoPeaks } from '../../js/waveform.js';

let stopCurrent = null; // es spielt immer nur ein Funkspruch

/**
 * Funk-Player mit Wellenform: Play/Pause, Fortschritt in Teamfarbe, Klick zum Springen.
 * Echte Aufnahmen (m.url) zeigen die dekodierten Ausschläge, sobald der Eintrag sichtbar ist (sonst eine Ersatzform).
 * Demo-Funk (m.speech) wird per Sprachausgabe gespielt, die Form folgt dem gesprochenen Text.
 */
export function RadioPlayer({ m, color, proxy = null }) {
  const isAudio = !!m.url;
  const spoken = m.speech || m.text || '';
  const known = isAudio && m.peaks?.length; // Wellenform und Dauer sind schon berechnet (Demo-Clips)
  const [peaks, setPeaks] = useState(() => (known ? m.peaks : isAudio ? pseudoPeaks(m.id, BARS) : peaksFromText(spoken, BARS)));
  const [real, setReal] = useState(!!known);
  const [dur, setDur] = useState(() => (isAudio ? m.duration || 0 : estimateSpeech(spoken)));
  const [playing, setPlaying] = useState(false);
  const [prog, setProg] = useState(0);
  const [error, setError] = useState(null);
  const audio = useRef(null);
  const wrap = useRef(null);
  const raf = useRef(0);
  const speech = useRef({ t0: 0 });
  const latest = useRef(null);
  const mine = useRef(null);

  // Wellenform erst laden, wenn der Eintrag im Sichtfeld ist (die Liste hat bis zu 40 Einträge)
  useEffect(() => {
    if (!isAudio || known || typeof IntersectionObserver === 'undefined') return undefined;
    let dead = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      loadPeaks(audioUrl(m.url, proxy)).then((r) => { if (!dead) { setPeaks(r.peaks); setDur(r.duration); setReal(true); } }).catch(() => {});
    });
    io.observe(wrap.current);
    return () => { dead = true; io.disconnect(); };
  }, [m.url, proxy, isAudio]);

  const stop = () => {
    cancelAnimationFrame(raf.current);
    if (isAudio) audio.current?.pause();
    else window.speechSynthesis?.cancel();
    setPlaying(false);
  };

  latest.current = stop;
  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    if (stopCurrent && stopCurrent === mine.current) { latest.current(); stopCurrent = null; }
  }, []);

  function tick() {
    if (isAudio) {
      const a = audio.current;
      if (a && a.duration) setProg(a.currentTime / a.duration);
    } else {
      const s = speech.current;
      setProg((p) => Math.min(0.99, Math.max(p, (performance.now() - s.t0) / 1000 / dur)));
    }
    raf.current = requestAnimationFrame(tick);
  }

  function finish() {
    cancelAnimationFrame(raf.current);
    setPlaying(false); setProg(0);
  }

  async function toggle() {
    if (playing) { stop(); if (!isAudio) setProg(0); return; }
    stopCurrent?.();
    setError(null);
    if (isAudio) {
      try { await audio.current.play(); } catch (e) { setError('Wiedergabe nicht möglich'); return; }
    } else {
      const synth = window.speechSynthesis;
      if (!synth) { setError('Sprachausgabe nicht verfügbar'); return; }
      const u = new SpeechSynthesisUtterance(m.speech);
      u.lang = 'de-DE';
      u.onboundary = (e) => setProg((p) => Math.max(p, e.charIndex / m.speech.length));
      u.onend = finish; u.onerror = finish;
      speech.current.t0 = performance.now();
      setProg(0);
      synth.speak(u);
    }
    mine.current = () => latest.current();
    stopCurrent = mine.current;
    setPlaying(true);
    raf.current = requestAnimationFrame(tick);
  }

  function seek(frac) {
    if (!isAudio || !audio.current) return;
    const a = audio.current;
    const d = a.duration || dur;
    if (!d) return;
    a.currentTime = Math.min(0.999, Math.max(0, frac)) * d;
    setProg(a.currentTime / d);
  }

  const onWaveClick = (e) => {
    const r = wrap.current.getBoundingClientRect();
    seek((e.clientX - r.left) / r.width);
  };
  const onWaveKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); seek(prog + 0.05); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(prog - 0.05); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  };

  const idx = Math.floor(prog * peaks.length);
  return (
    <div className={`rp${playing ? ' playing' : ''}${real ? ' real' : ''}`} style={color ? { '--team': color } : undefined}>
      {isAudio && (
        <audio
          ref={audio} src={m.url} preload="none"
          onLoadedMetadata={(e) => { if (isFinite(e.target.duration)) setDur(e.target.duration); }}
          onEnded={finish} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} onError={() => setError('Audio nicht ladbar')}
        />
      )}
      <button type="button" className="rp-btn" onClick={toggle} aria-label={playing ? 'Pausieren' : 'Abspielen'}>
        {playing ? <PauseOutlined /> : <CaretRightFilled />}
      </button>
      <div
        className="rp-wave" ref={wrap} role="slider" tabIndex={0} aria-label="Wiedergabeposition" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prog * 100)}
        onClick={isAudio ? onWaveClick : undefined} onKeyDown={onWaveKey}
      >
        {peaks.map((p, i) => <i key={i} className={i < idx ? 'on' : i === idx && playing ? 'now' : ''} style={{ height: `${Math.round(p * 100)}%` }} />)}
      </div>
      <span className="rp-time mono">{error ? <span className="err">{error}</span> : <>{fmtDur(prog * dur)}<span className="muted"> / {dur ? fmtDur(dur) : '–:––'}</span></>}</span>
    </div>
  );
}
