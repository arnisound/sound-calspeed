import { h, card } from '../ui/dom.js';

export default {
  id: 'guide',
  title: 'Guide',
  mount(root) {
    const step = (title, text, href) => h('li', h('strong', href ? h('a', { href }, title) : title), h('div.muted', text));
    root.append(
      h('h2', 'Caler un système son avec un téléphone'),
      card(null,
        h('p', 'Le téléphone joue les signaux de test dans la console par sa sortie casque, et mesure la réponse de la diffusion avec son micro. Comme l\'émission et la réception utilisent la même horloge audio, l\'app mesure la réponse en fréquence, la phase et les temps d\'arrivée, et peut donc calculer délais et polarités.'),
        h('div.callout.warn', h('strong', 'À savoir. '), 'Le micro d\'un téléphone n\'est pas un micro de mesure : grave souvent atténué sous ~100 Hz, aigu variable selon les modèles. Les délais et polarités restent fiables ; pour l\'EQ absolue, importer un fichier de calibration (Réglages) ou comparer des mesures entre elles.'),
      ),
      card('Déroulé conseillé',
        h('ol.steps',
          step('Brancher', 'Sortie casque du téléphone → DI / entrées ligne de la console. Câble TRS 3 pôles. Voir le mémo câblage.', '#/memo'),
          step('Démarrer l\'audio et vérifier', 'Choisir la sortie (G, D ou les deux), régler le niveau au bruit rose, lancer le test de boucle (latence, rapport signal/bruit).', '#/audio'),
          step('Écouter / RTA', 'Bruit rose + analyseur temps réel pour un premier état des lieux et le contrôle des niveaux.', '#/rta'),
          step('Mesurer', 'Mesures par sweep (balayage sinus) : une par enceinte ou groupe, sans bouger le téléphone entre les mesures à comparer.', '#/mesure'),
          step('Polarité et mise en phase', 'Tête/sub (délai + polarité au raccord), rappels et fills (temps d\'arrivée).', '#/alignement'),
          step('Sub cardio (option)', 'Calculateur théorique et optimisation à la mesure derrière le dispositif.', '#/cardio'),
          step('Acoustique de salle', 'Temps de réverbération, clarté, conseils et compensation de la cible en salle réverbérante.', '#/salle'),
          step('Égalisation', 'Moyenne de plusieurs positions, choix d\'une courbe cible, calcul d\'EQ paramétrique et graphique.', '#/eq'),
        ),
      ),
      card('Règles d\'or',
        h('ul',
          h('li', 'Toujours démarrer un signal à bas niveau ; le bouton rouge « STOP » (ou la touche Échap) coupe immédiatement.'),
          h('li', 'Ne pas utiliser de sortie Bluetooth : latence instable, délais faux.'),
          h('li', 'Désactiver les sons, notifications et la mise en veille du téléphone ; mode avion recommandé.'),
          h('li', 'Pour comparer deux sources (tête/sub, façade/rappel), ne pas bouger le téléphone ni recharger la page entre les mesures : la latence de boucle doit rester identique.'),
          h('li', 'L\'app fonctionne hors ligne une fois chargée (installer sur l\'écran d\'accueil).'),
        ),
      ),
    );
  },
};
