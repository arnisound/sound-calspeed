import { h, card, field, select } from '../ui/dom.js';
import { Plot, PALETTE } from '../ui/plot.js';
import { interpDb } from '../dsp/analysis.js';
import { targetCurve } from '../data/targets.js';

/** Fractional-octave band centres between 20 Hz and 20 kHz. */
function bandCentres(fraction) {
  const out = [];
  for (let k = Math.ceil(fraction * Math.log2(20 / 1000)); ; k++) {
    const f = 1000 * Math.pow(2, k / fraction);
    if (f > 20000) break;
    out.push(f);
  }
  return out;
}

export default {
  id: 'rta',
  title: 'RTA',
  mount(root, app) {
    const { engine, settings } = app;
    let fraction = 6;
    let tau = 1; // averaging time constant (s); 0 = none, Infinity = cumulative
    let centres = bandCentres(fraction);
    let avg = null;
    let peak = null;
    let frames = 0;
    let frozen = [];
    let showTarget = true;
    let raf = 0;
    let last = performance.now();

    const plot = new Plot(h('div'), { yMin: -60, yMax: 0, height: 300 });
    const domFreq = h('div.big-num', '—');

    function reset() {
      avg = null; peak = null; frames = 0;
    }

    function bandsFromSpectrum(spec, sr, fftSize) {
      const binHz = sr / fftSize;
      const lin = new Float64Array(spec.length);
      for (let i = 0; i < spec.length; i++) lin[i] = Math.pow(10, spec[i] / 10);
      return centres.map((fc) => {
        const lo = fc / Math.pow(2, 1 / (2 * fraction));
        const hi = fc * Math.pow(2, 1 / (2 * fraction));
        const a = Math.ceil(lo / binHz);
        const b = Math.floor(hi / binHz);
        let p = 0;
        if (b >= a) for (let k = a; k <= b; k++) p += lin[k];
        else p = lin[Math.round(fc / binHz)] * ((hi - lo) / binHz); // band narrower than a bin
        return p;
      });
    }

    function tick(now) {
      raf = requestAnimationFrame(tick);
      if (!engine.running) return;
      const dt = Math.min(0.2, (now - last) / 1000);
      last = now;
      const spec = engine.spectrum();
      const p = bandsFromSpectrum(spec, engine.sampleRate, engine.analyser.fftSize);
      frames++;
      if (!avg) avg = p.slice();
      else {
        const a = tau === Infinity ? 1 / frames : tau === 0 ? 1 : 1 - Math.exp(-dt / tau);
        for (let i = 0; i < p.length; i++) avg[i] += a * (p[i] - avg[i]);
      }
      const cal = settings.micCal?.points;
      const calF = cal?.map((x) => x[0]);
      const calD = cal?.map((x) => x[1]);
      const db = avg.map((v, i) => 10 * Math.log10(v + 1e-20) - (cal ? interpDb(calF, calD, centres[i]) : 0));
      if (!peak) peak = db.slice();
      else for (let i = 0; i < db.length; i++) peak[i] = Math.max(peak[i], db[i]);

      // dominant frequency (feedback / resonance hunting)
      let kMax = 1;
      for (let k = 2; k < spec.length - 1; k++) if (spec[k] > spec[kMax]) kMax = k;
      const y0 = spec[kMax - 1]; const y1 = spec[kMax]; const y2 = spec[kMax + 1];
      const d = y0 - 2 * y1 + y2;
      const fk = (kMax + (d ? (0.5 * (y0 - y2)) / d : 0)) * (engine.sampleRate / engine.analyser.fftSize);
      domFreq.textContent = `${fk < 1000 ? fk.toFixed(0) : (fk / 1000).toFixed(2) + 'k'} Hz`;

      const traces = [
        { x: centres, y: db, color: PALETTE[0], width: 2, label: 'Mesure', fill: true },
        { x: centres, y: peak, color: PALETTE[3], width: 1, alpha: 0.6, label: 'Crête' },
      ];
      frozen.forEach((f, i) => traces.push({ x: f.x, y: f.y, color: PALETTE[(i + 2) % PALETTE.length], width: 1.4, label: f.label }));
      if (showTarget) {
        const t = app.currentTarget();
        const tc = targetCurve(t, centres);
        // align target to the measured mean level in 200 Hz – 4 kHz
        let s = 0; let n = 0;
        centres.forEach((f, i) => { if (f >= 200 && f <= 4000) { s += db[i] - tc[i]; n++; } });
        const off = n ? s / n : 0;
        traces.push({ x: centres, y: Array.from(tc, (v) => v + off), color: PALETTE[2], width: 1.5, dash: [6, 4], label: `Cible : ${t.name}` });
      }
      plot.set(traces);
      if (frames % 30 === 1) {
        const hi = Math.max(...db.filter(Number.isFinite));
        if (hi > plot.opts.yMax - 2 || hi < plot.opts.yMax - 25) plot.setRange({ yMax: Math.ceil((hi + 6) / 10) * 10, yMin: Math.ceil((hi + 6) / 10) * 10 - 60 });
      }
    }

    const fracSel = select([[3, '1/3 oct'], [6, '1/6 oct'], [12, '1/12 oct'], [24, '1/24 oct']], fraction, (v) => { fraction = +v; centres = bandCentres(fraction); reset(); frozen = []; });
    const avgSel = select([[0, 'Aucune'], [0.3, 'Rapide (0,3 s)'], [1, 'Lente (1 s)'], [3, 'Très lente (3 s)'], ['inf', 'Infinie']], 1, (v) => { tau = v === 'inf' ? Infinity : +v; reset(); });
    const targetSel = select([['none', '— aucune —'], ...app.targets().map((t) => [t.id, t.name])], showTarget ? settings.targetId : 'none', (v) => {
      showTarget = v !== 'none';
      if (showTarget) app.updateSettings({ targetId: v });
    });

    root.append(
      h('h2', 'Analyseur temps réel'),
      card(null,
        h('div.row',
          h('button.btn.primary', { on: { click: async () => { if (await app.ensureAudio()) { engine.setOutputChannel(settings.outputChannel); engine.play('pink', { levelDb: settings.generatorLevel }); reset(); } } } }, '▶ Bruit rose'),
          h('button.btn', { on: { click: () => engine.stopSignal() } }, 'Stop'),
          h('button.btn', { on: { click: reset } }, 'Réinitialiser'),
          h('button.btn', { on: { click: () => { if (avg) frozen.push({ x: centres.slice(), y: avg.map((v) => 10 * Math.log10(v + 1e-20)), label: `Figé ${frozen.length + 1}` }); } } }, 'Figer la courbe'),
          h('button.btn', { on: { click: () => { frozen = []; } } }, 'Effacer figées'),
        ),
        h('div.row', field('Résolution', fracSel), field('Moyenne', avgSel), field('Cible', targetSel)),
        plot.wrap,
        h('div.row', h('div', h('div.muted', 'Fréquence dominante'), domFreq)),
        h('p.muted', 'Avec du bruit rose, un système plat donne une courbe plate en bandes d\'octave. Fréquence dominante : utile pour repérer un larsen ou une résonance (sans signal de test).'),
      ),
    );
    if (!engine.running) root.append(h('div.callout.warn', 'Démarrer l\'audio (bouton en haut) pour afficher l\'analyse.'));
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  },
};
