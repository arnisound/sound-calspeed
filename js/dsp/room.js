// Room acoustics from an impulse response: reverberation time (EDT, T20, T30)
// per octave band, clarity (C50, C80), definition (D50), and reverberant-field
// compensation. Pure functions, no DOM.
import { bandpass, findPeak, OCTAVES } from './analysis.js';

/**
 * Schroeder backward integration with noise-floor handling:
 * the noise floor is estimated from the last 10 % of the IR, the IR is
 * truncated where its smoothed envelope meets the noise, and the integral is
 * compensated for the energy lost by truncation (Lundeby-style, simplified).
 * Returns the energy decay curve in dB (0 dB at `start`).
 */
export function schroeder(ir, sr, start = 0) {
  const x = ir.subarray ? ir.subarray(start) : ir.slice(start);
  const n = x.length;
  const block = Math.max(1, Math.round(0.01 * sr));
  const nb = Math.floor(n / block);
  const env = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    let s = 0;
    for (let i = b * block; i < (b + 1) * block; i++) s += x[i] * x[i];
    env[b] = s / block;
  }
  const noiseStart = Math.floor(nb * 0.9);
  let noise = 0;
  for (let b = noiseStart; b < nb; b++) noise += env[b];
  noise /= Math.max(1, nb - noiseStart);

  let peak = 0;
  for (let b = 0; b < nb; b++) peak = Math.max(peak, env[b]);
  // truncation: last block still clearly above the noise floor (+ 5 dB)
  let cut = nb;
  const thr = noise * Math.pow(10, 5 / 10);
  for (let b = nb - 1; b >= 0; b--) {
    if (env[b] > thr) { cut = b + 1; break; }
  }
  const cutSample = Math.min(n, cut * block);
  // compensation for the decay energy lost beyond the cut: fit the envelope
  // slope (dB/s) between -5 dB and noise+10 dB, extrapolate the exponential tail
  const envDb = (b) => 10 * Math.log10(Math.max(env[b], 1e-30) / (peak || 1));
  const hiLim = -5;
  const loLim = 10 * Math.log10(noise / (peak || 1)) + 10;
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0; let cnt = 0;
  for (let b = 0; b < cut; b++) {
    const d = envDb(b);
    if (d <= hiLim && d >= loLim) {
      const t = (b * block) / sr;
      sx += t; sy += d; sxx += t * t; sxy += t * d; cnt++;
    }
  }
  let acc = 0;
  if (cnt >= 3) {
    const slope = (cnt * sxy - sx * sy) / (cnt * sxx - sx * sx); // dB/s, negative
    if (slope < 0) {
      const lastB = Math.max(0, cut - 1);
      const eCut = Math.max(env[lastB] - noise, 0); // per-sample energy at the cut
      acc = (eCut * sr * 10) / (-slope * Math.LN10);
    }
  }
  const edc = new Float64Array(cutSample);
  for (let i = cutSample - 1; i >= 0; i--) {
    acc += x[i] * x[i] - noise;
    edc[i] = Math.max(acc, 1e-30);
  }
  const e0 = edc[0];
  const out = new Float64Array(cutSample);
  for (let i = 0; i < cutSample; i++) out[i] = 10 * Math.log10(edc[i] / e0);
  return { edc: out, noiseDb: 10 * Math.log10(noise / (peak || 1)), dynamicRange: 10 * Math.log10((peak || 1) / (noise || 1e-30)) };
}

/** Linear regression of the EDC between two levels (dB) → decay time for 60 dB (s). */
export function decayTime(edc, sr, fromDb, toDb) {
  let i0 = -1;
  let i1 = -1;
  for (let i = 0; i < edc.length; i++) {
    if (i0 < 0 && edc[i] <= fromDb) i0 = i;
    if (edc[i] <= toDb) { i1 = i; break; }
  }
  if (i0 < 0 || i1 < 0 || i1 - i0 < 4) return null;
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  const n = i1 - i0 + 1;
  for (let i = i0; i <= i1; i++) {
    const t = i / sr;
    sx += t; sy += edc[i]; sxx += t * t; sxy += t * edc[i];
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  if (!(slope < 0)) return null;
  return -60 / slope;
}

/** Energy ratio metrics from the broadband IR. */
export function clarity(ir, sr, start) {
  const e = (a, b) => {
    let s = 0;
    for (let i = Math.max(0, a); i < Math.min(ir.length, b); i++) s += ir[i] * ir[i];
    return s;
  };
  const t50 = start + Math.round(0.05 * sr);
  const t80 = start + Math.round(0.08 * sr);
  const end = ir.length;
  const early50 = e(start, t50);
  const early80 = e(start, t80);
  const total = e(start, end);
  return {
    c50: 10 * Math.log10(early50 / Math.max(total - early50, 1e-30)),
    c80: 10 * Math.log10(early80 / Math.max(total - early80, 1e-30)),
    d50: early50 / Math.max(total, 1e-30),
  };
}

/**
 * Full room analysis. `ir` should contain at least ~1.5× the expected RT
 * after the direct sound. Returns per-octave EDT/T20/T30 and clarity.
 */
export function analyzeRoom(ir, sr, { bands = OCTAVES.filter((f) => f >= 63 && f <= 8000) } = {}) {
  const peak = findPeak(ir).index;
  const start = Math.max(0, peak - Math.round(0.001 * sr));
  const results = bands.map((fc) => {
    const x = bandpass(ir, sr, fc / Math.SQRT2, fc * Math.SQRT2, 0.3);
    // band start at the band's own peak (filters delay LF)
    const bp = findPeak(x, start, Math.min(x.length, start + Math.round(0.1 * sr))).index;
    const { edc, dynamicRange } = schroeder(x, sr, bp);
    return {
      freq: fc,
      edt: decayTime(edc, sr, -0.01, -10),
      t20: dynamicRange > 35 ? decayTime(edc, sr, -5, -25) : null,
      t30: dynamicRange > 45 ? decayTime(edc, sr, -5, -35) : null,
      dynamicRange,
    };
  });
  const broadband = schroeder(ir, sr, start);
  return {
    bands: results,
    broadband: {
      edt: decayTime(broadband.edc, sr, -0.01, -10),
      t20: decayTime(broadband.edc, sr, -5, -25),
      t30: broadband.dynamicRange > 45 ? decayTime(broadband.edc, sr, -5, -35) : null,
      edc: broadband.edc,
      dynamicRange: broadband.dynamicRange,
    },
    ...clarity(ir, sr, start),
  };
}

/** Best available reverberation time for a band result (T30 > T20 > EDT). */
export function bestRt(b) {
  return b.t30 ?? b.t20 ?? b.edt ?? null;
}

/** Mid-frequency RT (mean of 500 Hz and 1 kHz). */
export function rtMid(analysis) {
  const vals = analysis.bands.filter((b) => b.freq === 500 || b.freq === 1000).map(bestRt).filter((v) => v);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : bestRt(analysis.broadband);
}

/** Schroeder frequency (Hz): below it, room modes dominate. V in m³, T in s. */
export function schroederFrequency(rt, volume) {
  return 2000 * Math.sqrt(rt / volume);
}

/** Critical distance (m) for a source of directivity factor Q in a room. */
export function criticalDistance(rt, volume, Q = 1) {
  return 0.057 * Math.sqrt((Q * volume) / rt);
}

/**
 * Reverberant-field compensation (heuristic): the diffuse energy in a band is
 * roughly proportional to its RT. Where RT is longer than at mid frequencies,
 * the perceived tonal balance gets heavier in that band; this returns per-band
 * target offsets (dB) = -amount · 10·log10(RT/RTmid), limited to ±maxDb.
 */
export function reverbCompensation(analysis, amount = 0.5, maxDb = 6) {
  const mid = rtMid(analysis);
  if (!mid) return [];
  return analysis.bands.map((b) => {
    const rt = bestRt(b);
    if (!rt) return { freq: b.freq, db: 0 };
    const db = -amount * 10 * Math.log10(rt / mid);
    return { freq: b.freq, db: Math.max(-maxDb, Math.min(maxDb, db)) };
  });
}

/** Qualitative advice for the measured room. Returns an array of strings (FR). */
export function roomAdvice(analysis, { volume } = {}) {
  const tips = [];
  const mid = rtMid(analysis);
  if (!mid) {
    tips.push('Décroissance non mesurable : augmenter le niveau du sweep ou réduire le bruit ambiant.');
    return tips;
  }
  const low = analysis.bands.find((b) => b.freq === 125);
  const lowRt = low && bestRt(low);
  if (mid < 0.6) tips.push(`Salle mate (RT ≈ ${mid.toFixed(2)} s) : peu de correction d'environnement nécessaire, la réponse mesurée est proche du son direct.`);
  else if (mid < 1.2) tips.push(`Salle moyennement réverbérante (RT ≈ ${mid.toFixed(2)} s) : utiliser un fenêtrage (FDW) pour l'EQ et un lissage 1/6 oct.`);
  else if (mid < 2.0) tips.push(`Salle réverbérante (RT ≈ ${mid.toFixed(2)} s) : égaliser sur le son direct (fenêtre FDW 6–8 cycles), éviter de corriger les creux, viser une pente descendante dans l'aigu.`);
  else tips.push(`Salle très réverbérante (RT ≈ ${mid.toFixed(2)} s) : privilégier la directivité (line array, sub cardio), rapprocher les sources du public (rappels), réduire le niveau global, et limiter l'EQ au son direct.`);
  if (lowRt && lowRt > mid * 1.3) tips.push(`Le grave traîne (RT 125 Hz ≈ ${lowRt.toFixed(2)} s) : réduire le niveau sub / grave, envisager un sub cardioïde pour limiter l'excitation de la salle vers l'arrière et la scène.`);
  if (analysis.c80 < -2) tips.push(`Clarté musicale faible (C80 = ${analysis.c80.toFixed(1)} dB) : augmenter la part de son direct (plus de sources, plus proches, plus directives).`);
  if (analysis.d50 < 0.5) tips.push(`Intelligibilité de la parole limitée (D50 = ${(analysis.d50 * 100).toFixed(0)} %) : couper le grave des voix (HPF 100–150 Hz), éviter l'excès de niveau.`);
  if (volume) {
    const fs = schroederFrequency(mid, volume);
    tips.push(`Fréquence de Schroeder ≈ ${Math.round(fs)} Hz : en dessous, les modes de salle dominent — les corrections EQ étroites y dépendent de la position, préférer déplacer les subs ou mesurer plusieurs positions.`);
    tips.push(`Distance critique ≈ ${criticalDistance(mid, volume, 10).toFixed(1)} m pour une enceinte Q≈10 : au-delà, le champ réverbéré domine.`);
  }
  return tips;
}
