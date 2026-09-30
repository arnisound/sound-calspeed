// Measurement analysis: deconvolution, impulse response, frequency response,
// fractional octave smoothing. Pure functions, no DOM.
import { fft, nextPow2 } from './fft.js';

export function logFreqs(fMin = 20, fMax = 20000, perOctave = 48) {
  const n = Math.floor(Math.log2(fMax / fMin) * perOctave) + 1;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = fMin * Math.pow(2, i / perOctave);
  return out;
}

/**
 * Deconvolve a recording by the excitation (sweep or any broadband signal).
 * H = R * conj(S) / (|S|^2 + eps), with extra regularisation outside [f1, f2].
 * Returns the impulse response (length = fft size); anything before the
 * direct sound (e.g. log-sweep harmonic distortion) wraps to the end.
 */
export function deconvolve(recorded, excitation, sr, f1 = 20, f2 = 20000) {
  const n = nextPow2(recorded.length + excitation.length);
  const rRe = new Float64Array(n);
  const rIm = new Float64Array(n);
  const sRe = new Float64Array(n);
  const sIm = new Float64Array(n);
  for (let i = 0; i < recorded.length; i++) rRe[i] = recorded[i];
  for (let i = 0; i < excitation.length; i++) sRe[i] = excitation[i];
  fft(rRe, rIm);
  fft(sRe, sIm);
  let maxPow = 0;
  for (let k = 0; k <= n / 2; k++) maxPow = Math.max(maxPow, sRe[k] * sRe[k] + sIm[k] * sIm[k]);
  const epsIn = maxPow * 1e-6;
  const epsOut = maxPow * 1e-1;
  const lo = f1 / Math.SQRT2;
  const hi = Math.min(f2 * Math.SQRT2, sr / 2);
  for (let k = 0; k < n; k++) {
    const kk = k <= n / 2 ? k : n - k;
    const f = (kk * sr) / n;
    const eps = f >= lo && f <= hi ? epsIn : epsOut;
    const den = sRe[k] * sRe[k] + sIm[k] * sIm[k] + eps;
    const re = (rRe[k] * sRe[k] + rIm[k] * sIm[k]) / den;
    const im = (rIm[k] * sRe[k] - rRe[k] * sIm[k]) / den;
    rRe[k] = re;
    rIm[k] = im;
  }
  fft(rRe, rIm, true);
  return rRe;
}

/** Index of the absolute maximum with parabolic sub-sample refinement. */
export function findPeak(ir, from = 0, to = ir.length) {
  let idx = from;
  let max = -1;
  for (let i = from; i < to; i++) {
    const a = Math.abs(ir[i]);
    if (a > max) { max = a; idx = i; }
  }
  let frac = 0;
  if (idx > 0 && idx < ir.length - 1) {
    const y0 = Math.abs(ir[idx - 1]);
    const y1 = Math.abs(ir[idx]);
    const y2 = Math.abs(ir[idx + 1]);
    const d = y0 - 2 * y1 + y2;
    if (d !== 0) frac = (0.5 * (y0 - y2)) / d;
  }
  return { index: idx, position: idx + frac, value: ir[idx], polarity: ir[idx] >= 0 ? 1 : -1 };
}

/**
 * Complex response evaluated directly (DFT) at arbitrary frequencies.
 * Time origin for phase is `ref` (in samples, may be fractional).
 * Window: starts at `start`, length given by `lengthFor(f)` samples, with a
 * raised-cosine fade in over `fadeIn` samples and a half-Hann fade out over
 * the second half of the window (typical frequency-dependent window shape).
 */
export function responseAt(ir, sr, freqs, { start = 0, ref = start, lengthFor, fadeIn = 0 } = {}) {
  const n = freqs.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const s0 = Math.max(0, Math.floor(start));
  for (let k = 0; k < n; k++) {
    const f = freqs[k];
    const len = Math.max(8, Math.min(Math.round(lengthFor(f)), ir.length - s0));
    const w = (2 * Math.PI * f) / sr;
    const c = Math.cos(w);
    const s = Math.sin(w);
    // phasor e^{-j w (i - ref)} starting at i = s0
    let pr = Math.cos(-w * (s0 - ref));
    let pi = Math.sin(-w * (s0 - ref));
    let accR = 0;
    let accI = 0;
    const halfStart = len >> 1;
    const fadeLen = len - halfStart;
    for (let i = 0; i < len; i++) {
      let win = 1;
      if (i < fadeIn) win = 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
      else if (i >= halfStart) win = 0.5 + 0.5 * Math.cos((Math.PI * (i - halfStart)) / fadeLen);
      const x = ir[s0 + i] * win;
      accR += x * pr;
      accI += x * pi;
      // rotate phasor by e^{-jw}
      const nr = pr * c + pi * s;
      pi = pi * c - pr * s;
      pr = nr;
    }
    re[k] = accR;
    im[k] = accI;
  }
  return { re, im };
}

/** Fixed-length window, in milliseconds. */
export function fixedWindow(sr, ms) {
  const len = (ms / 1000) * sr;
  return () => len;
}

/** Frequency-dependent window: `cycles` periods per frequency, clamped. */
export function fdWindow(sr, cycles = 8, minMs = 2, maxMs = 500) {
  return (f) => Math.min(Math.max((cycles / f) * sr, (minMs / 1000) * sr), (maxMs / 1000) * sr);
}

export function magnitudeDb({ re, im }) {
  const out = new Float64Array(re.length);
  for (let i = 0; i < re.length; i++) out[i] = 10 * Math.log10(re[i] * re[i] + im[i] * im[i] + 1e-24);
  return out;
}

export function phaseDeg({ re, im }) {
  const out = new Float64Array(re.length);
  for (let i = 0; i < re.length; i++) out[i] = (Math.atan2(im[i], re[i]) * 180) / Math.PI;
  return out;
}

/**
 * Fractional octave smoothing on a log-uniform grid (power average).
 * `perOctave` is the grid density; `fraction` e.g. 3 for 1/3 octave.
 */
export function smoothDb(db, perOctave, fraction) {
  if (!fraction) return Float64Array.from(db);
  const n = db.length;
  const half = Math.max(0, Math.round(perOctave / fraction / 2));
  const pow = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pow[i + 1] = pow[i] + Math.pow(10, db[i] / 10);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    out[i] = 10 * Math.log10((pow[b + 1] - pow[a]) / (b - a + 1));
  }
  return out;
}

/** Complex smoothing (keeps phase meaningful for display of summed responses). */
export function smoothComplex({ re, im }, perOctave, fraction) {
  if (!fraction) return { re: Float64Array.from(re), im: Float64Array.from(im) };
  const n = re.length;
  const half = Math.max(0, Math.round(perOctave / fraction / 2));
  const cr = new Float64Array(n + 1);
  const ci = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { cr[i + 1] = cr[i] + re[i]; ci[i + 1] = ci[i] + im[i]; }
  const oRe = new Float64Array(n);
  const oIm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    const c = b - a + 1;
    oRe[i] = (cr[b + 1] - cr[a]) / c;
    oIm[i] = (ci[b + 1] - ci[a]) / c;
  }
  return { re: oRe, im: oIm };
}

/** Average level (dB, power mean) of a dB curve between fLo and fHi. */
export function bandLevel(freqs, db, fLo, fHi) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= fLo && freqs[i] <= fHi) { sum += Math.pow(10, db[i] / 10); count++; }
  }
  return count ? 10 * Math.log10(sum / count) : -Infinity;
}

/**
 * Band-limit an impulse response with a smooth frequency-domain mask
 * (raised-cosine skirts, `skirt` octaves wide). Returns a new Float64Array.
 */
export function bandpass(ir, sr, fLo, fHi, skirt = 0.5) {
  const n = nextPow2(ir.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < ir.length; i++) re[i] = ir[i];
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const kk = k <= n / 2 ? k : n - k;
    const f = (kk * sr) / n;
    const g = f <= 0 ? 0 : bandGain(f, fLo, fHi, skirt);
    re[k] *= g;
    im[k] *= g;
  }
  fft(re, im, true);
  return re.subarray(0, ir.length);
}

function bandGain(f, fLo, fHi, skirt) {
  const o = Math.log2(f);
  const lo = fLo > 0 ? Math.log2(fLo) : -Infinity;
  const hi = fHi > 0 ? Math.log2(fHi) : Infinity;
  let g = 1;
  if (o < lo) g *= edge((o - (lo - skirt)) / skirt);
  if (o > hi) g *= edge(((hi + skirt) - o) / skirt);
  return g;
}

function edge(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

/** Envelope (magnitude of analytic signal) via FFT Hilbert transform. */
export function envelope(x) {
  const n = nextPow2(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i];
  fft(re, im);
  for (let k = 1; k < n / 2; k++) { re[k] *= 2; im[k] *= 2; }
  for (let k = n / 2 + 1; k < n; k++) { re[k] = 0; im[k] = 0; }
  fft(re, im, true);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.hypot(re[i], im[i]);
  return out;
}

/**
 * Arrival time of the energy in a band (samples, sub-sample precision),
 * taken as the peak of the band-limited envelope.
 */
export function arrivalTime(ir, sr, fLo = 0, fHi = 0) {
  const x = fLo || fHi ? bandpass(ir, sr, fLo, fHi) : ir;
  const env = envelope(x);
  return findPeak(env).position;
}

/**
 * Estimated SNR (dB): peak energy vs mean energy in [noiseFrom, noiseTo)
 * (normally the late part of the recorded tail, after the room decay).
 */
export function estimateSnr(ir, peakIndex, noiseFrom, noiseTo) {
  let noise = 0;
  let count = 0;
  for (let i = Math.max(0, noiseFrom); i < Math.min(ir.length, noiseTo); i++) { noise += ir[i] * ir[i]; count++; }
  const peak = ir[peakIndex] * ir[peakIndex];
  if (!count || noise === 0) return Infinity;
  return 10 * Math.log10(peak / (noise / count));
}

/** Magnitude-squared coherence-like stability across repeated measurements. */
export function stability(responses) {
  const n = responses[0].re.length;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    let sp = 0;
    for (const r of responses) {
      sr += r.re[k];
      si += r.im[k];
      sp += r.re[k] * r.re[k] + r.im[k] * r.im[k];
    }
    out[k] = sp > 0 ? (sr * sr + si * si) / (responses.length * sp) : 0;
  }
  return out;
}

/** Octave / third-octave band centres (ISO 266 nominal values). */
export const THIRD_OCTAVE = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];
export const OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** Interpolate a dB curve (on grid `freqs`) at frequency f, log-linear. */
export function interpDb(freqs, db, f) {
  if (f <= freqs[0]) return db[0];
  const last = freqs.length - 1;
  if (f >= freqs[last]) return db[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (freqs[mid] <= f) lo = mid; else hi = mid;
  }
  const t = Math.log(f / freqs[lo]) / Math.log(freqs[hi] / freqs[lo]);
  return db[lo] + t * (db[hi] - db[lo]);
}
