import { h, card, field, select, numberInput, toast, readFile, download } from '../ui/dom.js';
import { Plot, PALETTE } from '../ui/plot.js';
import { autoEq, graphicEq, filtersDb, graphicEqDb, alignLevel } from '../dsp/eq.js';
import { targetCurve } from '../data/targets.js';
import { parseCurveText } from '../store.js';
import { FREQS, magnitudeOf, tagLabel } from '../measure.js';

export default {
  id: 'eq',
  title: 'EQ',
  mount(root, app) {
    const { settings } = app;
    const candidates = () => app.measurements.filter((m) => m.ir || m.curve);
    let source = [...candidates()].reverse().find((m) => m.curve) || candidates().at(-1) || null;
    const opts = { fLo: 40, fHi: 16000, maxFilters: 8, maxBoost: 3, maxCut: 12, smoothing: 6, sr: 48000 };
    let result = null;
    let geq = null;
    let eqMode = 'peq';

    const plot = new Plot(h('div'), { height: 300 });
    const out = h('div');
    const targetDesc = h('p.muted');
    const targetBox = h('div');
    const sourceBox = h('div');

    function currentCurves() {
      if (!source) return null;
      const meas = magnitudeOf(source, settings, opts.smoothing);
      const target = targetCurve(app.currentTarget(), FREQS);
      return { meas, target };
    }

    function draw() {
      const c = currentCurves();
      if (!c) { plot.set([]); return; }
      const off = alignLevel(FREQS, c.meas, c.target, 200, 4000);
      const traces = [
        { x: FREQS, y: Array.from(c.meas, (v) => v - off), color: PALETTE[0], label: `Mesure : ${source.name}` },
        { x: FREQS, y: c.target, color: PALETTE[2], dash: [6, 4], width: 2, label: `Cible : ${app.currentTarget().name}` },
      ];
      let eqDb = null;
      if (eqMode === 'peq' && result) eqDb = filtersDb(result.filters, FREQS, opts.sr);
      if (eqMode === 'geq' && geq) eqDb = graphicEqDb(geq, FREQS, opts.sr);
      if (eqDb) {
        traces.push({ x: FREQS, y: eqDb, color: PALETTE[1], label: 'Correction EQ' });
        traces.push({ x: FREQS, y: Array.from(c.meas, (v, i) => v - off + eqDb[i]), color: PALETTE[4], width: 2.2, label: 'Résultat prévu' });
      }
      plot.set(traces, [{ x: opts.fLo }, { x: opts.fHi }]);
      plot.autoY(3, 30);
    }

    function compute() {
      const c = currentCurves();
      if (!c) { toast('Choisir une mesure (idéalement une moyenne spatiale).', 'warn'); return; }
      result = autoEq(FREQS, c.meas, c.target, { ...opts, maxFilters: opts.maxFilters });
      geq = graphicEq(FREQS, c.meas, c.target, { fLo: opts.fLo, fHi: opts.fHi, maxBoost: opts.maxBoost, maxCut: opts.maxCut });
      renderResult();
      draw();
    }

    function peqText() {
      return result.filters.map((f, i) => `PEQ ${i + 1}\t${f.freq} Hz\t${f.gain > 0 ? '+' : ''}${f.gain} dB\tQ ${f.q}\t(BW ${qToBw(f.q).toFixed(2)} oct)`).join('\n');
    }

    function renderResult() {
      out.innerHTML = '';
      if (!result) return;
      const seg = h('div.seg',
        h(`button${eqMode === 'peq' ? '.on' : ''}`, { on: { click: () => { eqMode = 'peq'; renderResult(); draw(); } } }, 'Paramétrique'),
        h(`button${eqMode === 'geq' ? '.on' : ''}`, { on: { click: () => { eqMode = 'geq'; renderResult(); draw(); } } }, 'Graphique 31 bandes'),
      );
      const peqTable = h('div.table-wrap', h('table',
        h('tr', h('th', '#'), h('th.num', 'Fréquence'), h('th.num', 'Gain'), h('th.num', 'Q'), h('th.num', 'Largeur')),
        result.filters.map((f, i) => h('tr', h('td', i + 1), h('td.num', `${f.freq} Hz`), h('td.num', `${f.gain > 0 ? '+' : ''}${f.gain} dB`), h('td.num', f.q.toFixed(2)), h('td.num', `${qToBw(f.q).toFixed(2)} oct`))),
      ));
      const geqTable = h('div.table-wrap', h('table',
        h('tr', geq.map((b) => h('th.num', fmtF(b.freq)))),
        h('tr', geq.map((b) => h('td.num', { style: { color: b.gain < 0 ? 'var(--accent-2)' : b.gain > 0 ? 'var(--ok)' : '' } }, b.gain ? `${b.gain > 0 ? '+' : ''}${b.gain}` : '0'))),
      ));
      out.append(card('Correction proposée',
        h('div.row', seg,
          h('button.btn.small', { on: { click: () => { navigator.clipboard?.writeText(eqMode === 'peq' ? peqText() : geq.map((b) => `${fmtF(b.freq)}\t${b.gain}`).join('\n')); toast('Copié', 'ok'); } } }, 'Copier'),
          h('button.btn.small', { on: { click: () => download('eq.txt', eqMode === 'peq' ? peqText() : geq.map((b) => `${b.freq}\t${b.gain}`).join('\n')) } }, 'Exporter'),
        ),
        h('p', `Écart RMS à la cible (${opts.fLo}–${opts.fHi} Hz) : ${result.before.toFixed(1)} dB → ${result.after.toFixed(1)} dB avec ${result.filters.length} filtre(s).`),
        eqMode === 'peq' ? peqTable : geqTable,
        h('p.muted', 'Filtres en cloche (peak) standard « RBJ » : Q identique sur la plupart des consoles et processeurs ; certains appareils affichent une largeur en octaves (colonne Largeur). Les gains positifs sont limités volontairement : les creux étroits sont des annulations acoustiques que l\'EQ ne corrige pas.'),
      ));
    }

    function renderTarget() {
      targetBox.innerHTML = '';
      const t = app.currentTarget();
      targetDesc.textContent = t.desc || '';
      const sel = select(app.targets().map((x) => [x.id, x.name]), t.id, (v) => { app.updateSettings({ targetId: v }); renderTarget(); result = null; renderResult(); draw(); });
      const custom = h('textarea', { value: (settings.customTarget || []).map((p) => `${p[0]} ${p[1]}`).join('\n') });
      targetBox.append(
        field('Courbe cible', sel), targetDesc,
        h('div.btn-group',
          h('button.btn.small', { on: { click: importTarget } }, 'Importer une courbe (.txt / .csv)'),
          t.imported ? h('button.btn.small.danger', { on: { click: () => { app.updateSettings({ importedTargets: settings.importedTargets.filter((x) => x.id !== t.id), targetId: 'flat' }); renderTarget(); draw(); } } }, 'Supprimer cette courbe') : null,
        ),
        t.id === 'custom' ? h('div',
          field('Points « fréquence dB » (un par ligne)', custom),
          h('button.btn.small', { on: { click: () => { const pts = parseCurveText(custom.value); if (pts.length < 2) { toast('Au moins 2 points.', 'warn'); return; } app.updateSettings({ customTarget: pts }); renderTarget(); draw(); } } }, 'Appliquer'),
        ) : null,
      );
    }

    async function importTarget() {
      const f = await readFile('.txt,.csv,.frd,.cal');
      if (!f) return;
      const pts = parseCurveText(f.text);
      if (pts.length < 2) { toast('Fichier non reconnu : attendu des lignes « fréquence dB ».', 'error'); return; }
      const id = `imp-${Date.now()}`;
      app.updateSettings({ importedTargets: [...settings.importedTargets, { id, name: f.name.replace(/\.[^.]+$/, ''), points: pts, desc: `Importée de ${f.name} (${pts.length} points).` }], targetId: id });
      toast('Courbe importée.', 'ok');
      renderTarget();
      draw();
    }

    function renderSource() {
      sourceBox.innerHTML = '';
      const list = candidates();
      sourceBox.append(field('Mesure à égaliser', select([['', '— choisir —'], ...list.map((m) => [m.id, `${m.name} (${m.curve ? 'moyenne' : tagLabel(m.tag)})`])], source?.id ?? '', (v) => {
        source = list.find((m) => String(m.id) === v) || null; result = null; renderResult(); draw();
      })));
    }

    root.append(
      h('h2', 'Égalisation'),
      h('div.grid2',
        card('Source et cible',
          sourceBox,
          h('p.muted', 'Conseil : moyenner 3 à 6 positions (onglet Mesure → « Moyenne spatiale ») plutôt qu\'égaliser un seul point.'),
          targetBox,
        ),
        card('Paramètres',
          h('div.row',
            field('De (Hz)', numberInput(opts.fLo, { onChange: (v) => { opts.fLo = v; } })),
            field('À (Hz)', numberInput(opts.fHi, { onChange: (v) => { opts.fHi = v; } })),
            field('Filtres max', numberInput(opts.maxFilters, { min: 1, max: 20, step: 1, onChange: (v) => { opts.maxFilters = Math.round(v); } })),
          ),
          h('div.row',
            field('Gain + max (dB)', numberInput(opts.maxBoost, { min: 0, max: 12, onChange: (v) => { opts.maxBoost = v; } })),
            field('Gain − max (dB)', numberInput(opts.maxCut, { min: 0, max: 24, onChange: (v) => { opts.maxCut = v; } })),
            field('Lissage', select([[3, '1/3 oct'], [6, '1/6 oct'], [12, '1/12 oct']], opts.smoothing, (v) => { opts.smoothing = +v; draw(); })),
          ),
          h('button.btn.primary.big', { on: { click: compute } }, 'Calculer l\'EQ'),
        ),
      ),
      card(null, plot.wrap),
      out,
    );
    renderSource();
    renderTarget();
    draw();
    return app.on('measurements', () => { renderSource(); draw(); });
  },
};

function qToBw(q) {
  // bandwidth in octaves for a given Q (RBJ definition)
  return (2 / Math.LN2) * Math.asinh(1 / (2 * q));
}

function fmtF(f) {
  return f >= 1000 ? `${f / 1000}k` : `${f}`;
}
