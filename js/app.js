// Application shell: global state, audio start/stop, tab routing.
import { AudioEngine } from './audio/engine.js';
import { loadSettings, saveSettings, measurementsDb } from './store.js';
import { allTargets } from './data/targets.js';
import { toast } from './ui/dom.js';

import guide from './views/guide.js';
import audio from './views/audio.js';
import rta from './views/rta.js';
import measure from './views/measure.js';
import align from './views/align.js';
import cardio from './views/cardio.js';
import eq from './views/eq.js';
import room from './views/room.js';
import memo from './views/memo.js';
import settingsView from './views/settings.js';

const VIEWS = [guide, audio, rta, measure, align, cardio, eq, room, memo, settingsView];

export const app = {
  engine: new AudioEngine(),
  settings: loadSettings(),
  measurements: [],
  visible: new Set(), // ids of measurements shown on plots
  bus: new EventTarget(),

  on(type, fn) {
    this.bus.addEventListener(type, fn);
    return () => this.bus.removeEventListener(type, fn);
  },
  emit(type) {
    this.bus.dispatchEvent(new Event(type));
  },
  updateSettings(patch) {
    Object.assign(this.settings, patch);
    saveSettings(this.settings);
    this.emit('settings');
  },
  async reloadMeasurements() {
    try {
      this.measurements = (await measurementsDb.all()).sort((a, b) => a.createdAt - b.createdAt);
    } catch (e) {
      console.warn('IndexedDB indisponible', e);
    }
    this.emit('measurements');
  },
  async saveMeasurement(m) {
    try {
      const id = await measurementsDb.put(m);
      if (m.id == null) m.id = id;
    } catch (e) {
      // keep it in memory anyway (private browsing without IndexedDB)
      if (m.id == null) m.id = Date.now();
      toast('Stockage indisponible : la mesure ne sera pas conservée après fermeture.', 'warn');
    }
    if (!this.measurements.includes(m)) this.measurements.push(m);
    this.emit('measurements');
    return m;
  },
  async deleteMeasurement(m) {
    try { await measurementsDb.delete(m.id); } catch { /* ignore */ }
    this.measurements = this.measurements.filter((x) => x !== m);
    this.emit('measurements');
  },
  targets() {
    return allTargets(this.settings);
  },
  currentTarget() {
    const list = this.targets();
    return list.find((t) => t.id === this.settings.targetId) || list[0];
  },
  async ensureAudio() {
    if (this.engine.running) return true;
    try {
      await this.engine.start(this.settings.inputDeviceId);
      return true;
    } catch (e) {
      toast(`Audio : ${e.message || e}`, 'error', 6000);
      return false;
    }
  },
};

window.calspeed = app; // handy for debugging from the console

// ---- Top bar ----
const statusEl = document.getElementById('audio-status');
const toggleBtn = document.getElementById('audio-toggle');
const panic = document.getElementById('panic');

function renderStatus() {
  const e = app.engine;
  if (e.running) {
    statusEl.textContent = `Audio actif · ${Math.round(e.sampleRate / 100) / 10} kHz`;
    statusEl.className = 'pill on';
    toggleBtn.textContent = 'Audio actif';
    toggleBtn.classList.remove('primary');
  } else {
    statusEl.textContent = 'Audio arrêté';
    statusEl.className = 'pill off';
    toggleBtn.textContent = 'Démarrer l\'audio';
    toggleBtn.classList.add('primary');
  }
  panic.hidden = !e.player;
}

toggleBtn.addEventListener('click', async () => {
  if (!app.engine.running) {
    await app.ensureAudio();
    app.engine.setOutputChannel(app.settings.outputChannel);
  } else {
    location.hash = '#/audio';
  }
});
panic.addEventListener('click', () => app.engine.stopSignal());
app.engine.addEventListener('state', renderStatus);
app.engine.addEventListener('signal', renderStatus);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') app.engine.stopSignal();
});

// ---- Router ----
const tabsEl = document.getElementById('tabs');
const viewEl = document.getElementById('view');
let cleanup = null;

for (const v of VIEWS) {
  const a = document.createElement('a');
  a.href = `#/${v.id}`;
  a.textContent = v.title;
  a.dataset.id = v.id;
  tabsEl.appendChild(a);
}

function route() {
  const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || 'guide';
  const view = VIEWS.find((v) => v.id === id) || VIEWS[0];
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } }
  cleanup = null;
  viewEl.innerHTML = '';
  for (const a of tabsEl.children) {
    const on = a.dataset.id === view.id;
    a.classList.toggle('active', on);
    if (on) a.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  document.title = `${view.title} · CalSpeed`;
  try {
    cleanup = view.mount(viewEl, app) || null;
  } catch (e) {
    console.error(e);
    viewEl.textContent = `Erreur : ${e.message}`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
app.reloadMeasurements().then(route);
renderStatus();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
