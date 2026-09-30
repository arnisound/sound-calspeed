// Time / polarity alignment between two sources measured separately with the
// same loop latency (same audio session). Pure functions, no DOM.

export const speedOfSound = (tempC = 20) => 331.3 * Math.sqrt(1 + tempC / 273.15);

export const msFromMeters = (m, tempC = 20) => (m / speedOfSound(tempC)) * 1000;
export const metersFromMs = (ms, tempC = 20) => (ms / 1000) * speedOfSound(tempC);

/**
 * Scan delay (applied to B; negative = delay A) and polarity of B, evaluating
 * how A and B combine over [fLo, fHi].
 *
 * mode 'sum'    → efficiency = Σ|A+B'| / Σ(|A|+|B|)  (1 = perfect summation)
 * mode 'cancel' → rejection  = Σ|A+B'|² / Σ(|A|²+|B|²) (lower = better)
 *
 * A and B are {re, im} on grid `freqs`, referenced to the same time origin.
 */
export function scanAlignment(A, B, freqs, {
  fLo, fHi, maxMs = 20, stepMs = 0.05, mode = 'sum', polarities = [1, -1],
} = {}) {
  const idx = [];
  for (let i = 0; i < freqs.length; i++) if (freqs[i] >= fLo && freqs[i] <= fHi) idx.push(i);
  if (!idx.length) throw new Error('Bande de fréquence vide');

  // weight: emphasise frequencies where both sources contribute (crossover)
  const weights = idx.map((i) => {
    const a = Math.hypot(A.re[i], A.im[i]);
    const b = Math.hypot(B.re[i], B.im[i]);
    const m = Math.max(a, b);
    return m > 0 ? 0.25 + (0.75 * Math.min(a, b)) / m : 0;
  });

  const steps = Math.round(maxMs / stepMs);
  const delays = new Float64Array(2 * steps + 1);
  const curves = {};
  for (const p of polarities) curves[p] = new Float64Array(2 * steps + 1);

  for (let s = -steps; s <= steps; s++) {
    const tau = (s * stepMs) / 1000;
    delays[s + steps] = s * stepMs;
    for (const p of polarities) {
      let num = 0;
      let den = 0;
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j];
        const w = weights[j];
        const ph = -2 * Math.PI * freqs[i] * tau;
        const c = Math.cos(ph);
        const sn = Math.sin(ph);
        const br = p * (B.re[i] * c - B.im[i] * sn);
        const bi = p * (B.re[i] * sn + B.im[i] * c);
        const sr = A.re[i] + br;
        const si = A.im[i] + bi;
        if (mode === 'sum') {
          num += w * Math.hypot(sr, si);
          den += w * (Math.hypot(A.re[i], A.im[i]) + Math.hypot(B.re[i], B.im[i]));
        } else {
          num += w * (sr * sr + si * si);
          den += w * (A.re[i] * A.re[i] + A.im[i] * A.im[i] + B.re[i] * B.re[i] + B.im[i] * B.im[i]);
        }
      }
      curves[p][s + steps] = den > 0 ? num / den : 0;
    }
  }

  const better = mode === 'sum' ? (a, b) => a > b : (a, b) => a < b;
  let best = null;
  for (const p of polarities) {
    const c = curves[p];
    for (let i = 0; i < c.length; i++) {
      if (!best || better(c[i], best.score)) best = { delayMs: delays[i], polarity: p, score: c[i] };
    }
  }

  // Local optima within a small tolerance of the best: shows ambiguity
  // (periodic solutions one period apart at the crossover frequency).
  const alternatives = [];
  const tol = mode === 'sum' ? 0.03 : 1.5; // efficiency points, or ratio factor
  for (const p of polarities) {
    const c = curves[p];
    for (let i = 1; i < c.length - 1; i++) {
      const isOpt = mode === 'sum' ? c[i] >= c[i - 1] && c[i] >= c[i + 1] : c[i] <= c[i - 1] && c[i] <= c[i + 1];
      if (!isOpt) continue;
      const close = mode === 'sum' ? best.score - c[i] <= tol : c[i] <= best.score * tol;
      if (close && !(delays[i] === best.delayMs && p === best.polarity)) {
        alternatives.push({ delayMs: delays[i], polarity: p, score: c[i] });
      }
    }
  }
  alternatives.sort((a, b) => Math.abs(a.delayMs) - Math.abs(b.delayMs));

  return { best, alternatives: alternatives.slice(0, 6), delays, curves, mode };
}

/** Sum of two complex responses with delay (ms) and polarity applied to B. */
export function combine(A, B, freqs, delayMs = 0, polarity = 1) {
  const n = freqs.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const tau = delayMs / 1000;
  for (let i = 0; i < n; i++) {
    const ph = -2 * Math.PI * freqs[i] * tau;
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    re[i] = A.re[i] + polarity * (B.re[i] * c - B.im[i] * s);
    im[i] = A.im[i] + polarity * (B.re[i] * s + B.im[i] * c);
  }
  return { re, im };
}

/** Apply a pure delay (ms) to a complex response. */
export function delayResponse(H, freqs, delayMs, polarity = 1) {
  const zero = { re: new Float64Array(freqs.length), im: new Float64Array(freqs.length) };
  return combine(zero, H, freqs, delayMs, polarity);
}

/** Human friendly description of a scan result. */
export function describeDelay(delayMs, nameA = 'A', nameB = 'B') {
  const d = Math.abs(delayMs);
  if (d < 0.01) return `Aucun délai nécessaire`;
  return delayMs > 0 ? `Retarder ${nameB} de ${d.toFixed(2)} ms` : `Retarder ${nameA} de ${d.toFixed(2)} ms`;
}

/**
 * Crossover frequency estimate: where the two magnitude curves cross
 * (closest crossing to the geometric centre of [fLo, fHi]).
 */
export function crossoverFrequency(A, B, freqs, fLo = 30, fHi = 300) {
  let bestF = null;
  let bestDist = Infinity;
  const centre = Math.sqrt(fLo * fHi);
  let prev = null;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] < fLo || freqs[i] > fHi) continue;
    const d = Math.hypot(A.re[i], A.im[i]) - Math.hypot(B.re[i], B.im[i]);
    if (prev && Math.sign(d) !== Math.sign(prev.d)) {
      const f = Math.sqrt(prev.f * freqs[i]);
      const dist = Math.abs(Math.log(f / centre));
      if (dist < bestDist) { bestDist = dist; bestF = f; }
    }
    prev = { d, f: freqs[i] };
  }
  return bestF;
}

// ---- Cardioid subwoofer arrangements (theory) ----

/**
 * End-fire array: `rows` subs in line, spaced `spacing` m, all facing the
 * audience. The rearmost row plays first; each row towards the audience is
 * delayed by its distance to the rear row. Returns delays from rear to front.
 */
export function endFire(rows, spacing, tempC = 20) {
  const out = [];
  for (let k = 0; k < rows; k++) {
    out.push({ row: k + 1, position: k === 0 ? 'arrière' : k === rows - 1 ? 'avant' : 'milieu', delayMs: msFromMeters(k * spacing, tempC), polarity: 1 });
  }
  return out;
}

/**
 * Gradient / "cardio stack": front-facing subs + one rear sub (facing
 * backwards or forwards) at acoustic distance `depth` m behind the front ones.
 * The rear element is inverted and delayed by depth/c so its sound meets the
 * front one's wavefront in anti-phase behind the array.
 */
export function gradient(depth, tempC = 20) {
  return {
    front: { delayMs: 0, polarity: 1 },
    rear: { delayMs: msFromMeters(depth, tempC), polarity: -1 },
  };
}

/** Theoretical front/rear response of a 2-element gradient at frequency f. */
export function gradientResponse(f, depth, tempC = 20, rearGain = 1) {
  const c = speedOfSound(tempC);
  const tau = depth / c;
  const w = 2 * Math.PI * f;
  // front: rear source arrives depth/c later + electronic delay tau, inverted
  const fr = 1 - rearGain * Math.cos(w * 2 * tau);
  const fi = rearGain * Math.sin(w * 2 * tau);
  const front = Math.hypot(fr, fi);
  // rear: rear source is depth/c earlier, delayed by tau → coincident, inverted
  const rear = Math.abs(1 - rearGain);
  return { frontDb: 20 * Math.log10(front + 1e-9), rearDb: 20 * Math.log10(rear + 1e-9) };
}

/** End-fire theoretical front/back level (dB relative to one element) at f. */
export function endFireResponse(f, rows, spacing, tempC = 20) {
  const c = speedOfSound(tempC);
  const w = 2 * Math.PI * f;
  let fr = 0; let fi = 0; let br = 0; let bi = 0;
  for (let k = 0; k < rows; k++) {
    const x = k * spacing; // distance from rear row
    const delay = x / c;
    // front listener: path shorter by x → phase advance x/c, plus electronic delay
    const tf = delay - x / c;
    fr += Math.cos(w * tf); fi -= Math.sin(w * tf);
    // rear listener: path longer by x
    const tb = delay + x / c;
    br += Math.cos(w * tb); bi -= Math.sin(w * tb);
  }
  return { frontDb: 20 * Math.log10(Math.hypot(fr, fi) + 1e-9), rearDb: 20 * Math.log10(Math.hypot(br, bi) + 1e-9) };
}
