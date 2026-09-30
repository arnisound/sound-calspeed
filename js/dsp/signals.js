// Test signal generation. Pure functions, no DOM.
import { fft } from './fft.js';

/**
 * Exponential (log) sine sweep, Farina method.
 * Returns Float32Array with short fades at both ends.
 */
export function logSweep(sr, f1, f2, seconds, amplitude = 1) {
  const n = Math.round(sr * seconds);
  const out = new Float32Array(n);
  const k = Math.log(f2 / f1);
  const L = seconds / k;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = amplitude * Math.sin(2 * Math.PI * f1 * L * (Math.exp(t / L) - 1));
  }
  // fade in over ~ 2 periods of f1 (max 50 ms), fade out over 5 ms
  const fadeIn = Math.min(Math.round((2 / f1) * sr), Math.round(0.05 * sr), n >> 2);
  const fadeOut = Math.min(Math.round(0.005 * sr), n >> 2);
  for (let i = 0; i < fadeIn; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
  for (let i = 0; i < fadeOut; i++) out[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  return out;
}

/** Tiny deterministic PRNG so noise buffers are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Periodic noise of length n (power of two), built in the frequency domain:
 * random phase, magnitude 1/sqrt(f) (pink) or flat (white), band-limited to
 * [fLow, fHigh]. Loops seamlessly. Normalised to the requested RMS.
 */
export function periodicNoise(n, sr, { color = 'pink', fLow = 20, fHigh = 20000, rms = 0.25, seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 1; k < n / 2; k++) {
    const f = (k * sr) / n;
    if (f < fLow || f > fHigh) continue;
    const mag = color === 'pink' ? 1 / Math.sqrt(f) : 1;
    const ph = rand() * 2 * Math.PI;
    re[k] = mag * Math.cos(ph);
    im[k] = mag * Math.sin(ph);
    re[n - k] = re[k];
    im[n - k] = -im[k];
  }
  fft(re, im, true);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += re[i] * re[i];
  const g = rms / Math.sqrt(sum / n || 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = re[i] * g;
  return out;
}

/** Band-limited single-cycle-per-period impulse train, useful for polarity checks. */
export function polarityPulse(sr, seconds = 1, rate = 2) {
  const n = Math.round(sr * seconds);
  const out = new Float32Array(n);
  const period = Math.round(sr / rate);
  // asymmetric raised-cosine positive pulse (~1 ms)
  const w = Math.round(sr * 0.001);
  for (let start = 0; start + w < n; start += period) {
    for (let i = 0; i < w; i++) out[start + i] = 0.9 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / w));
  }
  return out;
}

export function sine(sr, freq, seconds, amplitude = 0.5) {
  // whole number of periods so the buffer loops cleanly
  const periods = Math.max(1, Math.round(freq * seconds));
  const n = Math.round((periods / freq) * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * periods * i) / n);
  return out;
}

export function dbToLin(db) {
  return Math.pow(10, db / 20);
}

export function linToDb(x) {
  return 20 * Math.log10(Math.max(Math.abs(x), 1e-12));
}
