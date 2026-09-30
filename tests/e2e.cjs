// End-to-end smoke test in headless Chromium.
// A virtual acoustic loop replaces the room: engine output → simulated
// speaker (filters + delay) → capture worklet. Checks that every view renders
// without errors and that the measured main/sub delay matches the simulation.
// Run: npm run test:e2e   (needs Playwright + Chromium)
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
      if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(url);
  await page.waitForSelector('#tabs a');
  const tabs = await page.$$eval('#tabs a', (as) => as.map((a) => a.getAttribute('href')));
  for (const t of tabs) {
    await page.goto(url + t);
    await page.waitForTimeout(150);
  }
  console.log('views rendered:', tabs.join(' '));

  // start audio and install the virtual acoustic loop
  await page.goto(url + '#/audio');
  await page.click('#audio-toggle');
  await page.waitForFunction(() => window.calspeed.engine.running);
  await page.evaluate(() => {
    const e = window.calspeed.engine;
    const ctx = e.ctx;
    e.micSource.disconnect();
    const sum = ctx.createChannelMerger(1);
    const mono = ctx.createGain();
    e.merger.connect(mono);
    // "speaker" chain configured per test through window.sim
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 100; hp.Q.value = 0.707;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 100; lp.Q.value = 0.707;
    const delay = ctx.createDelay(1);
    const gain = ctx.createGain();
    // simple room: exponentially decaying noise convolver
    const len = Math.round(ctx.sampleRate * 1.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
    for (let i = 0; i < len; i++) d[i] = (i === 0 ? 1 : 0) + 0.05 * rnd() * Math.exp(-6.9 * (i / ctx.sampleRate) / 0.8);
    const room = ctx.createConvolver(); room.normalize = false; room.buffer = buf;
    const noise = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 1e-4;
    noise.buffer = nb; noise.loop = true; noise.start();
    noise.connect(e.capture);
    window.sim = {
      set(kind, ms) {
        mono.disconnect(); hp.disconnect(); lp.disconnect();
        const f = kind === 'main' ? hp : kind === 'sub' ? lp : null;
        if (f) { mono.connect(f); f.connect(delay); } else mono.connect(delay);
        delay.delayTime.value = ms / 1000;
        delay.connect(gain); gain.connect(room); room.connect(e.capture); room.connect(e.analyser);
      },
    };
    void sum;
  });

  // measure main (10 ms) then sub (5 ms): the sub must be delayed by ~5 ms
  async function measure(kind, ms, name, tag) {
    await page.evaluate(([k, d]) => window.sim.set(k, d), [kind, ms]);
    await page.evaluate(async ([n, t]) => {
      const { buildMeasurement } = await import('./js/audio/engine.js');
      const app = window.calspeed;
      const res = await app.engine.measureSweep({ seconds: 1, tail: 1.5, levelDb: -12, repeats: 1 });
      const m = buildMeasurement(res, { name: n, keepSeconds: 1.2 });
      m.tag = t;
      await app.saveMeasurement(m);
    }, [name, tag]);
  }
  await measure('main', 10, 'Tête', 'main');
  await measure('sub', 5, 'Sub', 'sub');
  await measure('full', 2, 'Salle', 'room');

  const snr = await page.evaluate(() => window.calspeed.measurements.map((m) => `${m.name}: SNR ${m.snr.toFixed(0)} dB, jitter ${m.jitterMs}`));
  console.log(snr.join('\n'));

  await page.goto(url + '#/alignement');
  await page.waitForTimeout(200);
  await page.click('text=Calculer délai et polarité');
  await page.waitForSelector('.result');
  const res = await page.textContent('.result');
  console.log('Tête/Sub →', res.replace(/\s+/g, ' '));
  const m = res.match(/Retarder le sub de ([\d.]+) ms/);
  if (!m || Math.abs(parseFloat(m[1]) - 5) > 0.4) errors.push(`unexpected alignment result: ${res}`);

  await page.goto(url + '#/eq');
  await page.waitForTimeout(200);
  await page.click('text=Calculer l\'EQ');
  await page.waitForSelector('text=Correction proposée');
  console.log('EQ →', (await page.textContent('text=/Écart RMS/')).trim());

  await page.goto(url + '#/salle');
  await page.waitForTimeout(200);
  await page.click('button:has-text("Analyser")');
  await page.waitForSelector('text=Synthèse');
  const rt = await page.textContent('.result');
  console.log('Salle →', rt.replace(/\s+/g, ' '));
  const rtVal = parseFloat((rt.match(/([\d.]+) s/) || [])[1]);
  if (!(Math.abs(rtVal - 0.8) < 0.2)) errors.push(`unexpected RT: ${rt}`);

  await page.goto(url + '#/cardio');
  await page.waitForTimeout(200);
  await page.goto(url + '#/rta');
  await page.evaluate(() => window.calspeed.engine.play('pink', { levelDb: -20 }));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(process.env.SHOT_DIR || root, 'e2e-rta.png'), fullPage: true });
  await page.evaluate(() => window.calspeed.engine.stopSignal());
  await page.goto(url + '#/alignement');
  await page.click('text=Calculer délai et polarité');
  await page.waitForSelector('.result');
  await page.screenshot({ path: path.join(process.env.SHOT_DIR || root, 'e2e-align.png'), fullPage: true });

  await browser.close();
  srv.close();
  if (errors.length) {
    console.error('FAILED\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
