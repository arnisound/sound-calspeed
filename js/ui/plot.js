// Lightweight canvas plotter: log or linear X, multiple traces, grid, legend.

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export const PALETTE = ['#2f81f7', '#f0883e', '#3fb950', '#db61a2', '#a371f7', '#e3b341', '#39c5cf', '#f85149'];

export class Plot {
  constructor(container, opts = {}) {
    this.opts = {
      xLog: true, xMin: 20, xMax: 20000, yMin: -30, yMax: 10,
      xLabel: '', yLabel: 'dB', yStep: null, height: 260, legend: true,
      xFormat: null, yFormat: null,
      ...opts,
    };
    this.traces = [];
    this.markers = [];
    this.wrap = document.createElement('div');
    this.wrap.className = 'plot';
    this.canvas = document.createElement('canvas');
    this.canvas.style.height = `${this.opts.height}px`;
    this.wrap.appendChild(this.canvas);
    this.legendEl = document.createElement('div');
    this.legendEl.className = 'plot-legend';
    if (this.opts.legend) this.wrap.appendChild(this.legendEl);
    container.appendChild(this.wrap);
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.canvas);
    this.canvas.addEventListener('pointermove', (e) => this.hover(e));
    this.canvas.addEventListener('pointerleave', () => { this.cursor = null; this.draw(); });
    this.canvas.addEventListener('pointerdown', (e) => this.hover(e));
  }

  set(traces, markers = []) {
    this.traces = traces.filter(Boolean);
    this.markers = markers;
    this.draw();
    this.renderLegend();
  }

  setRange(r) {
    Object.assign(this.opts, r);
    this.draw();
  }

  autoY(pad = 3, minSpan = 20) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of this.traces) {
      for (let i = 0; i < t.x.length; i++) {
        if (t.x[i] < this.opts.xMin || t.x[i] > this.opts.xMax) continue;
        const v = t.y[i];
        if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    }
    if (!Number.isFinite(lo)) return;
    hi = Math.ceil((hi + pad) / 5) * 5;
    lo = Math.floor((lo - pad) / 5) * 5;
    if (hi - lo < minSpan) lo = hi - minSpan;
    this.opts.yMin = lo;
    this.opts.yMax = hi;
    this.draw();
  }

  xToPx(x, w) {
    const { xLog, xMin, xMax } = this.opts;
    return xLog ? (Math.log(x / xMin) / Math.log(xMax / xMin)) * w : ((x - xMin) / (xMax - xMin)) * w;
  }

  pxToX(px, w) {
    const { xLog, xMin, xMax } = this.opts;
    return xLog ? xMin * Math.pow(xMax / xMin, px / w) : xMin + (px / w) * (xMax - xMin);
  }

  yToPx(y, h) {
    const { yMin, yMax } = this.opts;
    return h - ((y - yMin) / (yMax - yMin)) * h;
  }

  hover(e) {
    const r = this.canvas.getBoundingClientRect();
    this.cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
    this.draw();
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const L = 38; const R = 8; const T = 8; const B = 20;
    const w = W - L - R;
    const h = H - T - B;
    const grid = css('--grid', '#30363d');
    const text = css('--muted', '#8b949e');
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = text;
    g.strokeStyle = grid;
    g.lineWidth = 1;

    const { xLog, xMin, xMax, yMin, yMax } = this.opts;
    // X grid
    const xt = xLog ? logTicks(xMin, xMax) : linTicks(xMin, xMax, Math.max(2, Math.floor(w / 60)));
    g.textAlign = 'center';
    for (const t of xt) {
      const px = L + this.xToPx(t.v, w);
      g.globalAlpha = t.major ? 1 : 0.45;
      g.beginPath(); g.moveTo(px + 0.5, T); g.lineTo(px + 0.5, T + h); g.stroke();
      g.globalAlpha = 1;
      if (t.label) g.fillText(this.opts.xFormat ? this.opts.xFormat(t.v) : t.label, px, H - 6);
    }
    // Y grid
    const yStep = this.opts.yStep || niceStep((yMax - yMin) / Math.max(2, Math.floor(h / 28)));
    g.textAlign = 'right';
    for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) {
      const py = T + this.yToPx(v, h);
      g.beginPath(); g.moveTo(L, py + 0.5); g.lineTo(L + w, py + 0.5); g.stroke();
      g.fillText(this.opts.yFormat ? this.opts.yFormat(v) : fmtNum(v), L - 4, py + 3);
    }

    g.save();
    g.beginPath(); g.rect(L, T, w, h); g.clip();
    for (const m of this.markers) {
      const px = L + this.xToPx(m.x, w);
      g.strokeStyle = m.color || text;
      g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(px, T); g.lineTo(px, T + h); g.stroke();
      g.setLineDash([]);
      if (m.label) { g.fillStyle = m.color || text; g.textAlign = 'left'; g.fillText(m.label, px + 3, T + 10); }
    }
    for (const t of this.traces) {
      g.strokeStyle = t.color;
      g.lineWidth = t.width || 1.6;
      g.globalAlpha = t.alpha ?? 1;
      g.setLineDash(t.dash || []);
      g.beginPath();
      let pen = false;
      let prevY = null;
      for (let i = 0; i < t.x.length; i++) {
        const xv = t.x[i];
        const yv = t.y[i];
        if (!Number.isFinite(yv) || xv < xMin * 0.9 || xv > xMax * 1.1) { pen = false; continue; }
        const px = L + this.xToPx(xv, w);
        const py = T + this.yToPx(yv, h);
        // break wrapped phase lines
        if (t.wrap && prevY !== null && Math.abs(yv - prevY) > t.wrap) pen = false;
        if (pen) g.lineTo(px, py); else g.moveTo(px, py);
        pen = true;
        prevY = yv;
      }
      g.stroke();
      if (t.fill) {
        g.globalAlpha = 0.15;
        g.lineTo(L + w, T + h); g.lineTo(L, T + h); g.closePath(); g.fillStyle = t.color; g.fill();
      }
      g.globalAlpha = 1;
      g.setLineDash([]);
    }
    g.restore();

    if (this.cursor && this.cursor.x > L && this.cursor.x < L + w) {
      const xv = this.pxToX(this.cursor.x - L, w);
      g.strokeStyle = text;
      g.beginPath(); g.moveTo(this.cursor.x + 0.5, T); g.lineTo(this.cursor.x + 0.5, T + h); g.stroke();
      const lines = [this.opts.xFormat ? this.opts.xFormat(xv) : fmtX(xv, xLog)];
      for (const t of this.traces) {
        if (!t.label) continue;
        const v = sampleAt(t, xv);
        if (Number.isFinite(v)) lines.push({ color: t.color, text: `${t.label}: ${v.toFixed(1)}` });
      }
      g.textAlign = 'left';
      const bx = this.cursor.x + 8 > W - 130 ? this.cursor.x - 138 : this.cursor.x + 8;
      g.fillStyle = css('--panel', '#161b22');
      g.globalAlpha = 0.9;
      g.fillRect(bx, T + 4, 130, 14 * lines.length + 6);
      g.globalAlpha = 1;
      lines.forEach((l, i) => {
        g.fillStyle = typeof l === 'string' ? css('--text', '#e6edf3') : l.color;
        g.fillText(typeof l === 'string' ? l : l.text, bx + 6, T + 16 + 14 * i);
      });
    }
  }

  renderLegend() {
    this.legendEl.innerHTML = '';
    for (const t of this.traces) {
      if (!t.label) continue;
      const s = document.createElement('span');
      s.innerHTML = `<i style="background:${t.color}"></i>`;
      s.appendChild(document.createTextNode(t.label));
      this.legendEl.appendChild(s);
    }
  }
}

function sampleAt(t, xv) {
  let best = -1;
  let bestD = Infinity;
  // traces are sorted by x; binary search
  let lo = 0; let hi = t.x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t.x[mid] <= xv) lo = mid; else hi = mid;
  }
  for (const i of [lo, hi]) {
    const d = Math.abs(t.x[i] - xv);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best >= 0 ? t.y[best] : NaN;
}

function logTicks(min, max) {
  const out = [];
  for (let dec = Math.pow(10, Math.floor(Math.log10(min))); dec <= max; dec *= 10) {
    for (let m = 1; m < 10; m++) {
      const v = m * dec;
      if (v < min || v > max) continue;
      const major = m === 1;
      const label = major || m === 2 || m === 5 ? fmtX(v, true) : '';
      out.push({ v, major, label });
    }
  }
  return out;
}

function linTicks(min, max, count) {
  const step = niceStep((max - min) / count);
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push({ v, major: true, label: fmtNum(v) });
  return out;
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

function fmtNum(v) {
  const r = Math.round(v * 100) / 100;
  return Math.abs(r) >= 1000 ? `${r / 1000}k` : `${r}`;
}

export function fmtX(v, log) {
  if (!log) return fmtNum(v);
  return v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v)}`;
}
