// Chrome Web Store screenshots, 1280x800, from the dev preview with its sample data (src/dev/mock.ts).
//   node scripts/store-shots.mjs [out-dir]        (default .local/store-shots)
// Writes zh-dark.png (the app itself) and en-framed.png (English app inside the store frame).
// Drives the installed Chrome over the DevTools protocol, so it needs no extra npm package. Set CHROME to override its path.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(process.argv[2] ?? join(ROOT, '.local/store-shots'));
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 5189, DEBUG = 9333;
const APP = `http://localhost:${PORT}/app.html`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

async function until(probe, what) {
  for (let i = 0; i < 80; i++) { try { const v = await probe(); if (v) return v; } catch { /* not up yet */ } await sleep(250); }
  throw new Error(`timed out waiting for ${what}`);
}

const profile = mkdtempSync(join(tmpdir(), 'store-shots-'));
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const kill = p => process.platform === 'win32' ? spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { shell: true }) : p.kill();

// Minimal DevTools protocol client over Node's built-in WebSocket.
let ws, nextId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((ok, fail) => {
  const id = ++nextId;
  pending.set(id, msg => (msg.error ? fail(new Error(`${method}: ${msg.error.message}`)) : ok(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

async function shot(url, file, { width = 1280, height = 800, scale = 1, dark = false, ready }) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await send('Page.navigate', { url });
  await until(() => evaluate(ready), `${file} to render`);
  await sleep(800); // covers and fonts settle
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('saved', file);
}

try {
  await until(() => fetch(APP).then(r => r.ok), 'the dev server');
  const target = await until(() => fetch(`http://127.0.0.1:${DEBUG}/json/list`).then(r => r.json()).then(t => t.find(x => x.type === 'page')), 'Chrome');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = e => { const msg = JSON.parse(e.data); pending.get(msg.id)?.(msg); pending.delete(msg.id); };
  await new Promise(r => (ws.onopen = r));

  const appReady = `document.querySelectorAll('img').length > 5`; // the saved grid has drawn its covers
  await shot(APP, join(OUT, 'zh-dark.png'), { dark: true, ready: appReady });

  const inner = join(OUT, 'en-inner.png');
  await shot(`${APP}?lang=en`, inner, { width: 1100, height: 720, scale: 2, ready: appReady });
  const frame = new URL(pathToFileURL(join(ROOT, 'scripts/store-frame.html')));
  frame.search = new URLSearchParams({
    title: 'Sort your saved posts<br>into topics, automatically.',
    orb: pathToFileURL(join(ROOT, 'public/icons/icon-128.png')).href,
    shot: pathToFileURL(inner).href,
  }).toString();
  await shot(frame.href, join(OUT, 'en-framed.png'), { ready: `[...document.images].every(i => i.complete && i.naturalWidth)` });
  rmSync(inner);
} finally {
  ws?.close();
  kill(chrome);
  kill(server);
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
