import { h, card, field, numberInput, toast, fmtMs } from '../ui/dom.js';
import { Plot, PALETTE } from '../ui/plot.js';
import {
  scanAlignment, combine, delayResponse, describeDelay, crossoverFrequency, msFromMeters, speedOfSound,
} from '../dsp/align.js';
import { magnitudeDb, phaseDeg, smoothComplex, arrivalTime, bandpass, envelope, logFreqs } from '../dsp/analysis.js';
import { responseOf, commonStart, PPO, tagLabel } from '../measure.js';
import { measurementPicker, measurePanel } from './measure.js';

const FREQS_LF = logFreqs(15, 2000, PPO);
const FREQS_ALL = logFreqs(20, 20000, PPO);

function latest(app, tag) {
  const list = app.measurements.filter((m) => m.ir && m.tag === tag);
  return list[list.length - 1] || null;
}

export default {
  id: 'alignement',
  title: 'Alignement',
  mount(root, app) {
    let mode = 'sub';
    const seg = h('div.seg');
    const body = h('div');

    function renderSeg() {
      seg.innerHTML = '';
      for (const [v, l] of [['sub', 'Tête / Sub'], ['delay', 'Rappel / Fill'], ['pol', 'Polarité']]) {
        seg.append(h(`button${mode === v ? '.on' : ''}`, { on: { click: () => { mode = v; renderSeg(); renderBody(); } } }, l));
      }
    }

    function renderBody() {
      body.innerHTML = '';
      if (mode === 'sub') subView(body, app);
      else if (mode === 'delay') delayView(body, app);
      else polarityView(body, app);
    }

    root.append(h('h2', 'Mise en phase et alignement'), h('div.row', seg), body);
    renderSeg();
    renderBody();
    return app.on('measurements', renderBody);
  },
};

// ---------------------------------------------------------------- Tête / Sub

function subView(root, app) {
  const { settings } = app;
  let A = latest(app, 'main');
  let B = latest(app, 'sub');
  let fLo = 50;
  let fHi = 160;
  let maxMs = 15;
  const out = h('div');

  const loIn = numberInput(fLo, { min: 15, max: 1000, onChange: (v) => { fLo = v; } });
  const hiIn = numberInput(fHi, { min: 20, max: 2000, onChange: (v) => { fHi = v; } });

  function autoBand() {
    if (!A || !B) return;
    const st = commonStart(A, B);
    const HA = responseOf(A, settings, { mode: 'long', ref: 'absolute', startAbs: st, freqs: FREQS_LF });
    const HB = responseOf(B, settings, { mode: 'long', ref: 'absolute', startAbs: st, freqs: FREQS_LF });
    const xo = crossoverFrequency(smoothComplex(HA, PPO, 3), smoothComplex(HB, PPO, 3), FREQS_LF, 30, 400);
    if (xo) {
      fLo = Math.round(xo / 1.8); fHi = Math.round(xo * 1.8);
      loIn.value = fLo; hiIn.value = fHi;
      return xo;
    }
    return null;
  }

  function compute() {
    out.innerHTML = '';
    if (!A || !B) { toast('Choisir une mesure de tête et une mesure de sub.', 'warn'); return; }
    if (A === B) { toast('Choisir deux mesures différentes.', 'warn'); return; }
    if (Math.abs(A.createdAt - B.createdAt) > 3 * 3600e3) {
      out.append(h('div.callout.warn', 'Les deux mesures ont plus de 3 h d\'écart : vérifier qu\'elles viennent de la même session audio (sinon la latence peut différer).'));
    }
    const st = commonStart(A, B);
    const HA = responseOf(A, settings, { mode: 'long', ref: 'absolute', startAbs: st, freqs: FREQS_LF });
    const HB = responseOf(B, settings, { mode: 'long', ref: 'absolute', startAbs: st, freqs: FREQS_LF });
    const sA = smoothComplex(HA, PPO, 12);
    const sB = smoothComplex(HB, PPO, 12);
    const xo = crossoverFrequency(smoothComplex(HA, PPO, 3), smoothComplex(HB, PPO, 3), FREQS_LF, 30, 400);
    const res = scanAlignment(sA, sB, FREQS_LF, { fLo, fHi, maxMs, stepMs: 0.02 });
    const { delayMs, polarity, score } = res.best;
    const before = scanAlignment(sA, sB, FREQS_LF, { fLo, fHi, maxMs: 0.001, stepMs: 0.001, polarities: [1] }).best.score;

    const sumRaw = combine(sA, sB, FREQS_LF, 0, 1);
    const sumFix = combine(sA, sB, FREQS_LF, delayMs, polarity);
    // for phase display, reference the time origin to the top's peak
    const tRef = ((A.peak - 0) / A.sr) * 1000;
    const ph = (H) => phaseDeg(delayResponse(H, FREQS_LF, -tRef));

    const magPlot = new Plot(h('div'), { xMin: 20, xMax: 2000, height: 260 });
    magPlot.set([
      { x: FREQS_LF, y: magnitudeDb(sA), color: PALETTE[0], label: `Tête : ${A.name}` },
      { x: FREQS_LF, y: magnitudeDb(sB), color: PALETTE[1], label: `Sub : ${B.name}` },
      { x: FREQS_LF, y: magnitudeDb(sumRaw), color: PALETTE[7], label: 'Somme actuelle', dash: [5, 4] },
      { x: FREQS_LF, y: magnitudeDb(sumFix), color: PALETTE[2], width: 2.4, label: 'Somme corrigée' },
    ], [{ x: fLo, label: '' }, { x: fHi, label: '' }, ...(xo ? [{ x: xo, label: `XO ≈ ${Math.round(xo)} Hz`, color: PALETTE[5] }] : [])]);
    magPlot.autoY(3, 30);

    const phPlot = new Plot(h('div'), { xMin: 20, xMax: 2000, yMin: -180, yMax: 180, yStep: 90, height: 200 });
    const Bfix = delayResponse(sB, FREQS_LF, delayMs, polarity);
    phPlot.set([
      { x: FREQS_LF, y: ph(sA), color: PALETTE[0], label: 'Phase tête', wrap: 270 },
      { x: FREQS_LF, y: ph(Bfix), color: PALETTE[1], label: 'Phase sub (corrigée)', wrap: 270 },
    ], [{ x: fLo }, { x: fHi }]);

    const scanPlot = new Plot(h('div'), { xLog: false, xMin: -maxMs, xMax: maxMs, yMin: 0, yMax: 100, height: 180, xFormat: (v) => `${v.toFixed(0)} ms`, yFormat: (v) => `${v}%` });
    scanPlot.set([
      { x: res.delays, y: Array.from(res.curves[1], (v) => v * 100), color: PALETTE[0], label: 'Polarité normale' },
      { x: res.delays, y: Array.from(res.curves[-1], (v) => v * 100), color: PALETTE[3], label: 'Polarité inversée' },
    ], [{ x: delayMs, label: 'optimum', color: PALETTE[2] }]);

    out.append(
      card('Résultat',
        h('div.result', describeDelay(delayMs, 'la tête', 'le sub'), h('br'), polarity > 0 ? 'Polarité du sub : normale' : 'Inverser la polarité du sub'),
        h('div', `Efficacité de sommation dans ${fLo}–${fHi} Hz : ${(before * 100).toFixed(0)} % actuellement → ${(score * 100).toFixed(0)} % après correction (100 % = addition parfaite).`),
        xo ? h('div.muted', `Fréquence de raccord estimée : ${Math.round(xo)} Hz.`) : null,
        res.alternatives.length ? h('details', h('summary', 'Autres solutions proches'),
          h('p.muted', 'Solutions séparées d\'environ une période au raccord. Préférer la plus petite valeur de délai, sauf si le design impose autre chose (ex. sub en arc).'),
          h('ul', res.alternatives.map((a) => h('li', `${describeDelay(a.delayMs, 'la tête', 'le sub')}, polarité ${a.polarity > 0 ? 'normale' : 'inversée'} — ${(a.score * 100).toFixed(0)} %`)))) : null,
        h('div.callout', 'Appliquer le délai (et la polarité) dans le processeur, puis mesurer tête + sub ensemble au même endroit pour vérifier : la somme doit ressembler à la courbe verte.'),
      ),
      card('Magnitudes et somme', magPlot.wrap),
      card('Phases (doivent se superposer au raccord)', phPlot.wrap),
      card('Efficacité selon le délai appliqué au sub', scanPlot.wrap),
    );
  }

  const pickA = measurementPicker(app, A?.id, (m) => { A = m; autoBand(); });
  const pickB = measurementPicker(app, B?.id, (m) => { B = m; autoBand(); });
  autoBand();

  root.append(
    card('1. Mesurer',
      h('ol',
        h('li', 'Placer le téléphone dans la zone d\'audience où tête et sub se recouvrent (souvent aux 2/3 de la salle, dans l\'axe entre tête et sub).'),
        h('li', 'Couper le sub, mesurer la tête seule (type « Tête »).'),
        h('li', 'Couper la tête, mesurer le sub seul (type « Sub »). Ne pas bouger le téléphone.'),
      ),
      h('details', h('summary', 'Mesurer ici'), measurePanel(app, { defaultName: 'Tête', defaultTag: 'main' }), h('hr'), measurePanel(app, { defaultName: 'Sub', defaultTag: 'sub' })),
    ),
    card('2. Calculer',
      h('div.row', h('div.grow', field('Tête', pickA)), h('div.grow', field('Sub', pickB))),
      h('div.row',
        field('Bande basse (Hz)', loIn), field('Bande haute (Hz)', hiIn),
        field('Délai max ± (ms)', numberInput(maxMs, { min: 1, max: 50, onChange: (v) => { maxMs = v; } })),
        h('button.btn', { on: { click: () => { const xo = autoBand(); toast(xo ? `Raccord estimé à ${Math.round(xo)} Hz` : 'Raccord non détecté, régler la bande à la main.', xo ? 'ok' : 'warn'); } } }, 'Bande auto'),
      ),
      h('button.btn.primary', { on: { click: compute } }, 'Calculer délai et polarité'),
    ),
    out,
  );
}

// ---------------------------------------------------------------- Rappel / fill

function delayView(root, app) {
  const { settings } = app;
  let A = latest(app, 'main');
  let B = latest(app, 'delay') || latest(app, 'fill');
  let haas = 5;
  let bandLo = 500;
  let bandHi = 4000;
  const out = h('div');

  function compute() {
    out.innerHTML = '';
    if (!A || !B || A === B) { toast('Choisir la mesure de façade et celle du rappel.', 'warn'); return; }
    const tA = ((arrivalTime(A.ir, A.sr, bandLo, bandHi) + A.irStart) / A.sr) * 1000;
    const tB = ((arrivalTime(B.ir, B.sr, bandLo, bandHi) + B.irStart) / B.sr) * 1000;
    const diff = tA - tB; // > 0 : rappel arrive avant la façade
    const delay = diff + haas;
    const env = (m) => {
      const e = envelope(bandpass(m.ir, m.sr, bandLo, bandHi));
      let max = 0;
      for (const v of e) max = Math.max(max, v);
      const x = []; const y = [];
      const t0 = Math.min(tA, tB) - 20;
      const t1 = Math.max(tA, tB) + 60;
      const a = Math.max(0, Math.floor((t0 / 1000) * m.sr - m.irStart));
      const b = Math.min(e.length, Math.ceil((t1 / 1000) * m.sr - m.irStart));
      const step = Math.max(1, Math.floor((b - a) / 2000));
      for (let i = a; i < b; i += step) { x.push(((i + m.irStart) / m.sr) * 1000); y.push(20 * Math.log10(e[i] / max + 1e-6)); }
      return { x, y, t0, t1 };
    };
    const eA = env(A);
    const eB = env(B);
    const p = new Plot(h('div'), { xLog: false, xMin: eA.t0, xMax: eA.t1, yMin: -40, yMax: 3, height: 220, xFormat: (v) => `${v.toFixed(0)} ms` });
    p.set([
      { x: eA.x, y: eA.y, color: PALETTE[0], label: `Façade : ${A.name}` },
      { x: eB.x, y: eB.y, color: PALETTE[1], label: `Rappel : ${B.name}` },
    ], [{ x: tA, color: PALETTE[0], label: 'façade' }, { x: tB, color: PALETTE[1], label: 'rappel' }]);

    // complementary phase-based check in the overlap band
    const st = commonStart(A, B, 30);
    let scanTxt = null;
    if (Math.abs(diff) < 400) {
      // both arrivals must sit in the flat first half of the window
      const windowMs = 2 * (Math.abs(diff) + 30) + settings.fixedWindowMs;
      const HA = smoothComplex(responseOf(A, settings, { ref: 'absolute', startAbs: st, freqs: FREQS_ALL, windowMs }), PPO, 6);
      const HB = smoothComplex(responseOf(B, settings, { ref: 'absolute', startAbs: st, freqs: FREQS_ALL, windowMs }), PPO, 6);
      const res = scanAlignment(HA, HB, FREQS_ALL, { fLo: bandLo, fHi: bandHi, maxMs: Math.min(300, Math.abs(diff) + 20), stepMs: 0.02, polarities: [1] });
      scanTxt = `Contrôle par la phase (${bandLo}–${bandHi} Hz) : délai optimal ${fmtMs(res.best.delayMs)} (efficacité ${(res.best.score * 100).toFixed(0)} %).`;
    }

    out.append(card('Résultat',
      diff < -0.5
        ? h('div.callout.bad', `Le rappel arrive déjà ${fmtMs(-diff)} APRÈS la façade à cette position : ne pas le retarder. Vérifier le placement, ou retarder la façade si c'est volontaire (ex. front-fill vs. façade).`)
        : h('div.result', `Retarder le rappel de ${delay.toFixed(2)} ms`, h('br'), h('small', `écart d'arrivée ${fmtMs(diff)} + décalage de précédence ${haas} ms`)),
      h('div.muted', `≈ ${(diff / 1000 * speedOfSound(settings.temperature)).toFixed(2)} m de différence de trajet à ${settings.temperature} °C.`),
      scanTxt ? h('div.muted', scanTxt) : null,
      h('div.callout', 'Après réglage, mesurer façade + rappel ensemble : l\'impulsion du rappel doit arriver juste après celle de la façade, sans pré-écho.'),
      p.wrap,
    ));
  }

  // distance calculator
  let dMain = 40;
  let dDelay = 8;
  const calcOut = h('div.result');
  const calc = () => {
    const ms = msFromMeters(dMain - dDelay, settings.temperature);
    calcOut.textContent = `${ms.toFixed(2)} ms (+ ${haas} ms = ${(ms + haas).toFixed(2)} ms)`;
  };

  root.append(
    card('1. Mesurer',
      h('ol',
        h('li', 'Placer le téléphone dans la zone couverte par le rappel (ou le fill), là où façade et rappel ont un niveau proche.'),
        h('li', 'Mesurer la façade seule (type « Tête / façade »), rappel coupé.'),
        h('li', 'Mesurer le rappel seul (type « Rappel ») sans délai appliqué, façade coupée. Même position.'),
      ),
      h('details', h('summary', 'Mesurer ici'), measurePanel(app, { defaultName: 'Façade', defaultTag: 'main', tail: Math.max(settings.sweepTail, 1.5) }), h('hr'), measurePanel(app, { defaultName: 'Rappel', defaultTag: 'delay' })),
    ),
    card('2. Calculer',
      h('div.row', h('div.grow', field('Façade', measurementPicker(app, A?.id, (m) => { A = m; }))), h('div.grow', field('Rappel / fill', measurementPicker(app, B?.id, (m) => { B = m; })))),
      h('div.row',
        field('Bande (Hz) de', numberInput(bandLo, { onChange: (v) => { bandLo = v; } })),
        field('à', numberInput(bandHi, { onChange: (v) => { bandHi = v; } })),
        field('Précédence (ms)', numberInput(haas, { min: 0, max: 30, onChange: (v) => { haas = v; calc(); } }), 'Décalage volontaire pour garder la localisation sur la façade (typ. 0–10 ms).'),
      ),
      h('button.btn.primary', { on: { click: compute } }, 'Calculer le délai'),
    ),
    out,
    card('Calculateur par distances',
      h('div.row',
        field('Façade → auditeur (m)', numberInput(dMain, { onChange: (v) => { dMain = v; calc(); } })),
        field('Rappel → auditeur (m)', numberInput(dDelay, { onChange: (v) => { dDelay = v; calc(); } })),
      ),
      calcOut,
      h('p.muted', `Vitesse du son ${speedOfSound(settings.temperature).toFixed(1)} m/s à ${settings.temperature} °C (modifiable dans Réglages).`),
    ),
  );
  calc();
}

// ---------------------------------------------------------------- Polarité

function polarityView(root, app) {
  const withIr = app.measurements.filter((m) => m.ir);
  let ref = withIr[0] || null;
  let band = 'hf';
  const table = h('div.table-wrap');

  const bands = { hf: [500, 4000, 'Médium/aigu 500 Hz–4 kHz'], lf: [40, 120, 'Grave 40–120 Hz'], full: [0, 0, 'Large bande'] };

  function sign(m) {
    const [lo, hi] = bands[band];
    const x = lo || hi ? bandpass(m.ir, m.sr, lo, hi) : m.ir;
    let idx = 0;
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[idx])) idx = i;
    return x[idx] >= 0 ? 1 : -1;
  }

  function render() {
    table.innerHTML = '';
    if (!ref) { table.append(h('p.muted', 'Aucune mesure.')); return; }
    const sRef = sign(ref);
    table.append(h('table',
      h('tr', h('th', 'Mesure'), h('th', 'Type'), h('th', 'Pic'), h('th', 'Par rapport à la référence')),
      withIr.map((m) => {
        const s = sign(m);
        const same = s === sRef;
        return h('tr',
          h('td', m.name, m === ref ? ' ★' : ''), h('td', tagLabel(m.tag)), h('td', s > 0 ? '+' : '−'),
          h('td', h(`span.pill.${same ? 'on' : 'bad'}`, same ? 'identique' : 'INVERSÉE')));
      })));
  }

  root.append(
    card('Contrôle de polarité',
      h('p', 'Mesurer chaque enceinte (ou chaque voie) séparément, puis comparer à une enceinte de référence connue pour être correcte. La chaîne téléphone → console peut elle-même inverser la polarité absolue : seule la comparaison entre enceintes a du sens.'),
      h('p.muted', 'Comparer des enceintes de même type, dans la bande où elles travaillent. Pour une écoute rapide : générateur « Impulsions » (onglet Audio).'),
      h('div.row',
        h('div.grow', field('Référence', measurementPicker(app, ref?.id, (m) => { ref = m; render(); }, { placeholder: '— référence —' }))),
        field('Bande', (() => {
          const s = h('select', { on: { change: () => { band = s.value; render(); } } }, Object.entries(bands).map(([k, v]) => h('option', { value: k, selected: k === band }, v[2])));
          return s;
        })()),
      ),
      table,
    ),
  );
  render();
}
