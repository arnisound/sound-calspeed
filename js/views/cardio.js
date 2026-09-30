import { h, card, field, numberInput, select, toast } from '../ui/dom.js';
import { Plot, PALETTE } from '../ui/plot.js';
import {
  endFire, gradient, endFireResponse, gradientResponse, scanAlignment, combine, describeDelay, speedOfSound,
} from '../dsp/align.js';
import { logFreqs, magnitudeDb, smoothComplex } from '../dsp/analysis.js';
import { responseOf, commonStart, PPO } from '../measure.js';
import { measurementPicker, measurePanel } from './measure.js';

const F = logFreqs(20, 250, PPO);

export default {
  id: 'cardio',
  title: 'Cardio',
  mount(root, app) {
    const { settings } = app;
    let type = 'gradient';
    let depth = 0.9;
    let rows = 2;
    let spacing = 1.0;
    const theoryOut = h('div');
    const theoryPlot = new Plot(h('div'), { xMin: 20, xMax: 250, yMin: -30, yMax: 12, height: 240 });

    function theory() {
      const T = settings.temperature;
      theoryOut.innerHTML = '';
      let front; let rear;
      if (type === 'gradient') {
        const g = gradient(depth, T);
        front = Array.from(F, (f) => gradientResponse(f, depth, T).frontDb);
        rear = Array.from(F, (f) => gradientResponse(f, depth, T, 0.97).rearDb);
        theoryOut.append(
          h('table',
            h('tr', h('th', 'Élément'), h('th', 'Délai'), h('th', 'Polarité')),
            h('tr', h('td', 'Sub(s) avant (face public)'), h('td', `${g.front.delayMs.toFixed(2)} ms`), h('td', 'normale')),
            h('tr', h('td', `Sub arrière (à ${depth} m acoustiques)`), h('td', `${g.rear.delayMs.toFixed(2)} ms`), h('td', 'INVERSÉE')),
          ),
          h('p.muted', 'Profondeur acoustique = distance entre les centres acoustiques (faces des haut-parleurs) le long de l\'axe avant/arrière. Pour un sub arrière tourné vers l\'arrière, c\'est environ la profondeur du caisson. Courbe « arrière » tracée avec 3 % d\'écart de niveau : en pratique la réjection réelle est de 15 à 25 dB.'),
          h('div.callout.warn', 'Le gradient creuse l\'avant aux fréquences où 2·profondeur = une longueur d\'onde (ici ≈ ' + Math.round(speedOfSound(T) / (2 * depth)) + ' Hz) et atténue l\'extrême grave : vérifier sur la courbe « avant ». Les presets cardio constructeurs compensent ces effets.'),
        );
      } else {
        const d = endFire(rows, spacing, T);
        front = Array.from(F, (f) => endFireResponse(f, rows, spacing, T).frontDb);
        rear = Array.from(F, (f) => endFireResponse(f, rows, spacing, T).rearDb);
        theoryOut.append(
          h('table',
            h('tr', h('th', 'Rangée (de l\'arrière vers l\'avant)'), h('th', 'Délai'), h('th', 'Polarité')),
            d.map((r) => h('tr', h('td', `${r.row} (${r.position})`), h('td', `${r.delayMs.toFixed(2)} ms`), h('td', 'normale'))),
          ),
          h('p.muted', 'End-fire : tous les subs face au public, la rangée arrière joue en premier. Efficace vers l\'avant, réjection arrière variable selon la fréquence. Espacement typique : ¼ de longueur d\'onde de la fréquence visée (≈ 1 m pour ~85 Hz).'),
        );
      }
      theoryPlot.set([
        { x: F, y: front, color: PALETTE[0], width: 2.2, label: 'Avant (dB / 1 élément)' },
        { x: F, y: rear, color: PALETTE[7], width: 2.2, label: 'Arrière (dB / 1 élément)' },
      ]);
    }

    const typeSel = select([['gradient', 'Gradient / stack cardio (sub arrière inversé)'], ['endfire', 'End-fire (rangées retardées)']], type, (v) => { type = v; renderParams(); theory(); });
    const params = h('div.row');
    function renderParams() {
      params.innerHTML = '';
      if (type === 'gradient') params.append(field('Profondeur acoustique (m)', numberInput(depth, { min: 0.1, max: 3, onChange: (v) => { depth = v; theory(); } })));
      else params.append(
        field('Nombre de rangées', numberInput(rows, { min: 2, max: 8, step: 1, onChange: (v) => { rows = Math.round(v); theory(); } })),
        field('Espacement (m)', numberInput(spacing, { min: 0.2, max: 4, onChange: (v) => { spacing = v; theory(); } })),
      );
    }

    // ---- measured optimisation ----
    let A = null; // front group measured behind
    let B = null; // rear element measured behind
    let fLo = 35;
    let fHi = 110;
    const measOut = h('div');

    function optimise() {
      measOut.innerHTML = '';
      if (!A || !B || A === B) { toast('Choisir les deux mesures faites derrière le dispositif.', 'warn'); return; }
      const st = commonStart(A, B);
      const HA = smoothComplex(responseOf(A, settings, { mode: 'long', ref: 'absolute', startAbs: st, freqs: F }), PPO, 12);
      const HB = smoothComplex(responseOf(B, settings, { mode: 'long', ref: 'absolute', startAbs: st, freqs: F }), PPO, 12);
      const res = scanAlignment(HA, HB, F, { fLo, fHi, maxMs: 10, stepMs: 0.02, mode: 'cancel' });
      const { delayMs, polarity, score } = res.best;
      const sum = combine(HA, HB, F, delayMs, polarity);
      const p = new Plot(h('div'), { xMin: 20, xMax: 250, height: 240 });
      p.set([
        { x: F, y: magnitudeDb(HA), color: PALETTE[0], label: 'Subs avant (mesurés derrière)' },
        { x: F, y: magnitudeDb(HB), color: PALETTE[1], label: 'Sub arrière (mesuré derrière)' },
        { x: F, y: magnitudeDb(sum), color: PALETTE[2], width: 2.4, label: 'Somme optimisée (derrière)' },
      ], [{ x: fLo }, { x: fHi }]);
      p.autoY(3, 40);
      // level balance hint
      let la = 0; let lb = 0; let n = 0;
      F.forEach((f, i) => { if (f >= fLo && f <= fHi) { la += magnitudeDb(HA)[i]; lb += magnitudeDb(HB)[i]; n++; } });
      const diffDb = (la - lb) / n;
      measOut.append(card('Résultat',
        h('div.result', describeDelay(delayMs, 'les subs avant', 'le sub arrière'), h('br'), `Polarité du sub arrière : ${polarity > 0 ? 'normale' : 'inversée'}`),
        h('div', `Réjection arrière estimée dans ${fLo}–${fHi} Hz : ${(-10 * Math.log10(score)).toFixed(1)} dB.`),
        Math.abs(diffDb) > 1.5 ? h('div.callout.warn', `Écart de niveau derrière : ${diffDb > 0 ? 'avant plus fort' : 'arrière plus fort'} de ${Math.abs(diffDb).toFixed(1)} dB. Ajuster le gain du sub arrière de ${diffDb > 0 ? '+' : '−'}${Math.abs(diffDb).toFixed(1)} dB pour une meilleure annulation.`) : h('div.callout.ok', 'Niveaux avant/arrière équilibrés derrière le dispositif.'),
        delayMs < 0 ? h('div.callout.warn', 'Le délai est à appliquer sur les subs avant : cela décale aussi leur alignement avec les têtes — refaire l\'alignement tête/sub ensuite.') : null,
        h('div.callout', 'Vérifier ensuite devant (dans le public) : le grave doit rester fort. Refaire l\'alignement tête/sub avec le dispositif cardio complet.'),
        p.wrap,
      ));
    }

    const pickers = h('div.row');
    function renderPickers() {
      pickers.innerHTML = '';
      pickers.append(
        h('div.grow', field('Subs avant (mesurés derrière)', measurementPicker(app, A?.id, (m) => { A = m; }))),
        h('div.grow', field('Sub arrière (mesuré derrière)', measurementPicker(app, B?.id, (m) => { B = m; }))),
      );
    }
    renderPickers();

    root.append(
      h('h2', 'Sub cardioïde'),
      card('Calcul théorique',
        h('div.row', h('div.grow', field('Disposition', typeSel))), params,
        theoryOut, theoryPlot.wrap,
      ),
      card('Optimisation à la mesure',
        h('ol',
          h('li', 'Placer le téléphone derrière le dispositif (côté scène), à 3–5 m, dans l\'axe.'),
          h('li', 'Mesurer les subs avant seuls (sub arrière coupé).'),
          h('li', 'Mesurer le sub arrière seul (avant coupés), sans délai ni inversion appliqués. Ne pas bouger le téléphone.'),
          h('li', 'Calculer : l\'app cherche le délai et la polarité du sub arrière qui annulent le mieux le son derrière.'),
        ),
        h('details', h('summary', 'Mesurer ici'), measurePanel(app, { defaultName: 'Cardio avant', defaultTag: 'sub' }), h('hr'), measurePanel(app, { defaultName: 'Cardio arrière', defaultTag: 'sub' })),
        pickers,
        h('div.row',
          field('Bande de (Hz)', numberInput(fLo, { onChange: (v) => { fLo = v; } })),
          field('à (Hz)', numberInput(fHi, { onChange: (v) => { fHi = v; } })),
          h('button.btn.primary', { on: { click: optimise } }, 'Optimiser'),
        ),
        measOut,
      ),
    );
    renderParams();
    theory();
    return app.on('measurements', renderPickers);
  },
};
