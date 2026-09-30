// Equalisation: biquad responses, automatic parametric EQ fitting, graphic EQ.
// Pure functions, no DOM.
import { THIRD_OCTAVE, interpDb } from './analysis.js';

/** RBJ cookbook biquad coefficients. type: peak | lowshelf | highshelf | hpf | lpf */
export function biquad(type, f0, gainDb, Q, sr) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * Q);
  let b0; let b1; let b2; let a0; let a1; let a2;
  switch (type) {
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + s);
      b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s;
      a1 = -2 * ((A - 1) + (A + 1) * cw);
      a2 = (A + 1) + (A - 1) * cw - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s);
      b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s;
      a1 = 2 * ((A - 1) - (A + 1) * cw);
      a2 = (A + 1) - (A - 1) * cw - s;
      break;
    }
    case 'hpf':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'lpf':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    default: // peak
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Magnitude (dB) of a biquad at frequency f. */
export function biquadDb(c, f, sr) {
  const w = (2 * Math.PI * f) / sr;
  const cr1 = Math.cos(w); const ci1 = -Math.sin(w);
  const cr2 = Math.cos(2 * w); const ci2 = -Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cr1 + c.b2 * cr2;
  const ni = c.b1 * ci1 + c.b2 * ci2;
  const dr = 1 + c.a1 * cr1 + c.a2 * cr2;
  const di = c.a1 * ci1 + c.a2 * ci2;
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** Total response (dB) of a list of filters {type, freq, gain, q} on grid `freqs`. */
export function filtersDb(filters, freqs, sr = 96000) {
  const out = new Float64Array(freqs.length);
  for (const flt of filters) {
    if (flt.enabled === false) continue;
    const c = biquad(flt.type || 'peak', flt.freq, flt.gain || 0, flt.q || 0.707, sr);
    for (let i = 0; i < freqs.length; i++) out[i] += biquadDb(c, freqs[i], sr);
  }
  return out;
}

/**
 * Least-squares level offset of `measured` towards `target` in [fLo, fHi]
 * so the target sits on the measurement's average level.
 */
export function alignLevel(freqs, measured, target, fLo, fHi) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= fLo && freqs[i] <= fHi) { sum += measured[i] - target[i]; n++; }
  }
  return n ? sum / n : 0;
}

/**
 * Automatic parametric EQ. Greedy placement on the worst deviation followed by
 * a coordinate-descent refinement of every band.
 *  - boosts are limited (dips are often acoustic cancellations — not fixable)
 *  - narrow boosts are forbidden
 * Returns {filters, offset, before, after} where before/after are RMS errors (dB).
 */
export function autoEq(freqs, measuredDb, targetDb, {
  fLo = 40, fHi = 16000, maxFilters = 8, maxBoost = 3, maxCut = 12,
  minQ = 0.5, maxQ = 8, maxBoostQ = 2, sr = 96000, tolerance = 1,
} = {}) {
  const offset = alignLevel(freqs, measuredDb, targetDb, Math.max(fLo, 200), Math.min(fHi, 4000));
  const idx = [];
  for (let i = 0; i < freqs.length; i++) if (freqs[i] >= fLo && freqs[i] <= fHi) idx.push(i);
  // deviation to correct: positive = too loud
  const dev = new Float64Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) dev[i] = measuredDb[i] - targetDb[i] - offset;

  const filters = [];
  const eqCurve = () => filtersDb(filters, freqs, sr);
  const error = (curve) => {
    let e = 0;
    for (const i of idx) {
      const r = dev[i] + curve[i];
      // penalise residual boosts needs (dips) less: they're usually not fixable
      e += r > 0 ? r * r : 0.5 * r * r;
    }
    return Math.sqrt(e / idx.length);
  };
  const before = error(new Float64Array(freqs.length));

  for (let n = 0; n < maxFilters; n++) {
    const curve = eqCurve();
    // weighted worst residual
    let worst = -1;
    let worstVal = 0;
    for (const i of idx) {
      const r = dev[i] + curve[i];
      const score = r > 0 ? r : r * 0.6;
      if (Math.abs(score) > Math.abs(worstVal)) { worstVal = score; worst = i; }
    }
    if (worst < 0 || Math.abs(dev[worst] + curve[worst]) < tolerance) break;
    const r0 = dev[worst] + curve[worst];
    // bandwidth: where residual stays above half of the peak
    let a = worst; let b = worst;
    while (a > idx[0] && Math.sign(dev[a - 1] + curve[a - 1]) === Math.sign(r0) && Math.abs(dev[a - 1] + curve[a - 1]) > Math.abs(r0) / 2) a--;
    while (b < idx[idx.length - 1] && Math.sign(dev[b + 1] + curve[b + 1]) === Math.sign(r0) && Math.abs(dev[b + 1] + curve[b + 1]) > Math.abs(r0) / 2) b++;
    const bwOct = Math.max(Math.log2(freqs[b] / freqs[a]), 1 / 12);
    const q0 = Math.sqrt(Math.pow(2, bwOct)) / (Math.pow(2, bwOct) - 1);
    const boost = r0 < 0;
    const flt = {
      type: 'peak',
      freq: freqs[worst],
      gain: clamp(-r0, -maxCut, maxBoost),
      q: clamp(q0, minQ, boost ? maxBoostQ : maxQ),
    };
    filters.push(flt);
    refine(filters, error, eqCurve, { maxBoost, maxCut, minQ, maxQ, maxBoostQ, fLo, fHi });
  }
  // drop negligible filters
  const kept = filters.filter((f) => Math.abs(f.gain) >= 0.5);
  kept.sort((x, y) => x.freq - y.freq);
  kept.forEach((f) => {
    f.freq = roundFreq(f.freq);
    f.gain = Math.round(f.gain * 10) / 10;
    f.q = Math.round(f.q * 100) / 100;
  });
  const after = error(filtersDb(kept, freqs, sr));
  return { filters: kept, offset, before, after };
}

function refine(filters, error, eqCurve, lim) {
  const params = [
    { key: 'gain', steps: [1, 0.5, 0.2] },
    { key: 'freq', steps: [1.06, 1.03, 1.01], mult: true },
    { key: 'q', steps: [1.2, 1.1, 1.04], mult: true },
  ];
  let current = error(eqCurve());
  for (let pass = 0; pass < 3; pass++) {
    for (const flt of filters) {
      for (const p of params) {
        for (const step of p.steps) {
          for (const dir of [1, -1]) {
            const old = flt[p.key];
            flt[p.key] = p.mult ? (dir > 0 ? old * step : old / step) : old + dir * step;
            constrain(flt, lim);
            const e = error(eqCurve());
            if (e < current - 1e-6) current = e; else flt[p.key] = old;
          }
        }
      }
    }
  }
}

function constrain(f, lim) {
  f.gain = clamp(f.gain, -lim.maxCut, lim.maxBoost);
  f.freq = clamp(f.freq, lim.fLo, lim.fHi);
  f.q = clamp(f.q, lim.minQ, f.gain > 0 ? lim.maxBoostQ : lim.maxQ);
}

/** Graphic EQ (31 bands) settings from a smoothed deviation. */
export function graphicEq(freqs, measuredDb, targetDb, { fLo = 25, fHi = 16000, maxBoost = 3, maxCut = 12, bands = THIRD_OCTAVE } = {}) {
  const offset = alignLevel(freqs, measuredDb, targetDb, 200, 4000);
  return bands.map((fc) => {
    if (fc < fLo || fc > fHi) return { freq: fc, gain: 0 };
    const d = interpDb(freqs, measuredDb, fc) - interpDb(freqs, targetDb, fc) - offset;
    return { freq: fc, gain: Math.round(clamp(-d, -maxCut, maxBoost) * 2) / 2 };
  });
}

/** Approximate response of a 31-band graphic EQ (constant-Q peaking, Q≈4.3). */
export function graphicEqDb(settings, freqs, sr = 96000) {
  return filtersDb(settings.filter((s) => s.gain).map((s) => ({ type: 'peak', freq: s.freq, gain: s.gain, q: 4.3 })), freqs, sr);
}

function roundFreq(f) {
  if (f < 100) return Math.round(f);
  if (f < 1000) return Math.round(f / 5) * 5;
  if (f < 10000) return Math.round(f / 50) * 50;
  return Math.round(f / 100) * 100;
}

export function clamp(x, a, b) {
  return Math.min(Math.max(x, a), b);
}
