// Audio engine: one AudioContext and one microphone stream for the whole
// session, so the loop latency (output → speaker → mic → input) stays
// constant between measurements. That is what makes relative timing
// (main/sub, main/delay) measurable with a single phone.
import { logSweep, periodicNoise, sine, polarityPulse, dbToLin } from '../dsp/signals.js';
import { deconvolve, findPeak, estimateSnr } from '../dsp/analysis.js';

export class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.stream = null;
    this.running = false;
    this.outputChannel = 'both'; // 'left' | 'right' | 'both'
    this.player = null;
    this.jobId = 0;
    this.pending = new Map();
    this.trackSettings = null;
  }

  static supported() {
    return !!(window.AudioContext || window.webkitAudioContext) && !!navigator.mediaDevices?.getUserMedia;
  }

  async start(deviceId) {
    if (!window.isSecureContext) throw new Error('La page doit être servie en HTTPS (ou localhost) pour accéder au micro.');
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url));
      this.capture = new AudioWorkletNode(this.ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
      this.capture.port.onmessage = (e) => {
        const job = this.pending.get(e.data.id);
        if (job) { this.pending.delete(e.data.id); job.resolve(e.data); }
      };
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      this.capture.connect(mute).connect(this.ctx.destination);

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 16384;
      this.analyser.smoothingTimeConstant = 0;

      this.outGain = this.ctx.createGain();
      this.outGain.gain.value = 0;
      this.merger = this.ctx.createChannelMerger(2);
      this.merger.connect(this.ctx.destination);
      this.applyRouting();
    }
    await this.openMic(deviceId);
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.running = true;
    this.emit('state');
  }

  async openMic(deviceId) {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.micSource) this.micSource.disconnect();
    const constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = this.stream.getAudioTracks()[0];
    this.trackSettings = track.getSettings ? track.getSettings() : {};
    this.micSource = this.ctx.createMediaStreamSource(this.stream);
    this.micSource.connect(this.capture);
    this.micSource.connect(this.analyser);
  }

  async listInputs() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  get latencyInfo() {
    if (!this.ctx) return null;
    return { base: this.ctx.baseLatency || 0, output: this.ctx.outputLatency || 0 };
  }

  setOutputChannel(ch) {
    this.outputChannel = ch;
    if (this.ctx) this.applyRouting();
  }

  applyRouting() {
    this.outGain.disconnect();
    if (this.outputChannel !== 'right') this.outGain.connect(this.merger, 0, 0);
    if (this.outputChannel !== 'left') this.outGain.connect(this.merger, 0, 1);
  }

  // ---- Generator ----

  makeBuffer(data) {
    const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    buf.copyToChannel(data, 0);
    return buf;
  }

  /** Loop a signal. type: pink | white | sine | pulse. level in dBFS (peak-ish). */
  play(type, { levelDb = -20, freq = 1000 } = {}) {
    this.stopSignal(true);
    const sr = this.sampleRate;
    let data;
    if (type === 'pink' || type === 'white') data = periodicNoise(1 << 18, sr, { color: type, rms: 0.25 });
    else if (type === 'sine') data = sine(sr, freq, 1, 0.7);
    else if (type === 'pulse') data = polarityPulse(sr, 1, 2);
    else throw new Error(`Signal inconnu : ${type}`);
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeBuffer(data);
    src.loop = true;
    src.connect(this.outGain);
    const t = this.ctx.currentTime;
    this.outGain.gain.cancelScheduledValues(t);
    this.outGain.gain.setValueAtTime(0, t);
    this.outGain.gain.linearRampToValueAtTime(dbToLin(levelDb), t + 0.3);
    src.start(t);
    this.player = { src, type, levelDb, freq, data };
    this.emit('signal');
  }

  setLevel(levelDb) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.outGain.gain.cancelScheduledValues(t);
    this.outGain.gain.setTargetAtTime(dbToLin(levelDb), t, 0.05);
    if (this.player) this.player.levelDb = levelDb;
  }

  stopSignal(immediate = false) {
    if (!this.player) return;
    const { src } = this.player;
    const t = this.ctx.currentTime;
    this.outGain.gain.cancelScheduledValues(t);
    this.outGain.gain.setValueAtTime(this.outGain.gain.value, t);
    this.outGain.gain.linearRampToValueAtTime(0, t + (immediate ? 0.02 : 0.15));
    try { src.stop(t + (immediate ? 0.03 : 0.2)); } catch { /* already stopped */ }
    this.player = null;
    this.emit('signal');
  }

  // ---- Capture ----

  captureWindow(startFrame, length) {
    const id = ++this.jobId;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.capture.port.postMessage({ id, startFrame, length });
    });
  }

  /**
   * Play `repeats` log sweeps and deconvolve each capture.
   * Returns { irs: Float64Array[], sr, sweep, recordings }.
   * onProgress(i, total) is called before each sweep.
   */
  async measureSweep({ f1 = 20, f2 = 20000, seconds = 2, tail = 2, levelDb = -12, repeats = 1, onProgress } = {}) {
    if (!this.running) throw new Error('Démarrer l\'audio d\'abord');
    this.stopSignal(true);
    const sr = this.sampleRate;
    const sweep = logSweep(sr, f1, Math.min(f2, sr / 2 * 0.95), seconds, 1);
    const buffer = this.makeBuffer(sweep);
    const irs = [];
    const recordings = [];
    let clipped = false;
    for (let r = 0; r < repeats; r++) {
      if (onProgress) onProgress(r, repeats);
      const startTime = this.ctx.currentTime + 0.25;
      const startFrame = Math.round(startTime * sr);
      const length = Math.round((seconds + tail) * sr);
      const cap = this.captureWindow(startFrame, length);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const g = this.ctx.createGain();
      g.gain.value = dbToLin(levelDb);
      src.connect(g);
      // bypass outGain (which is used by the looping generator) but keep routing
      if (this.outputChannel !== 'right') g.connect(this.merger, 0, 0);
      if (this.outputChannel !== 'left') g.connect(this.merger, 0, 1);
      this.outGain.gain.setValueAtTime(0, this.ctx.currentTime);
      src.start(startTime);
      const res = await cap;
      g.disconnect();
      const rec = res.buffer;
      let peak = 0;
      for (let i = 0; i < rec.length; i++) peak = Math.max(peak, Math.abs(rec[i]));
      if (peak > 0.98) clipped = true;
      recordings.push(rec);
      irs.push(deconvolve(rec, sweep, sr, f1, f2));
    }
    return { irs, sr, sweep, recordings, clipped };
  }

  /** Input meter: {rmsDb, peakDb} of the current analyser frame. */
  inputLevel() {
    if (!this.analyser) return { rmsDb: -Infinity, peakDb: -Infinity };
    const buf = this.timeBuf || (this.timeBuf = new Float32Array(this.analyser.fftSize));
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      sum += buf[i] * buf[i];
      peak = Math.max(peak, Math.abs(buf[i]));
    }
    return { rmsDb: 10 * Math.log10(sum / buf.length + 1e-20), peakDb: 20 * Math.log10(peak + 1e-10) };
  }

  /** Power spectrum of the current analyser frame, dB per bin. */
  spectrum() {
    const buf = this.freqBuf || (this.freqBuf = new Float32Array(this.analyser.frequencyBinCount));
    this.analyser.getFloatFrequencyData(buf);
    return buf;
  }

  emit(type) {
    this.dispatchEvent(new Event(type));
  }
}

/** Post-process sweep captures into a single stored measurement. */
export function buildMeasurement({ irs, sr, clipped, sweep, recordings }, { name, keepSeconds = 2.5 }) {
  // average IRs coherently (same timing within a session)
  const n = irs[0].length;
  const avg = new Float64Array(n);
  for (const ir of irs) for (let i = 0; i < n; i++) avg[i] += ir[i] / irs.length;
  const causalEnd = Math.floor(n * 0.75); // last quarter holds distortion products
  const peak = findPeak(avg, 0, causalEnd);
  // peak jitter across repeats (should be ~0 if the loop latency is stable)
  const peaks = irs.map((ir) => findPeak(ir, 0, causalEnd).position);
  const jitterMs = ((Math.max(...peaks) - Math.min(...peaks)) / sr) * 1000;
  // valid causal region: recording length minus sweep length
  const validEnd = Math.max(peak.index + 1, recordings[0].length - sweep.length);
  const start = Math.max(0, peak.index - Math.round(0.5 * sr)); // room for delays up to ~0.5 s
  const end = Math.min(validEnd, peak.index + Math.round(keepSeconds * sr));
  const noiseFrom = Math.round(peak.index + 0.8 * (validEnd - peak.index));
  const ir = new Float32Array(avg.subarray(start, end));
  return {
    name,
    createdAt: Date.now(),
    sr,
    ir,
    irStart: start,
    peak: peak.position,
    polarity: peak.polarity,
    snr: estimateSnr(avg, peak.index, noiseFrom, validEnd),
    jitterMs,
    repeats: irs.length,
    clipped,
  };
}
