// Cabling memo: diagrams (inline SVG using theme colours) and pinouts.

const box = (x, y, w, h, label, sub = '', cls = '') =>
  `<g class="dg-box ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>` +
  `<text x="${x + w / 2}" y="${y + (sub ? h / 2 - 3 : h / 2 + 4)}" text-anchor="middle">${label}</text>` +
  (sub ? `<text class="dg-sub" x="${x + w / 2}" y="${y + h / 2 + 11}" text-anchor="middle">${sub}</text>` : '') + '</g>';

const arrow = (x1, y1, x2, y2, label = '', dy = -5) =>
  `<g class="dg-link"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#arr)"/>` +
  (label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + dy}" text-anchor="middle">${label}</text>` : '') + '</g>';

const svg = (w, h, body) =>
  `<svg class="diagram" viewBox="0 0 ${w} ${h}" role="img"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-head"/></marker></defs>${body}</svg>`;

export const DIAGRAMS = [
  {
    id: 'phone',
    title: 'Téléphone → console (mesure)',
    svg: svg(560, 190,
      box(10, 60, 110, 60, 'Téléphone', 'sortie casque') +
      arrow(120, 90, 215, 90, 'jack 3,5 TRS') +
      box(215, 55, 120, 70, 'Boîte de DI', 'stéréo, ou câble') +
      arrow(335, 75, 430, 75, 'XLR (G)') +
      arrow(335, 105, 430, 105, 'XLR (D)', 16) +
      box(430, 55, 120, 70, 'Console', 'entrée ligne') +
      `<text class="dg-note" x="10" y="165">Micro du téléphone = micro de mesure : le poser sur un pied, à hauteur d'oreille, dans la zone d'audience.</text>` +
      `<text class="dg-note" x="10" y="182">Câble TRS 3 pôles (pas TRRS) pour que le téléphone garde son micro interne.</text>`),
    notes: [
      'Sans DI : câble jack 3,5 stéréo → 2 jacks 6,35 mono (ou 2 XLR mâles) vers deux entrées ligne ; garder des câbles courts, risque de ronflette.',
      'Volume du téléphone à ~80 %, gain de la tranche réglé pour que le bruit rose de l\'app à −20 dBFS sorte à un niveau confortable.',
      'Mettre le téléphone en mode avion, sons et notifications coupés, économiseur d\'écran désactivé pendant les mesures.',
      'Pas de Bluetooth : la latence n\'est pas stable, les mesures de délai deviennent fausses.',
      'iPhone / Android sans prise jack : adaptateur Lightning ou USB-C → jack (DAC). Vérifier que l\'adaptateur n\'a pas de micro intégré.',
      'Router G et D séparément permet de choisir dans l\'app quelle voie joue (ex. G → tête, D → sub) sans toucher à la console.',
    ],
  },
  {
    id: 'system',
    title: 'Chaîne de diffusion type',
    svg: svg(560, 250,
      box(10, 95, 90, 60, 'Console', 'L / R / Sub') +
      arrow(100, 125, 170, 125, 'AES / analog.') +
      box(170, 80, 110, 90, 'Processeur', 'EQ, délais, XO') +
      arrow(280, 100, 350, 40, '') + arrow(280, 115, 350, 100, '') + arrow(280, 135, 350, 160, '') + arrow(280, 150, 350, 220, '') +
      box(350, 15, 90, 45, 'Ampli', 'Têtes L/R') + box(350, 80, 90, 40, 'Ampli', 'Subs') + box(350, 140, 90, 40, 'Ampli', 'Front-fill') + box(350, 200, 90, 40, 'Ampli', 'Rappels') +
      arrow(440, 37, 490, 37, '') + arrow(440, 100, 490, 100, '') + arrow(440, 160, 490, 160, '') + arrow(440, 220, 490, 220, '') +
      `<text class="dg-note" x="495" y="41">Têtes</text><text class="dg-note" x="495" y="104">Subs</text><text class="dg-note" x="495" y="164">Fills</text><text class="dg-note" x="495" y="224">Delays</text>`),
    notes: [
      'Une sortie processeur par zone à régler indépendamment (EQ, délai, niveau) : têtes, subs, front-fills, out-fills, rappels.',
      'Sub en départ auxiliaire (« aux-fed ») : contrôle artistique du sub au mix, mais le calage de raccord tête/sub doit être refait si les coupures changent.',
      'Subs : en général une somme mono (L+R) est préférable, plutôt que des subs stéréo séparés largement (interférences gauche/droite dans le grave).',
      'Garder la structure de gain : console proche de 0 dBu nominal, processeur sans écrêtage, amplis à la sensibilité recommandée.',
    ],
  },
  {
    id: 'subs',
    title: 'Dispositions de subs',
    svg: svg(560, 150,
      box(10, 40, 50, 40, 'S') + box(62, 40, 50, 40, 'S') +
      `<text class="dg-note" x="10" y="105">Gauche/droite</text>` +
      box(150, 40, 40, 40, 'S') + box(192, 40, 40, 40, 'S') + box(234, 40, 40, 40, 'S') +
      `<text class="dg-note" x="150" y="105">Ligne centrale (délais</text><text class="dg-note" x="150" y="120">pour arc électronique)</text>` +
      box(320, 30, 50, 30, 'S →') + box(320, 62, 50, 30, '← S', 'inv.') +
      `<text class="dg-note" x="310" y="115">Cardio « gradient »</text>` +
      box(440, 20, 45, 25, 'S') + box(440, 50, 45, 25, 'S') + box(440, 80, 45, 25, 'S') +
      `<text class="dg-note" x="490" y="40">avant</text><text class="dg-note" x="490" y="100">arrière</text><text class="dg-note" x="430" y="130">End-fire (délais)</text>`),
    notes: [
      'Gauche/droite : simple, mais crée une alternance de zones creux/bosses dans le grave au centre de la salle.',
      'Ligne ou arc de subs : couverture plus homogène ; un arc « électronique » se fait en retardant les subs extérieurs.',
      'Cardio : réduit le grave vers la scène et vers l\'arrière (moins d\'excitation de la salle). Voir l\'onglet Cardio.',
    ],
  },
];

export const PINOUTS = [
  { name: 'XLR 3 broches (symétrique)', rows: [['1', 'Masse / blindage'], ['2', 'Point chaud (+)'], ['3', 'Point froid (−)']] },
  { name: 'Jack 6,35 TRS (symétrique)', rows: [['Pointe (T)', 'Point chaud (+)'], ['Bague (R)', 'Point froid (−)'], ['Corps (S)', 'Masse']] },
  { name: 'Jack 3,5 stéréo (sortie téléphone)', rows: [['Pointe', 'Gauche'], ['Bague', 'Droite'], ['Corps', 'Masse']] },
  { name: 'Speakon NL4', rows: [['1+ / 1−', 'Voie 1 (large bande, ou grave en bi-amp)'], ['2+ / 2−', 'Voie 2 (aigu en bi-amp, ou 2e enceinte selon constructeur)']] },
  { name: 'Speakon NL8', rows: [['1± … 4±', '4 voies (multi-amplification, ex. line array 3 voies + passive)']] },
  { name: 'AES/EBU (AES3)', rows: [['Câble', '110 Ω sur XLR, 2 canaux par câble'], ['Longueur', 'jusqu\'à ~100 m en câble adapté']] },
  { name: 'powerCON', rows: [['Bleu', 'Entrée secteur (NAC3)'], ['Gris', 'Sortie / repiquage (NAC3)'], ['TRUE1', 'Connecteur étanche, verrouillable, repiquage']] },
];

export const PINOUT_NOTE = 'Le brochage des Speakon en multi-amplification varie selon les constructeurs : toujours vérifier la documentation de l\'enceinte et de l\'ampli.';
