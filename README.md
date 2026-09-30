# CalSpeed — calage de système son avec un smartphone

Webapp (PWA, hors ligne) pour caler une diffusion professionnelle avec **un seul téléphone** :
la sortie casque du téléphone est branchée sur la console, le micro du téléphone sert de micro de mesure.
Émission et réception partagent la même horloge audio : la latence de boucle est constante pendant la session,
ce qui permet de mesurer réponse en fréquence, phase et **temps d'arrivée relatifs** entre enceintes.

## Fonctions

| Onglet | Contenu |
|---|---|
| **Audio** | Démarrage micro (écho / réduction de bruit / gain auto désactivés), vumètre, sortie G / D / G+D, générateur (bruit rose, blanc, sinus, impulsions de polarité), test de boucle (latence, stabilité, SNR) |
| **RTA** | Analyseur temps réel 1/3 à 1/24 oct, moyennage, crête, courbes figées, cible superposée, fréquence dominante (larsen) |
| **Mesure** | Fonction de transfert par sweep log (Farina), moyenne de répétitions, magnitude / phase / impulsion, fenêtrage FDW / fixe / long, lissage, moyenne spatiale, export texte |
| **Alignement** | Tête / sub (délai + polarité optimisant la sommation au raccord, raccord détecté auto, solutions alternatives), rappels / fills (temps d'arrivée + effet de précédence, calcul par distance), contrôle de polarité |
| **Cardio** | Calcul théorique gradient et end-fire (délais, polarités, courbes avant/arrière), optimisation à la mesure derrière le dispositif |
| **EQ** | Courbes cibles (plat, house curve, live, club, parole, théâtre, X-curve), cibles importées / personnalisées, EQ paramétrique automatique (coupes privilégiées, boosts limités) et EQ graphique 31 bandes |
| **Salle** | EDT / T20 / T30 par octave, C50, C80, D50, fréquence de Schroeder, conseils, compensation de la cible pour salle réverbérante |
| **Mémo** | Schémas de câblage (téléphone → console, chaîne de diffusion, dispositions de subs), brochages, écosystèmes constructeurs, calculateurs |

Les courbes cibles fournies sont des pratiques courantes ou des normes publiées, **pas** des données officielles
de constructeurs (dont les presets d'enceintes sont dans leurs DSP). Toute courbe au format texte « fréquence dB »
peut être importée comme cible (ex. export d'un logiciel de prédiction) ou comme calibration du micro.

## Lancer

Aucune dépendance ni build : fichiers statiques. Le micro exige **HTTPS** (ou `localhost`).

```bash
npm start            # http://localhost:8080
npm test             # tests unitaires DSP (Node ≥ 20)
npm run test:e2e     # test navigateur avec boucle acoustique simulée (Playwright + Chromium)
```

Pour l'utiliser sur un téléphone : héberger le dossier en HTTPS, ouvrir la page, puis « Ajouter à l'écran d'accueil ».

### Déploiement GitHub Pages

Le workflow `.github/workflows/pages.yml` publie le site à chaque push sur `main` (après les tests).
Activation, une seule fois : *Settings → Pages → Build and deployment → Source : **GitHub Actions***.
L'app est alors servie en HTTPS sur `https://<utilisateur>.github.io/sound-calspeed/`.

## Limites

- Micro du téléphone : grave atténué et aigu variable selon le modèle. Délais et polarités restent fiables ;
  pour l'EQ absolue, importer une calibration ou utiliser un micro de mesure USB.
- Pas de Bluetooth (latence instable). Câble TRS 3 pôles pour garder le micro interne.
- Ne pas recharger la page entre deux mesures à comparer (la latence de boucle changerait).

## Structure

```
js/dsp/     FFT, signaux, déconvolution, alignement, EQ, acoustique de salle (pur, testé sous Node)
js/audio/   moteur Web Audio + AudioWorklet de capture synchronisée
js/views/   onglets de l'interface
js/data/    cibles, constructeurs, câblage
```
