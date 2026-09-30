import { h, card, field, select, toast, download, fmtMs } from '../ui/dom.js';
import { Plot, PALETTE } from '../ui/plot.js';
import { buildMeasurement } from '../audio/engine.js';
import {
  FREQS, TAGS, tagLabel, magnitudeOf, phaseOf, spatialAverage, peakMs, measurementCsv,
} from '../measure.js';

export const colorOf = (app, m) => PALETTE[app.measurements.indexOf(m) % PALETTE.length];

export function measurementPicker(app, value, onChange, { filter = (m) => !!m.ir, placeholder = '— choisir —' } = {}) {
  const list = app.measurements.filter(filter);
  return select([['', placeholder], ...list.map((m) => [m.id, `${m.name} (${tagLabel(m.tag)})`])], value ?? '', (v) => onChange(list.find((m) => String(m.id) === v) || null));
}

/** Shared "take a measurement" panel. onDone(measurement) is called after saving. */
export function measurePanel(app, { defaultName = 'Mesure', defaultTag = 'system', onDone, tail } = {}) {
  const { engine, settings } = app;
  const count = app.measurements.length + 1;
  const name = h('input', { type: 'text', value: `${defaultName} ${count}` });
  const tag = select(TAGS, defaultTag);
  const progress = h('div.progress', h('div', { style: { width: '0%' } }));
  const status = h('div.muted');
  const btn = h('button.btn.primary.big', { on: { click: run } }, '● Mesurer (sweep)');

  async function run() {
    if (!(await app.ensureAudio())) return;
    engine.setOutputChannel(settings.outputChannel);
    btn.disabled = true;
    const bar = progress.firstChild;
    try {
      const res = await engine.measureSweep({
        seconds: settings.sweepSeconds,
        tail: tail ?? settings.sweepTail,
        levelDb: settings.sweepLevel,
        repeats: settings.sweepRepeats,
        onProgress: (i, n) => {
          status.textContent = `Sweep ${i + 1} / ${n}…`;
          bar.style.width = `${(i / n) * 100}%`;
        },
      });
      bar.style.width = '100%';
      const m = buildMeasurement(res, { name: name.value.trim() || `Mesure ${count}`, keepSeconds: Math.max(0.5, (tail ?? settings.sweepTail) - 0.3) });
      m.tag = tag.value;
      m.temperature = settings.temperature;
      await app.saveMeasurement(m);
      app.visible.add(m.id);
      const warnings = [];
      if (m.clipped) warnings.push('saturation du micro');
      if (m.snr < 25) warnings.push(`SNR faible (${m.snr.toFixed(0)} dB)`);
      if (m.jitterMs > 0.05) warnings.push(`latence instable (${m.jitterMs.toFixed(2)} ms)`);
      toast(warnings.length ? `Mesure enregistrée, attention : ${warnings.join(', ')}` : `« ${m.name} » enregistrée (SNR ${m.snr.toFixed(0)} dB)`, warnings.length ? 'warn' : 'ok');
      status.textContent = '';
      name.value = `${defaultName} ${app.measurements.length + 1}`;
      if (onDone) onDone(m);
    } catch (e) {
      toast(e.message || String(e), 'error');
      status.textContent = '';
    } finally {
      btn.disabled = false;
      setTimeout(() => { progress.firstChild.style.width = '0%'; }, 600);
    }
  }

  return h('div',
    h('div.row', h('div.grow', field('Nom', name)), field('Type', tag)),
    h('div.row', btn),
    progress, status,
  );
}

export default {
  id: 'mesure',
  title: 'Mesure',
  mount(root, app) {
    const { settings } = app;
    let viewMode = 'mag';
    let reference = null;

    const plot = new Plot(h('div'), { yMin: -40, yMax: 10, height: 300 });
    const listEl = h('div.mlist');
    const modeSeg = h('div.seg');

    function visibleList() {
      return app.measurements.filter((m) => app.visible.has(m.id));
    }

    function draw() {
      const vis = visibleList();
      if (viewMode === 'ir') {
        plot.setRange({ xLog: false, yLabel: '', yStep: null });
        const traces = [];
        let tMin = Infinity; let tMax = -Infinity;
        for (const m of vis.filter((x) => x.ir)) {
          const t0 = peakMs(m);
          tMin = Math.min(tMin, t0 - 5);
          tMax = Math.max(tMax, t0 + 40);
        }
        for (const m of vis.filter((x) => x.ir)) {
          const x = []; const y = [];
          const peakAmp = Math.abs(m.ir[Math.round(m.peak - m.irStart)]) || 1;
          const a = Math.max(0, Math.floor(((tMin / 1000) * m.sr) - m.irStart));
          const b = Math.min(m.ir.length, Math.ceil(((tMax / 1000) * m.sr) - m.irStart));
          const step = Math.max(1, Math.floor((b - a) / 3000));
          for (let i = a; i < b; i += step) { x.push(((i + m.irStart) / m.sr) * 1000); y.push(m.ir[i] / peakAmp); }
          traces.push({ x, y, color: colorOf(app, m), label: m.name, width: 1.2 });
        }
        if (Number.isFinite(tMin)) plot.setRange({ xMin: tMin, xMax: tMax, yMin: -1.1, yMax: 1.1, xFormat: (v) => `${v.toFixed(0)} ms` });
        plot.set(traces);
        return;
      }
      plot.setRange({ xLog: true, xMin: 20, xMax: 20000, xFormat: null, yStep: viewMode === 'phase' ? 45 : null });
      if (viewMode === 'phase') {
        plot.setRange({ yMin: -180, yMax: 180 });
        plot.set(vis.filter((m) => m.ir).map((m) => ({ x: FREQS, y: phaseOf(m, settings), color: colorOf(app, m), label: m.name, wrap: 270 })));
        return;
      }
      plot.set(vis.map((m) => ({ x: FREQS, y: magnitudeOf(m, settings), color: colorOf(app, m), label: m.name, width: m.curve ? 2.4 : 1.6 })));
      plot.autoY(3, 30);
    }

    function renderList() {
      listEl.innerHTML = '';
      if (!app.measurements.length) {
        listEl.append(h('p.muted', 'Aucune mesure pour l\'instant.'));
        return;
      }
      if (!reference || !app.measurements.includes(reference)) reference = app.measurements.find((m) => m.ir) || null;
      for (const m of app.measurements) {
        const cb = h('input', { type: 'checkbox', checked: app.visible.has(m.id) });
        cb.addEventListener('change', () => { if (cb.checked) app.visible.add(m.id); else app.visible.delete(m.id); draw(); });
        const meta = [tagLabel(m.tag), new Date(m.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })];
        if (m.ir) {
          meta.push(`SNR ${m.snr.toFixed(0)} dB`);
          meta.push(`polarité ${m.polarity > 0 ? '+' : '−'}`);
          if (reference && m !== reference && reference.ir) meta.push(`Δt ${fmtMs(peakMs(m) - peakMs(reference))} / réf.`);
        } else meta.push(`moyenne de ${m.sources?.length || '?'} positions`);
        listEl.append(h('div.mitem',
          cb,
          h('div.swatch', { style: { background: colorOf(app, m) } }),
          h('div.info', h('div.name', m.name), h('div.meta', meta.join(' · '))),
          h('div.btn-group',
            m.ir ? h('button.btn.small', { title: 'Référence de temps', on: { click: () => { reference = m; renderList(); } } }, m === reference ? '★' : '☆') : null,
            h('button.btn.small', { on: { click: () => rename(m) } }, '✎'),
            h('button.btn.small', { on: { click: () => download(`${m.name}.txt`, measurementCsv(m, settings)) } }, '⤓'),
            h('button.btn.small.danger', { on: { click: () => remove(m) } }, '✕'),
          ),
        ));
      }
    }

    async function rename(m) {
      const n = prompt('Nouveau nom', m.name);
      if (n) { m.name = n; await app.saveMeasurement(m); }
    }
    async function remove(m) {
      if (confirm(`Supprimer « ${m.name} » ?`)) await app.deleteMeasurement(m);
    }
    async function average() {
      const sel = visibleList();
      if (sel.length < 2) { toast('Cocher au moins 2 mesures à moyenner.', 'warn'); return; }
      const avg = spatialAverage(sel, settings, `Moyenne (${sel.length} pos.)`);
      await app.saveMeasurement(avg);
      app.visible.add(avg.id);
      toast('Moyenne spatiale créée : utilisable dans l\'onglet EQ.', 'ok');
    }

    function renderModes() {
      modeSeg.innerHTML = '';
      for (const [v, l] of [['mag', 'Magnitude'], ['phase', 'Phase'], ['ir', 'Impulsion']]) {
        modeSeg.append(h(`button${viewMode === v ? '.on' : ''}`, { on: { click: () => { viewMode = v; renderModes(); draw(); } } }, l));
      }
    }

    const smoothSel = select([[0, 'Aucun'], [24, '1/24 oct'], [12, '1/12 oct'], [6, '1/6 oct'], [3, '1/3 oct'], [1, '1 oct']], settings.smoothing, (v) => { app.updateSettings({ smoothing: +v }); draw(); });
    const winSel = select([['fdw', `FDW (${settings.fdwCycles} cycles)`], ['fixed', `Fenêtre fixe ${settings.fixedWindowMs} ms`], ['long', 'Longue 500 ms (salle incluse)']], settings.windowMode, (v) => { app.updateSettings({ windowMode: v }); draw(); });

    root.append(
      h('h2', 'Mesures (fonction de transfert)'),
      h('div.grid2',
        card('Nouvelle mesure', measurePanel(app, {}),
          h('p.muted', 'Ne pas bouger le téléphone entre deux mesures à comparer. Un sweep dure ' + settings.sweepSeconds + ' s ; ' + settings.sweepRepeats + ' répétition(s) moyennée(s) (Réglages).')),
        card('Mesures', listEl,
          h('div.row',
            h('button.btn.small', { on: { click: average } }, 'Moyenne spatiale des cochées'),
            h('button.btn.small', { on: { click: () => { app.measurements.forEach((m) => app.visible.add(m.id)); renderList(); draw(); } } }, 'Tout afficher'),
            h('button.btn.small', { on: { click: () => { app.visible.clear(); renderList(); draw(); } } }, 'Tout masquer'),
          )),
      ),
      card(null,
        h('div.row', modeSeg, field('Lissage', smoothSel), field('Fenêtrage', winSel)),
        plot.wrap,
        h('p.muted', 'FDW (fenêtre dépendante de la fréquence) : garde le son direct et les premières réflexions, écarte la réverbération tardive. Recommandé pour l\'EQ en salle réverbérante. ★ = mesure de référence pour les écarts de temps (Δt).'),
      ),
    );
    renderModes();
    renderList();
    draw();
    return app.on('measurements', () => { renderList(); draw(); });
  },
};
