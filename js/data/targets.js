// Target curves (dB relative, ~0 dB around 1 kHz). Each is a function of f.
// These are common tuning practices / published standards, not official
// manufacturer data: manufacturers' own speaker presets live in their DSP.
// Any curve can also be imported as a text file (freq dB), e.g. an export
// from a prediction software or a curve provided by a manufacturer.

const oct = (f, ref) => Math.log2(f / ref);
// smooth shelf: +gain below fc, transition ~1 octave wide
const lowShelf = (f, fc, gain) => gain / (1 + Math.pow(f / fc, 2));
const highTilt = (f, from, dbPerOct) => (f > from ? dbPerOct * oct(f, from) : 0);
const hp2 = (f, fc) => 10 * Math.log10(Math.pow(f / fc, 4) / (1 + Math.pow(f / fc, 4)));

export const BUILTIN_TARGETS = [
  {
    id: 'flat',
    name: 'Plat',
    desc: 'Réponse plate. Référence pour vérifier une enceinte seule, ou en proche champ.',
    fn: () => 0,
  },
  {
    id: 'house',
    name: 'Pente douce −1 dB/oct (house curve)',
    desc: 'Pente continue centrée sur 1 kHz. Tonalité naturelle en champ lointain pour la plupart des systèmes de sonorisation.',
    fn: (f) => -1 * oct(f, 1000),
  },
  {
    id: 'live',
    name: 'Concert / live',
    desc: 'Grave renforcé (+6 dB sous ~80 Hz), aigu descendant (−1,5 dB/oct au-dessus de 2 kHz). Pratique courante en concert amplifié.',
    fn: (f) => lowShelf(f, 90, 6) + highTilt(f, 2000, -1.5),
  },
  {
    id: 'club',
    name: 'Club / électro',
    desc: 'Sub très présent (+10 dB sous ~70 Hz), aigu légèrement descendant.',
    fn: (f) => lowShelf(f, 75, 10) + highTilt(f, 4000, -1.5),
  },
  {
    id: 'speech',
    name: 'Parole / conférence',
    desc: 'Coupe-bas 2e ordre à 90 Hz, légère présence 2–4 kHz, aigu adouci. Favorise l\'intelligibilité.',
    fn: (f) => hp2(f, 90) + 2 * Math.exp(-Math.pow(oct(f, 2800) / 0.8, 2)) + highTilt(f, 8000, -2),
  },
  {
    id: 'theatre',
    name: 'Théâtre / comédie musicale',
    desc: 'Proche du plat, pente légère −0,5 dB/oct, sub modéré (+3 dB).',
    fn: (f) => lowShelf(f, 80, 3) - 0.5 * oct(f, 1000),
  },
  {
    id: 'xcurve',
    name: 'Cinéma « X-curve » (ISO 2969 / SMPTE ST 202, approx.)',
    desc: 'Plat jusqu\'à 2 kHz, −3 dB/oct jusqu\'à 10 kHz puis −6 dB/oct. Pour grandes salles de cinéma (mesure en champ réverbéré).',
    fn: (f) => (f <= 2000 ? 0 : f <= 10000 ? -3 * oct(f, 2000) : -3 * oct(10000, 2000) - 6 * oct(f, 10000)),
  },
];

/** Build a target function from [[f, dB], ...] points (log-linear interpolation). */
export function pointsTarget(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  return (f) => {
    if (!pts.length) return 0;
    if (f <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (f <= pts[i][0]) {
        const [f0, d0] = pts[i - 1];
        const [f1, d1] = pts[i];
        return d0 + ((d1 - d0) * Math.log(f / f0)) / Math.log(f1 / f0);
      }
    }
    return pts[pts.length - 1][1];
  };
}

/** All available targets given settings (builtin + custom + imported). */
export function allTargets(settings) {
  const list = [...BUILTIN_TARGETS];
  list.push({ id: 'custom', name: 'Personnalisée', desc: 'Points définis dans l\'onglet EQ.', fn: pointsTarget(settings.customTarget || []) });
  for (const t of settings.importedTargets || []) {
    list.push({ id: t.id, name: t.name, desc: t.desc || 'Courbe importée.', fn: pointsTarget(t.points), imported: true });
  }
  return list;
}

export function targetCurve(target, freqs) {
  return Float64Array.from(freqs, (f) => target.fn(f));
}
