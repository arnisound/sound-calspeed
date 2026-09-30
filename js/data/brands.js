// Manufacturer ecosystem memo. Tools and product names evolve: always check
// the manufacturer's current documentation before a show.

export const BRANDS = [
  {
    name: 'L-Acoustics', country: 'France',
    prediction: 'Soundvision', control: 'LA Network Manager', processing: 'Contrôleurs amplifiés LA4X, LA7.16, LA12X',
    tips: [
      'Utiliser exclusivement les presets usine de chaque enceinte dans les contrôleurs LA (le filtrage d\'enceinte y est déjà fait).',
      'Les presets sub existent en versions standard et cardio : le mode cardio se choisit par preset et selon la disposition préconisée dans la documentation.',
      'Caler les angles, le site et les délais dans Soundvision avant l\'installation, puis vérifier à la mesure.',
    ],
  },
  {
    name: 'd&b audiotechnik', country: 'Allemagne',
    prediction: 'ArrayCalc', control: 'R1 Remote control', processing: 'Amplificateurs D20, D40, D80, 40D',
    tips: [
      'Les amplis d&b proposent des options de filtre par preset (ex. CUT pour tête avec sub, HFA, CPL) : les activer selon la configuration.',
      'Les modes cardio de subs (dont CSA) se configurent via preset et disposition — suivre ArrayCalc.',
      'ArrayProcessing (ArrayCalc) optimise la réponse sur la zone d\'audience des line arrays compatibles.',
    ],
  },
  {
    name: 'Meyer Sound', country: 'USA',
    prediction: 'MAPP 3D', control: 'Compass', processing: 'Enceintes auto-amplifiées + processeurs Galileo GALAXY',
    tips: [
      'Enceintes auto-amplifiées : pas de preset d\'ampli à choisir, le calage se fait dans le processeur GALAXY (EQ, délais, U-Shaping).',
      'Prévoir l\'alimentation secteur et la distribution de signal (analogique ou AVB/Milan) jusqu\'à chaque enceinte.',
    ],
  },
  {
    name: 'NEXO', country: 'France',
    prediction: 'NS-1', control: 'NeMo', processing: 'Amplificateurs / contrôleurs NXAMP, DTD',
    tips: [
      'Les contrôleurs NEXO appliquent les presets et protections des enceintes : sélectionner le bon setup tête/sub.',
      'NS-1 permet de dimensionner et d\'angler les line arrays (GEO, STM…).',
    ],
  },
  {
    name: 'Adamson', country: 'Canada',
    prediction: 'Blueprint AV', control: 'Selon la plateforme d\'amplification utilisée', processing: 'Presets Adamson pour amplificateurs / processeurs compatibles',
    tips: ['Charger la bibliothèque de presets Adamson correspondant à la plateforme d\'amplification.', 'Blueprint AV calcule angles, rigging et prédictions.'],
  },
  {
    name: 'Martin Audio', country: 'Royaume-Uni',
    prediction: 'DISPLAY', control: 'VU-NET', processing: 'Amplificateurs iKON',
    tips: ['Les systèmes MLA/WPC sont optimisés par DISPLAY (zones d\'audience) : charger l\'optimisation dans les amplis via VU-NET.'],
  },
  {
    name: 'JBL Professional', country: 'USA',
    prediction: 'Line Array Calculator (LAC)', control: 'Performance Manager', processing: 'Amplificateurs Crown',
    tips: ['Utiliser les presets JBL dans les amplis Crown / processeurs ; Performance Manager centralise réglages et monitoring.'],
  },
  {
    name: 'RCF', country: 'Italie',
    prediction: 'RCF Shape Designer', control: 'RDNet', processing: 'Enceintes principalement auto-amplifiées avec DSP intégré',
    tips: ['Sur enceintes actives, régler les presets directement sur l\'enceinte ou via RDNet ; éviter de doubler les filtres de coupure dans la console.'],
  },
  {
    name: 'dBTechnologies', country: 'Italie',
    prediction: 'DBTECH Composer', control: 'AURORA NET', processing: 'Enceintes auto-amplifiées avec DSP',
    tips: ['Presets et délais réglables sur l\'enceinte ou à distance ; vérifier la cohérence des presets entre têtes et subs.'],
  },
  {
    name: 'Electro-Voice', country: 'USA',
    prediction: 'LAPS', control: 'IRIS-Net', processing: 'Amplificateurs / processeurs Electro-Voice, Dynacord',
    tips: ['IRIS-Net gère presets, EQ et délais sur les plateformes compatibles.'],
  },
  {
    name: 'Outline', country: 'Italie',
    prediction: 'Openarray3D', control: 'Newton / logiciels Outline', processing: 'Processeur Newton',
    tips: ['Openarray3D pour la prédiction line array ; Newton pour le traitement système.'],
  },
  {
    name: 'Alcons Audio', country: 'Pays-Bas',
    prediction: 'EASE Focus (données fournies)', control: 'Logiciel Alcons', processing: 'Contrôleurs amplifiés Sentinel',
    tips: ['Les contrôleurs Sentinel embarquent les presets et protections des enceintes à ruban.'],
  },
  {
    name: 'Multi-marques (outils génériques)', country: '—',
    prediction: 'EASE Focus (AFMG), gratuit, données de nombreuses marques', control: '—', processing: '—',
    tips: [
      'Outils de mesure de référence à connaître : Smaart, Open Sound Meter (gratuit), REW (gratuit). Cette app accepte les fichiers texte « fréquence dB » (calibration micro, courbes cibles) au même format.',
      'Un micro de mesure USB ou une interface + micro omni calibré améliore fortement la précision par rapport au micro du téléphone.',
    ],
  },
];

export const GENERAL_TIPS = [
  { title: 'Presets constructeur d\'abord', text: 'Le filtrage d\'enceinte (coupures, protections, EQ de compensation) est le travail du constructeur. Le calage système ne doit corriger que l\'interaction avec la salle, entre enceintes et la couleur globale.' },
  { title: 'Ordre de calage', text: '1) Polarité et câblage de chaque enceinte, 2) niveau et angle (design), 3) délais entre éléments (tête/sub, rappels, fills), 4) EQ globale vers la cible, 5) vérification à l\'écoute avec une musique connue.' },
  { title: 'Mesurer à plusieurs positions', text: 'Une EQ basée sur un seul point de mesure corrige surtout ce point. Moyenner 3 à 6 positions dans la zone d\'audience, à 1–2 m d\'écart minimum.' },
  { title: 'Ne pas remplir les creux', text: 'Un creux étroit est souvent une annulation acoustique (réflexion, interférence) : l\'EQ n\'y peut rien, on ne fait que consommer de la puissance. Corriger plutôt les bosses.' },
  { title: 'Tête / sub', text: 'Choisir la fréquence de raccord avec les presets constructeurs, puis aligner le délai et la polarité à la mesure au centre de la zone d\'audience (pas au pied des enceintes).' },
  { title: 'Rappels (delays)', text: 'Retarder le rappel pour qu\'il arrive en même temps que la façade à la position d\'écoute, ou légèrement après (quelques ms, effet de précédence) pour garder la localisation sur la scène. Niveau du rappel : juste assez pour compléter, pas dominer.' },
  { title: 'Température', text: 'La vitesse du son varie d\'environ 0,6 m/s par °C. Sur des rappels à 50 m, 10 °C d\'écart = ~2,6 ms. Mettre à jour la température dans les réglages.' },
  { title: 'Sécurité auditive', text: 'Démarrer les signaux à bas niveau et monter progressivement. Porter des protections lors des mesures prolongées au bruit rose.' },
];
