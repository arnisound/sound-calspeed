// Turning stored measurements into curves for display, alignment and EQ.
import {
  responseAt, fixedWindow, fdWindow, magnitudeDb, phaseDeg, smoothDb, logFreqs, interpDb, bandLevel,
} from './dsp/analysis.js';

export const PPO = 48; // grid density (points per octave)
export const FREQS = logFreqs(20, 20000, PPO);

export const TAGS = [
  ['main', 'Tête / façade'],
  ['sub', 'Sub'],
  ['delay', 'Rappel (delay)'],
  ['fill', 'Front / out fill'],
  ['system', 'Système complet'],
  ['room', 'Salle (RT)'],
  ['other', 'Autre'],
];

export const tagLabel = (t) => (TAGS.find((x) => x[0] === t) || [t, t])[1];

function windowFor(sr, settings, mode) {
  const m = mode || settings.windowMode;
  if (m === 'fixed') return fixedWindow(sr, settings.fixedWindowMs);
  if (m === 'long') return fixedWindow(sr, 500);
  return fdWindow(sr, settings.fdwCycles, 3, 500);
}

const cache = new WeakMap();

/**
 * Complex response of a measurement on FREQS.
 * ref: 'peak' → phase relative to the IR peak (display);
 *      'absolute' → phase relative to the capture start (common to all
 *      measurements of the session: required for alignment).
 */
export function responseOf(m, settings, { mode, ref = 'peak', startAbs, freqs = FREQS, windowMs } = {}) {
  if (!m.ir) return null;
  const key = `${windowMs}|${mode || settings.windowMode}|${settings.fdwCycles}|${settings.fixedWindowMs}|${ref}|${startAbs}|${freqs.length}|${freqs[0]}`;
  let c = cache.get(m);
  if (!c) { c = new Map(); cache.set(m, c); }
  if (c.has(key)) return c.get(key);
  const peakLocal = m.peak - m.irStart;
  const pre = Math.round(0.002 * m.sr);
  const startLocal = startAbs != null ? startAbs - m.irStart : Math.max(0, Math.floor(peakLocal) - pre);
  const refLocal = ref === 'peak' ? peakLocal : -m.irStart;
  const H = responseAt(m.ir, m.sr, freqs, {
    start: startLocal,
    ref: refLocal,
    lengthFor: windowMs ? fixedWindow(m.sr, windowMs) : windowFor(m.sr, settings, mode),
    fadeIn: startAbs != null ? Math.round(0.005 * m.sr) : pre,
  });
  applyCal(H, settings.micCal, freqs);
  c.set(key, H);
  return H;
}

function applyCal(H, cal, freqs) {
  if (!cal || !cal.points?.length) return;
  const f = cal.points.map((p) => p[0]);
  const d = cal.points.map((p) => p[1]);
  for (let i = 0; i < freqs.length; i++) {
    const g = Math.pow(10, -interpDb(f, d, freqs[i]) / 20);
    H.re[i] *= g;
    H.im[i] *= g;
  }
}

/** Smoothed magnitude (dB) of a measurement or averaged curve. */
export function magnitudeOf(m, settings, smoothing = settings.smoothing) {
  if (m.curve) return smoothDb(Float64Array.from(m.curve.db), PPO, smoothing);
  const H = responseOf(m, settings);
  return smoothDb(magnitudeDb(H), PPO, smoothing);
}

export function phaseOf(m, settings) {
  const H = responseOf(m, settings);
  return H ? phaseDeg(H) : null;
}

/** Spatial (power) average of several measurements' magnitudes. */
export function spatialAverage(list, settings, name) {
  const n = FREQS.length;
  const acc = new Float64Array(n);
  const curves = list.map((m) => magnitudeOf(m, settings, 0));
  // normalise each position to its 200 Hz – 4 kHz level before averaging, so a
  // louder position does not dominate the tonal balance
  const levels = curves.map((db) => bandLevel(FREQS, db, 200, 4000));
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
  curves.forEach((db, k) => {
    for (let i = 0; i < n; i++) acc[i] += Math.pow(10, (db[i] - levels[k] + mean) / 10);
  });
  const db = Array.from(acc, (v) => 10 * Math.log10(v / list.length));
  return { name, createdAt: Date.now(), tag: 'system', curve: { db }, sources: list.map((m) => m.name) };
}

/** Common window start (absolute samples) for a pair of measurements. */
export function commonStart(a, b, preMs = 20) {
  const sr = a.sr;
  return Math.max(Math.max(a.irStart, b.irStart), Math.floor(Math.min(a.peak, b.peak) - (preMs / 1000) * sr));
}

/** Absolute peak time in ms (relative to capture start; includes loop latency). */
export const peakMs = (m) => (m.peak / m.sr) * 1000;

export function measurementCsv(m, settings) {
  const mag = magnitudeOf(m, settings, 0);
  const ph = m.ir ? phaseOf(m, settings) : null;
  const lines = ['Freq(Hz)\tMagnitude(dB)' + (ph ? '\tPhase(deg)' : '')];
  FREQS.forEach((f, i) => lines.push(`${f.toFixed(2)}\t${mag[i].toFixed(2)}${ph ? `\t${ph[i].toFixed(1)}` : ''}`));
  return lines.join('\n');
}
