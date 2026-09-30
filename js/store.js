// Persistence: measurements in IndexedDB (they hold impulse responses),
// settings in localStorage.

const DB_NAME = 'sound-calspeed';
const STORE = 'measurements';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

export const measurementsDb = {
  all: () => tx('readonly', (s) => s.getAll()),
  put: (m) => tx('readwrite', (s) => s.put(m)),
  delete: (id) => tx('readwrite', (s) => s.delete(id)),
  clear: () => tx('readwrite', (s) => s.clear()),
};

const SETTINGS_KEY = 'sound-calspeed:settings';

export const DEFAULT_SETTINGS = {
  temperature: 20,
  sweepSeconds: 2,
  sweepTail: 2,
  sweepLevel: -12,
  sweepRepeats: 2,
  generatorLevel: -20,
  outputChannel: 'both',
  smoothing: 6,
  windowMode: 'fdw', // fdw | fixed | long
  fdwCycles: 8,
  fixedWindowMs: 50,
  micCal: null, // { name, points: [[f, dB], ...] }
  targetId: 'flat',
  customTarget: [[20, 0], [20000, 0]],
  importedTargets: [],
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* storage unavailable (private mode) */ }
}

/** Parse a text file of "freq dB" pairs (mic calibration, target curve, exports). */
export function parseCurveText(text) {
  const points = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^[*#;"a-zA-Z]/.test(t)) continue;
    const parts = t.split(/[\s,;\t]+/).map(Number);
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[0] > 0) {
      points.push([parts[0], parts[1]]);
    }
  }
  points.sort((a, b) => a[0] - b[0]);
  return points;
}
