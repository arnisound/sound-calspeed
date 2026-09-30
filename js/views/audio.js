import { h, card, field, select, numberInput, toast } from '../ui/dom.js';
import { buildMeasurement } from '../audio/engine.js';

export default {
  id: 'audio',
  title: 'Audio',
  mount(root, app) {
    const { engine, settings } = app;
    let raf = 0;
    let holdPeak = -100;

    const startBtn = h('button.btn.primary.big', { on: { click: start } }, 'Démarrer l\'audio (autoriser le micro)');
    const inputs = h('div');
    const trackInfo = h('div.muted');

    async function start() {
      if (await app.ensureAudio()) {
        engine.setOutputChannel(settings.outputChannel);
        render();
      }
    }

    // ---- input ----
    const meterBar = h('div');
    const meterPeak = h('span');
    const meterVal = h('div.big-num', '—');
    const meterSpl = h('div.muted');

    async function renderInputs() {
      inputs.innerHTML = '';
      if (!engine.running) return;
      const list = await engine.listInputs();
      if (list.length > 1) {
        inputs.append(field('Micro', select(list.map((d, i) => [d.deviceId, d.label || `Entrée ${i + 1}`]), settings.inputDeviceId || '', async (id) => {
          app.updateSettings({ inputDeviceId: id });
          await engine.openMic(id);
          renderTrack();
        })));
      }
      renderTrack();
    }

    function renderTrack() {
      const s = engine.trackSettings || {};
      const warn = [];
      if (s.echoCancellation) warn.push('annulation d\'écho');
      if (s.noiseSuppression) warn.push('réduction de bruit');
      if (s.autoGainControl) warn.push('contrôle automatique de gain');
      trackInfo.innerHTML = '';
      trackInfo.append(
        h('div', `Fréquence d'échantillonnage : ${engine.sampleRate} Hz` + (s.sampleRate ? ` · micro ${s.sampleRate} Hz` : '')),
        warn.length
          ? h('div.callout.bad', `Le navigateur a laissé actifs : ${warn.join(', ')}. Les mesures seront faussées. Essayer un autre navigateur (Chrome Android, Safari iOS récent).`)
          : h('div.callout.ok', 'Traitements du micro désactivés (écho, bruit, gain auto) : OK pour la mesure.'),
      );
    }

    function tick() {
      raf = requestAnimationFrame(tick);
      if (!engine.running) return;
      const { rmsDb, peakDb } = engine.inputLevel();
      holdPeak = Math.max(peakDb, holdPeak - 0.3);
      const pct = (db) => Math.max(0, Math.min(100, ((db + 90) / 90) * 100));
      meterBar.style.width = `${pct(rmsDb)}%`;
      meterPeak.style.left = `${pct(holdPeak)}%`;
      meterVal.textContent = `${rmsDb.toFixed(1)} dBFS`;
      meterSpl.textContent = settings.splOffset != null
        ? `≈ ${(rmsDb + settings.splOffset).toFixed(1)} dB SPL (Z, calibré par offset)`
        : `Crête ${peakDb.toFixed(1)} dBFS${peakDb > -1 ? ' — SATURATION' : ''}`;
    }

    // ---- output ----
    const outSeg = h('div.seg');
    function renderOutSeg() {
      outSeg.innerHTML = '';
      for (const [v, l] of [['left', 'Gauche'], ['both', 'G + D'], ['right', 'Droite']]) {
        outSeg.append(h(`button${settings.outputChannel === v ? '.on' : ''}`, {
          on: { click: () => { app.updateSettings({ outputChannel: v }); engine.setOutputChannel(v); renderOutSeg(); } },
        }, l));
      }
    }

    const levelLabel = h('span');
    const level = h('input', { type: 'range', min: -60, max: 0, step: 1, value: settings.generatorLevel });
    const setLevelLabel = () => { levelLabel.textContent = `${level.value} dBFS`; };
    level.addEventListener('input', () => {
      setLevelLabel();
      app.updateSettings({ generatorLevel: +level.value });
      if (engine.player) engine.setLevel(+level.value);
    });
    setLevelLabel();
    let sineFreq = 1000;
    const freqInput = numberInput(sineFreq, { min: 10, max: 20000, onChange: (v) => { sineFreq = v; if (engine.player?.type === 'sine') play('sine'); } });

    async function play(type) {
      if (!(await app.ensureAudio())) return;
      engine.setOutputChannel(settings.outputChannel);
      engine.play(type, { levelDb: settings.generatorLevel, freq: sineFreq });
    }

    // ---- loop test ----
    const loopOut = h('div');
    async function loopTest() {
      if (!(await app.ensureAudio())) return;
      loopOut.innerHTML = '';
      loopOut.append(h('div.muted', 'Sweep en cours…'));
      try {
        const res = await engine.measureSweep({ seconds: 1, tail: 1, levelDb: settings.sweepLevel, repeats: 3 });
        const m = buildMeasurement(res, { name: 'test' });
        const latency = (m.peak / m.sr) * 1000;
        const verdict = m.snr > 40 ? 'ok' : m.snr > 25 ? 'warn' : 'bad';
        loopOut.innerHTML = '';
        loopOut.append(
          h('div.result', `${latency.toFixed(1)} ms `, h('small', 'latence de boucle (sortie → enceinte → micro), distance acoustique incluse')),
          h(`div.callout.${verdict}`, `Rapport signal/bruit ≈ ${m.snr.toFixed(0)} dB. `,
            verdict === 'ok' ? 'Très bien.' : verdict === 'warn' ? 'Correct ; monter le niveau ou refaire au calme pour plus de précision.' : 'Insuffisant : monter le niveau du sweep, vérifier le routage de la console.'),
          h(`div.callout.${m.jitterMs < 0.05 ? 'ok' : 'bad'}`, `Stabilité de la latence entre 3 sweeps : ${m.jitterMs.toFixed(3)} ms. `,
            m.jitterMs < 0.05 ? 'Stable : les mesures de délais seront fiables.' : 'Instable ! Vérifier qu\'aucune sortie Bluetooth n\'est utilisée, fermer les autres apps, recharger la page.'),
          res.clipped ? h('div.callout.bad', 'Le micro a saturé : baisser le niveau.') : null,
        );
      } catch (e) {
        loopOut.innerHTML = '';
        toast(e.message, 'error');
      }
    }

    function render() {
      root.innerHTML = '';
      root.append(h('h2', 'Entrée / sortie audio'));
      if (!engine.running) {
        root.append(card(null,
          h('p', 'L\'accès au micro est nécessaire. Le navigateur va demander l\'autorisation.'),
          startBtn,
          h('p.muted', 'Astuce : brancher le câble de sortie avant de démarrer, pour que le téléphone route le son vers la console dès le départ.'),
        ));
        return;
      }
      root.append(
        h('div.grid2',
          card('Entrée (micro)',
            meterVal, h('div.meter', meterBar, meterPeak), meterSpl, inputs, trackInfo),
          card('Sortie (vers la console)',
            field('Canal de sortie', outSeg, 'Ex. : G → tranche « tête », D → tranche « sub » pour basculer sans toucher la console.'),
            h('div.row', field('Niveau générateur', h('div', level, ' ', levelLabel))),
            h('div.btn-group',
              h('button.btn', { on: { click: () => play('pink') } }, 'Bruit rose'),
              h('button.btn', { on: { click: () => play('white') } }, 'Bruit blanc'),
              h('button.btn', { on: { click: () => play('pulse') } }, 'Impulsions (polarité)'),
              h('button.btn.danger', { on: { click: () => engine.stopSignal() } }, 'Stop'),
            ),
            h('div.row', field('Sinus (Hz)', freqInput), h('button.btn', { on: { click: () => play('sine') } }, 'Sinus')),
          ),
        ),
        card('Test de la boucle de mesure',
          h('p.muted', 'Joue 3 sweeps courts et vérifie latence, stabilité et rapport signal/bruit. À faire au début de chaque session et après tout changement de branchement.'),
          h('button.btn.primary', { on: { click: loopTest } }, 'Lancer le test'),
          loopOut,
        ),
      );
      renderOutSeg();
      renderInputs();
    }

    render();
    tick();
    const off = () => render();
    engine.addEventListener('state', off);
    return () => {
      cancelAnimationFrame(raf);
      engine.removeEventListener('state', off);
    };
  },
};
