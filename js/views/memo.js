import { h, card, field, numberInput } from '../ui/dom.js';
import { DIAGRAMS, PINOUTS, PINOUT_NOTE } from '../data/cabling.js';
import { BRANDS, GENERAL_TIPS } from '../data/brands.js';
import { msFromMeters, speedOfSound } from '../dsp/align.js';

export default {
  id: 'memo',
  title: 'Mémo',
  mount(root, app) {
    const { settings } = app;
    let section = 'cablage';
    const seg = h('div.seg');
    const body = h('div');

    function renderSeg() {
      seg.innerHTML = '';
      for (const [v, l] of [['cablage', 'Câblage'], ['marques', 'Constructeurs'], ['calc', 'Calculs']]) {
        seg.append(h(`button${section === v ? '.on' : ''}`, { on: { click: () => { section = v; renderSeg(); render(); } } }, l));
      }
    }

    function render() {
      body.innerHTML = '';
      if (section === 'cablage') {
        for (const d of DIAGRAMS) {
          body.append(card(d.title, h('div', { html: d.svg }), h('ul', d.notes.map((n) => h('li', n)))));
        }
        body.append(card('Brochages',
          h('div.grid2', PINOUTS.map((p) => h('div', h('h4', p.name), h('table', p.rows.map((r) => h('tr', h('td', h('strong', r[0])), h('td', r[1]))))))),
          h('div.callout.warn', PINOUT_NOTE),
        ));
      } else if (section === 'marques') {
        body.append(card('Recommandations générales', GENERAL_TIPS.map((t) => h('details', h('summary', t.title), h('p', t.text)))));
        body.append(h('p.muted', 'Écosystèmes logiciels des principaux constructeurs. Les produits et logiciels évoluent : toujours vérifier la documentation à jour du constructeur.'));
        for (const b of BRANDS) {
          body.append(h('details', h('summary', `${b.name} — ${b.country}`),
            h('table',
              h('tr', h('td', 'Prédiction'), h('td', b.prediction)),
              h('tr', h('td', 'Contrôle'), h('td', b.control)),
              h('tr', h('td', 'Amplification / DSP'), h('td', b.processing)),
            ),
            h('ul', b.tips.map((t) => h('li', t))),
          ));
        }
      } else {
        body.append(calculators(settings));
      }
    }

    root.append(h('h2', 'Mémo terrain'), h('div.row', seg), body);
    renderSeg();
    render();
  },
};

function calculators(settings) {
  const T = settings.temperature;
  // distance → delay
  let dist = 10;
  const dOut = h('div.result');
  const upd1 = () => { dOut.textContent = `${msFromMeters(dist, T).toFixed(2)} ms`; };
  // SPL vs distance
  let spl1 = 100; let d1 = 1; let d2 = 30; let line = false;
  const sOut = h('div.result');
  const upd2 = () => {
    const k = line ? 10 : 20;
    sOut.textContent = `${(spl1 - k * Math.log10(d2 / d1)).toFixed(1)} dB SPL à ${d2} m`;
  };
  // wavelength
  let freq = 100;
  const wOut = h('div.result');
  const upd3 = () => {
    const l = speedOfSound(T) / freq;
    wOut.textContent = `λ = ${l.toFixed(2)} m · λ/4 = ${(l / 4).toFixed(2)} m · période ${(1000 / freq).toFixed(2)} ms`;
  };
  const lineCb = h('input', { type: 'checkbox' });
  lineCb.addEventListener('change', () => { line = lineCb.checked; upd2(); });
  const el = h('div',
    card('Distance → délai',
      h('div.row', field('Distance (m)', numberInput(dist, { onChange: (v) => { dist = v; upd1(); } }))), dOut,
      h('p.muted', `c = ${speedOfSound(T).toFixed(1)} m/s à ${T} °C`)),
    card('Niveau selon la distance',
      h('div.row',
        field('Niveau (dB SPL)', numberInput(spl1, { onChange: (v) => { spl1 = v; upd2(); } })),
        field('à (m)', numberInput(d1, { onChange: (v) => { d1 = v; upd2(); } })),
        field('Distance cible (m)', numberInput(d2, { onChange: (v) => { d2 = v; upd2(); } })),
      ),
      h('label.row', lineCb, 'Source linéique (champ proche d\'un line array : −3 dB par doublement)'),
      sOut,
      h('p.muted', 'Source ponctuelle : −6 dB par doublement de distance. En salle, le champ réverbéré ralentit la décroissance au-delà de la distance critique.')),
    card('Longueur d\'onde',
      h('div.row', field('Fréquence (Hz)', numberInput(freq, { onChange: (v) => { freq = v; upd3(); } }))), wOut),
  );
  upd1(); upd2(); upd3();
  return el;
}
