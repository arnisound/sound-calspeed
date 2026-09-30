// AudioWorklet that captures the microphone on sample-accurate windows of the
// AudioContext clock, so captures line up exactly with scheduled playback.
/* global currentFrame, sampleRate */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.jobs = [];
    this.port.onmessage = (e) => {
      const { id, startFrame, length } = e.data;
      this.jobs.push({ id, startFrame, length, buffer: new Float32Array(length), filled: 0 });
    };
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch || !this.jobs.length) return true;
    const blockStart = currentFrame;
    const blockLen = ch.length;
    for (let j = this.jobs.length - 1; j >= 0; j--) {
      const job = this.jobs[j];
      const from = Math.max(blockStart, job.startFrame);
      const to = Math.min(blockStart + blockLen, job.startFrame + job.length);
      for (let f = from; f < to; f++) job.buffer[f - job.startFrame] = ch[f - blockStart];
      if (to > from) job.filled += to - from;
      if (blockStart + blockLen >= job.startFrame + job.length) {
        this.port.postMessage({ id: job.id, buffer: job.buffer, missed: job.length - job.filled, sampleRate }, [job.buffer.buffer]);
        this.jobs.splice(j, 1);
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
