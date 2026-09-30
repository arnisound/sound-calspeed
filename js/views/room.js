import { h, card, field, numberInput, toast } from '../ui/dom.js';
import { Plot, PALETTE } from '../ui/plot.js';
import { analyzeRoom, bestRt, roomAdvice, reverbCompensation, rtMid, schroederFrequency } from '../dsp/room.js';
import { measurementPicker, measurePanel } from './measure.js';

export default {
  id: 'salle',
  title: 'Salle',
  mount(root, app) {
    const { settings } = app;
    let m = [...app.measurements].reverse().find((x) => x.ir && x.tag === 'room') || null;
    let dims = settings.roomDims || [20, 12, 6];
    let amount = 0.5;
    const out = h('div');
    const pickerBox = h('div');

    function renderPicker() {
      pickerBox.innerHTML = '';
      pickerBox.append(field('Mesure à analyser', measurementPicker(app, m?.id, (x) => { m = x; })));
    }

    function analyse() {
      out.innerHTML = '';
      if (!m) { toast('Choisir une mesure (idéalement type « Salle », avec une longue traîne).', 'warn'); return; }
      const a = analyzeRoom(m.ir, m.sr);
      const volume = dims[0] * dims[1] * dims[2];
      const mid = rtMid(a);
      const tailS = m.ir.length / m.sr - 0.5;
      const fmt = (v) => (v ? `${v.toFixed(2)} s` : '—');

      const rtPlot = new Plot(h('div'), { xMin: 50, xMax: 10000, yMin: 0, yMax: Math.max(1, Math.ceil((Math.max(...a.bands.map((b) => bestRt(b) || 0)) + 0.3) * 2) / 2), height: 200, yFormat: (v) => `${v}s` });
      const fx = a.bands.map((b) => b.freq);
      rtPlot.set([
        { x: fx, y: a.bands.map((b) => b.edt ?? NaN), color: PALETTE[1], label: 'EDT' },
        { x: fx, y: a.bands.map((b) => b.t20 ?? NaN), color: PALETTE[0], width: 2.2, label: 'T20' },
        { x: fx, y: a.bands.map((b) => b.t30 ?? NaN), color: PALETTE[2], label: 'T30' },
      ]);

      const edc = a.broadband.edc;
      const step = Math.max(1, Math.floor(edc.length / 2000));
      const ex = []; const ey = [];
      for (let i = 0; i < edc.length; i += step) { ex.push((i / m.sr) * 1000); ey.push(edc[i]); }
      const edcPlot = new Plot(h('div'), { xLog: false, xMin: 0, xMax: Math.max(100, ex[ex.length - 1] || 1000), yMin: -60, yMax: 0, height: 180, xFormat: (v) => `${Math.round(v)} ms` });
      edcPlot.set([{ x: ex, y: ey, color: PALETTE[0], label: 'Décroissance (Schroeder)' }]);

      const comp = reverbCompensation(a, amount);
      const compPlot = new Plot(h('div'), { xMin: 50, xMax: 10000, yMin: -8, yMax: 8, height: 160 });
      compPlot.set([{ x: comp.map((c) => c.freq), y: comp.map((c) => c.db), color: PALETTE[4], width: 2.2, label: 'Correction de cible proposée' }]);

      function createTarget() {
        const base = app.currentTarget();
        const pts = [];
        for (let f = 20; f <= 20000; f *= Math.pow(2, 1 / 3)) {
          // interpolate compensation (log-frequency) from octave values, hold ends
          let c = 0;
          if (comp.length) {
            if (f <= comp[0].freq) c = comp[0].db;
            else if (f >= comp[comp.length - 1].freq) c = comp[comp.length - 1].db;
            else {
              for (let i = 1; i < comp.length; i++) {
                if (f <= comp[i].freq) {
                  const t = Math.log(f / comp[i - 1].freq) / Math.log(comp[i].freq / comp[i - 1].freq);
                  c = comp[i - 1].db + t * (comp[i].db - comp[i - 1].db);
                  break;
                }
              }
            }
          }
          pts.push([Math.round(f * 10) / 10, Math.round((base.fn(f) + c) * 10) / 10]);
        }
        const id = `room-${Date.now()}`;
        app.updateSettings({
          importedTargets: [...settings.importedTargets, { id, name: `${base.name} + salle (${m.name})`, points: pts, desc: `Cible « ${base.name} » compensée pour la réverbération mesurée (${Math.round(amount * 100)} %).` }],
          targetId: id,
        });
        toast('Nouvelle cible créée et sélectionnée dans l\'onglet EQ.', 'ok');
      }

      const tips = roomAdvice(a, { volume });
      out.append(
        tailS < 1.5 * (mid || 1) ? h('div.callout.warn', `La mesure ne garde que ${tailS.toFixed(1)} s après le son direct : pour une salle réverbérante, refaire la mesure ici (traîne longue) pour fiabiliser T30.`) : null,
        h('div.grid2',
          card('Synthèse',
            h('div.result', `RT moyen ≈ ${mid ? mid.toFixed(2) : '—'} s`, h('br'), h('small', '500 Hz – 1 kHz')),
            h('table',
              h('tr', h('td', 'C80 (clarté musique)'), h('td.num', `${a.c80.toFixed(1)} dB`)),
              h('tr', h('td', 'C50 (clarté parole)'), h('td.num', `${a.c50.toFixed(1)} dB`)),
              h('tr', h('td', 'D50 (définition)'), h('td.num', `${(a.d50 * 100).toFixed(0)} %`)),
              h('tr', h('td', 'Volume estimé'), h('td.num', `${Math.round(volume)} m³`)),
              mid ? h('tr', h('td', 'Fréquence de Schroeder'), h('td.num', `${Math.round(schroederFrequency(mid, volume))} Hz`)) : null,
            ),
          ),
          card('Temps de réverbération par octave',
            rtPlot.wrap,
            h('div.table-wrap', h('table',
              h('tr', h('th', 'Hz'), ...a.bands.map((b) => h('th.num', b.freq >= 1000 ? `${b.freq / 1000}k` : b.freq))),
              h('tr', h('td', 'EDT'), ...a.bands.map((b) => h('td.num', fmt(b.edt)))),
              h('tr', h('td', 'T20'), ...a.bands.map((b) => h('td.num', fmt(b.t20)))),
              h('tr', h('td', 'T30'), ...a.bands.map((b) => h('td.num', fmt(b.t30)))),
            )),
          ),
        ),
        card('Conseils', h('ul', tips.map((t) => h('li', t)))),
        card('Correction d\'environnement réverbérant',
          h('p', 'Dans une salle réverbérante, les fréquences qui « traînent » (souvent le grave) s\'accumulent dans le champ diffus et alourdissent la tonalité perçue. La compensation abaisse la cible dans ces bandes, proportionnellement à l\'écart de RT par rapport aux fréquences moyennes. C\'est une aide empirique : valider à l\'écoute.'),
          h('div.row', field('Intensité', (() => {
            const r = h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: amount });
            r.addEventListener('change', () => { amount = +r.value; analyse(); });
            return r;
          })(), `${Math.round(amount * 100)} %`)),
          compPlot.wrap,
          h('button.btn.primary', { on: { click: createTarget } }, `Créer la cible « ${app.currentTarget().name} + salle »`),
          h('p.muted', 'Autres leviers, plus efficaces que l\'EQ : fenêtrage FDW pour égaliser le son direct (Mesure), enceintes plus directives, sub cardio, rappels pour rapprocher le son du public, niveau global modéré.'),
        ),
        card('Courbe de décroissance', edcPlot.wrap),
      );
    }

    root.append(
      h('h2', 'Acoustique de salle'),
      h('div.grid2',
        card('Mesure de réverbération',
          h('p.muted', 'Sweep avec une traîne longue (4 s) pour capter toute la décroissance. Placer le téléphone loin des enceintes, dans la salle. Niveau suffisant : la décroissance doit dépasser 35 dB au-dessus du bruit.'),
          measurePanel(app, { defaultName: 'Salle', defaultTag: 'room', tail: 4 }),
        ),
        card('Analyse',
          pickerBox,
          h('div.row',
            field('Longueur (m)', numberInput(dims[0], { onChange: (v) => { dims[0] = v; app.updateSettings({ roomDims: dims }); } })),
            field('Largeur (m)', numberInput(dims[1], { onChange: (v) => { dims[1] = v; app.updateSettings({ roomDims: dims }); } })),
            field('Hauteur (m)', numberInput(dims[2], { onChange: (v) => { dims[2] = v; app.updateSettings({ roomDims: dims }); } })),
          ),
          h('button.btn.primary', { on: { click: analyse } }, 'Analyser'),
        ),
      ),
      out,
    );
    renderPicker();
    return app.on('measurements', () => {
      const last = app.measurements.at(-1);
      if (last && last.ir && last.tag === 'room') m = last;
      renderPicker();
    });
  },
};
