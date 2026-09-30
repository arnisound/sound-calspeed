import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, nextPow2 } from '../js/dsp/fft.js';
import { logSweep, periodicNoise, mulberry32 } from '../js/dsp/signals.js';
import {
  deconvolve, findPeak, responseAt, fixedWindow, fdWindow, magnitudeDb, logFreqs,
  smoothDb, arrivalTime, bandLevel, interpDb,
} from '../js/dsp/analysis.js';
import { scanAlignment, msFromMeters, endFireResponse, gradientResponse, crossoverFrequency } from '../js/dsp/align.js';
import { autoEq, filtersDb, biquad, biquadDb, graphicEq } from '../js/dsp/eq.js';
import { analyzeRoom, bestRt, reverbCompensation } from '../js/dsp/room.js';

const SR = 48000;

function convolve(x, h) {
  const out = new Float64Array(x.length + h.length - 1);
  for (let j = 0; j < h.length; j++) {
    if (h[j] === 0) continue;
    for (let i = 0; i < x.length; i++) out[i + j] += x[i] * h[j];
  }
  return out;
}

/** Simple 2nd-order filter IR (biquad impulse response) — a "speaker". */
function biquadIr(type, f0, q, len, gain = 0) {
  const c = biquad(type, f0, gain, q, SR);
  const y = new Float64Array(len);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < len; i++) {
    const x0 = i === 0 ? 1 : 0;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    y[i] = y0; x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return y;
}

function delayed(ir, samples, gain = 1, total = ir.length + samples) {
  const out = new Float64Array(total);
  for (let i = 0; i < ir.length && i + samples < total; i++) out[i + samples] = ir[i] * gain;
  return out;
}

test('fft round trip and known bin', () => {
  const n = 256;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 8 * i) / n);
  fft(re, im);
  assert.ok(Math.abs(re[8] - n / 2) < 1e-9);
  assert.ok(Math.abs(re[3]) < 1e-9);
  fft(re, im, true);
  assert.ok(Math.abs(re[1] - Math.cos((2 * Math.PI * 8) / n)) < 1e-9);
  assert.equal(nextPow2(1000), 1024);
});

test('sweep deconvolution recovers delay and polarity', () => {
  const sweep = logSweep(SR, 20, 20000, 1);
  const lag = 1234;
  const system = delayed(new Float64Array([1]), lag, -0.5);
  const rec = convolve(sweep, system);
  const ir = deconvolve(rec, sweep, SR);
  const p = findPeak(ir, 0, ir.length / 2);
  assert.equal(p.index, lag);
  assert.equal(p.polarity, -1);
  assert.ok(Math.abs(Math.abs(p.value) - 0.5) < 0.15, `peak ${p.value}`);
});

test('frequency response of a flat system is flat within band', () => {
  const sweep = logSweep(SR, 20, 20000, 1);
  const rec = convolve(sweep, delayed(new Float64Array([1]), 100));
  const ir = deconvolve(rec, sweep, SR);
  const freqs = logFreqs(40, 16000, 24);
  const H = responseAt(ir, SR, freqs, { start: 100 - 48, ref: 100, lengthFor: fixedWindow(SR, 200), fadeIn: 48 });
  const db = magnitudeDb(H);
  for (const v of db) assert.ok(Math.abs(v) < 0.5, `level ${v}`);
});

test('responseAt matches a known biquad response (FDW)', () => {
  const ir = biquadIr('peak', 1000, 2, 20000, 6);
  const freqs = logFreqs(100, 10000, 12);
  const H = responseAt(ir, SR, freqs, { start: 0, lengthFor: fdWindow(SR, 30, 5, 400) });
  const db = magnitudeDb(H);
  const c = biquad('peak', 1000, 6, 2, SR);
  freqs.forEach((f, i) => assert.ok(Math.abs(db[i] - biquadDb(c, f, SR)) < 0.3, `${f}: ${db[i]}`));
});

test('smoothing preserves a flat curve and fractional octave width', () => {
  const flat = new Float64Array(100).fill(3);
  const s = smoothDb(flat, 24, 3);
  assert.ok(s.every((v) => Math.abs(v - 3) < 1e-9));
});

test('alignment finds delay and polarity between main and sub', () => {
  const len = 16384;
  const top = biquadIr('hpf', 90, 0.707, len); // top: high-passed
  const sub = biquadIr('lpf', 90, 0.707, len); // sub: low-passed
  const latency = 500; // shared loop latency
  const trueDelayMs = 3.2; // sub arrives 3.2 ms earlier than top: sub must be delayed
  const subLag = latency;
  const topLag = latency + Math.round((trueDelayMs / 1000) * SR);
  const irTop = delayed(top, topLag, 1, len + 2000);
  const irSub = delayed(sub, subLag, -1, len + 2000); // wired inverted
  const freqs = logFreqs(20, 1000, 48);
  const opts = { start: 0, ref: 0, lengthFor: fixedWindow(SR, 300) };
  const A = responseAt(irTop, SR, freqs, opts);
  const B = responseAt(irSub, SR, freqs, opts);
  const res = scanAlignment(A, B, freqs, { fLo: 45, fHi: 180, maxMs: 10, stepMs: 0.05 });
  // an LR2-like pair (hpf+lpf 2nd order) sums flat when one is inverted: with
  // the sub wired inverted, restoring polarity "inverted" (-1) or 0 would be expected
  assert.ok(Math.abs(res.best.delayMs - trueDelayMs) < 0.3, JSON.stringify(res.best));
  assert.ok(res.best.score > 0.9);
  const xo = crossoverFrequency(A, B, freqs, 30, 300);
  assert.ok(xo > 70 && xo < 115, `xo ${xo}`);
});

test('cardioid measurement mode minimises rear energy', () => {
  const len = 16384;
  const sub = biquadIr('lpf', 120, 0.707, len);
  const front = delayed(sub, 700, 1, len + 2000);
  const lag = Math.round(msFromMeters(0.8) / 1000 * SR);
  const rear = delayed(sub, 700 - lag, 1, len + 2000); // rear box is closer to rear mic
  const freqs = logFreqs(20, 500, 48);
  const opts = { start: 0, ref: 0, lengthFor: fixedWindow(SR, 300) };
  const A = responseAt(front, SR, freqs, opts);
  const B = responseAt(rear, SR, freqs, opts);
  const res = scanAlignment(A, B, freqs, { fLo: 40, fHi: 100, maxMs: 6, stepMs: 0.02, mode: 'cancel' });
  assert.equal(res.best.polarity, -1);
  assert.ok(Math.abs(res.best.delayMs - msFromMeters(0.8)) < 0.1, JSON.stringify(res.best));
  assert.ok(res.best.score < 0.01);
});

test('arrival time for delay speaker alignment', () => {
  const ir = delayed(biquadIr('hpf', 200, 0.707, 4000), 2400, 1, 10000);
  const t = arrivalTime(ir, SR, 500, 4000);
  assert.ok(Math.abs(t - 2400) < 30, `arrival ${t}`);
});

test('cardio theory: gradient and end-fire cancel at the rear', () => {
  const g = gradientResponse(60, 0.8);
  assert.ok(g.rearDb < -60);
  const e = endFireResponse(60, 4, 0.8);
  assert.ok(Math.abs(e.frontDb - 20 * Math.log10(4)) < 1e-6);
  assert.ok(e.rearDb < e.frontDb - 6);
});

test('auto EQ reduces error against target and limits boosts', () => {
  const freqs = logFreqs(20, 20000, 24);
  const bump = filtersDb([{ type: 'peak', freq: 250, gain: 7, q: 1.5 }, { type: 'peak', freq: 3000, gain: -2, q: 2 }, { type: 'peak', freq: 8000, gain: 5, q: 3 }], freqs);
  const measured = Float64Array.from(bump, (v) => v + 80);
  const target = new Float64Array(freqs.length);
  const res = autoEq(freqs, measured, target, { maxFilters: 6 });
  assert.ok(res.after < res.before / 3, `before ${res.before} after ${res.after}`);
  assert.ok(res.filters.some((f) => Math.abs(f.freq - 250) < 40 && f.gain < -5));
  assert.ok(res.filters.every((f) => f.gain <= 3));
  const geq = graphicEq(freqs, measured, target);
  assert.equal(geq.length, 31);
  assert.ok(geq.find((b) => b.freq === 250).gain <= -5);
});

test('room analysis measures reverberation time of synthetic decay', () => {
  const rt = 1.2;
  const len = Math.round(SR * 2.5);
  const rand = mulberry32(7);
  const ir = new Float64Array(len);
  const pre = 1000;
  const k = Math.log(1000) / rt; // amplitude: -60 dB at rt
  for (let i = 0; i < len - pre; i++) {
    const t = i / SR;
    ir[i + pre] = (rand() * 2 - 1) * Math.exp(-k * t) + (rand() * 2 - 1) * 1e-4;
  }
  ir[pre] = 3;
  const a = analyzeRoom(ir, SR);
  const mids = a.bands.filter((b) => b.freq >= 250 && b.freq <= 4000);
  for (const b of mids) {
    const v = bestRt(b);
    assert.ok(v && Math.abs(v - rt) < 0.15, `${b.freq} Hz → ${v}`);
  }
  const comp = reverbCompensation(a);
  assert.ok(comp.every((c) => Math.abs(c.db) < 1));
});

test('periodic pink noise has pink band levels', () => {
  const n = 1 << 16;
  const x = periodicNoise(n, SR, { color: 'pink' });
  const { re, im } = (() => { const r = new Float64Array(n); const i = new Float64Array(n); r.set(x); fft(r, i); return { re: r, im: i }; })();
  const band = (lo, hi) => {
    let s = 0;
    for (let k = Math.ceil((lo * n) / SR); k <= Math.floor((hi * n) / SR); k++) s += re[k] * re[k] + im[k] * im[k];
    return 10 * Math.log10(s);
  };
  // octave bands of pink noise have equal energy
  assert.ok(Math.abs(band(250, 500) - band(4000, 8000)) < 0.5);
});

test('helpers', () => {
  const f = logFreqs(20, 20000, 12);
  const db = Float64Array.from(f, (x) => Math.log2(x));
  assert.ok(Math.abs(interpDb(f, db, 1000) - Math.log2(1000)) < 0.01);
  assert.ok(Math.abs(bandLevel(f, new Float64Array(f.length).fill(-6), 100, 1000) + 6) < 1e-9);
});
