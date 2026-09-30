import { h, card, field, numberInput, select, toast, readFile, download } from '../ui/dom.js';
import { parseCurveText, measurementsDb, DEFAULT_SETTINGS } from '../store.js';
import { speedOfSound } from '../dsp/align.js';

export default {
  id: 'reglages',
  title: 'Réglages',
  mount(root, app) {
    const { settings } = app;
    const set = (k) => (v) => app.updateSettings({ [k]: v });
    const calBox = h('div');

    function renderCal() {
      calBox.innerHTML = '';
      const c = settings.micCal;
      calBox.append(
        c ? h('div.callout.ok', `Calibration active : ${c.name} (${c.points.length} points).`) : h('div.callout', 'Aucune calibration de micro : la réponse du micro du téléphone est incluse dans les mesures.'),
        h('div.btn-group',
          h('button.btn', { on: { click: importCal } }, 'Importer un fichier de calibration'),
          c ? h('button.btn.danger', { on: { click: () => { app.updateSettings({ micCal: null }); renderCal(); } } }, 'Retirer') : null,
        ),
        h('p.muted', 'Format texte « fréquence dB » (une paire par ligne), compatible avec les fichiers fournis par les fabricants de micros de mesure ou exportés d\'autres logiciels. La valeur est soustraite des mesures.'),
      );
    }

    async function importCal() {
      const f = await readFile('.txt,.cal,.csv,.frd');
      if (!f) return;
      const pts = parseCurveText(f.text);
      if (pts.length < 3) { toast('Fichier non reconnu.', 'error'); return; }
      app.updateSettings({ micCal: { name: f.name, points: pts } });
      toast('Calibration importée.', 'ok');
      renderCal();
    }

    async function exportAll() {
      const ms = await measurementsDb.all().catch(() => app.measurements);
      const data = {
        app: 'sound-calspeed', version: 1, exportedAt: new Date().toISOString(), settings,
        measurements: ms.map((m) => ({ ...m, ir: m.ir ? Array.from(m.ir, (v) => Math.round(v * 1e7) / 1e7) : undefined })),
      };
      download(`calspeed-session-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
    }

    async function importAll() {
      const f = await readFile('.json');
      if (!f) return;
      try {
        const data = JSON.parse(f.text);
        if (data.app !== 'sound-calspeed') throw new Error('Fichier non reconnu');
        for (const m of data.measurements || []) {
          delete m.id;
          if (m.ir) m.ir = Float32Array.from(m.ir);
          await app.saveMeasurement(m);
        }
        if (data.settings) app.updateSettings({ ...data.settings });
        toast(`${data.measurements?.length || 0} mesure(s) importée(s).`, 'ok');
      } catch (e) {
        toast(`Import impossible : ${e.message}`, 'error');
      }
    }

    const splOff = numberInput(settings.splOffset ?? '', { onChange: (v) => app.updateSettings({ splOffset: v }) });

    root.append(
      h('h2', 'Réglages'),
      h('div.grid2',
        card('Environnement',
          field('Température (°C)', numberInput(settings.temperature, { min: -20, max: 50, onChange: (v) => { set('temperature')(v); cOut.textContent = `c = ${speedOfSound(v).toFixed(1)} m/s`; } })),
          (() => { const e = h('small.hint', `c = ${speedOfSound(settings.temperature).toFixed(1)} m/s`); return e; })(),
        ),
        card('Sweep de mesure',
          h('div.row',
            field('Durée (s)', select([[1, '1 s'], [2, '2 s'], [4, '4 s'], [8, '8 s']], settings.sweepSeconds, (v) => set('sweepSeconds')(+v))),
            field('Traîne (s)', select([[1, '1 s'], [2, '2 s'], [3, '3 s'], [5, '5 s']], settings.sweepTail, (v) => set('sweepTail')(+v))),
            field('Répétitions', select([[1, '1'], [2, '2'], [4, '4'], [8, '8']], settings.sweepRepeats, (v) => set('sweepRepeats')(+v))),
          ),
          field('Niveau du sweep (dBFS)', numberInput(settings.sweepLevel, { min: -60, max: 0, onChange: set('sweepLevel') }), 'Plus long et plus de répétitions = meilleur rapport signal/bruit. Doubler la durée ≈ +3 dB.'),
        ),
        card('Analyse',
          h('div.row',
            field('Cycles FDW', numberInput(settings.fdwCycles, { min: 2, max: 50, onChange: set('fdwCycles') })),
            field('Fenêtre fixe (ms)', numberInput(settings.fixedWindowMs, { min: 2, max: 1000, onChange: set('fixedWindowMs') })),
          ),
          h('p.muted', 'FDW : 6–8 cycles en salle réverbérante (son direct), 15–30 cycles en extérieur.'),
        ),
        card('Calibration du micro', calBox),
        card('Niveau SPL (optionnel)',
          field('Offset dBFS → dB SPL', splOff, 'Avec un sonomètre de référence : jouer du bruit rose, lire le sonomètre, saisir (SPL lu − dBFS affiché). Précision limitée par le micro du téléphone.'),
          h('button.btn.small', { on: { click: () => { app.updateSettings({ splOffset: null }); splOff.value = ''; } } }, 'Effacer'),
        ),
        card('Données',
          h('div.btn-group',
            h('button.btn', { on: { click: exportAll } }, 'Exporter la session (.json)'),
            h('button.btn', { on: { click: importAll } }, 'Importer une session'),
          ),
          h('div.btn-group', { style: { marginTop: '8px' } },
            h('button.btn.danger', { on: { click: async () => { if (confirm('Supprimer toutes les mesures ?')) { await measurementsDb.clear().catch(() => {}); await app.reloadMeasurements(); app.measurements = []; app.emit('measurements'); toast('Mesures supprimées.'); } } } }, 'Supprimer toutes les mesures'),
            h('button.btn.danger', { on: { click: () => { if (confirm('Réinitialiser les réglages ?')) { app.updateSettings({ ...DEFAULT_SETTINGS }); location.reload(); } } } }, 'Réinitialiser les réglages'),
          ),
        ),
      ),
    );
    const cOut = root.querySelector('.card .hint');
    renderCal();
  },
};
