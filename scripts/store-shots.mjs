// Chrome Web Store screenshots, 1280x800, from the dev preview with its sample data (src/dev/mock.ts).
//   node scripts/store-shots.mjs [out-dir]        (default: the next free ../store-assets/<repo>/vN)
// Writes tw/screenshot-1.png … 5 and en/screenshot-1.png … 5: one highlight each, the app inside the store frame.
// Never writes into a folder that exists, so earlier versions stay as they were.
// Drives the installed Chrome over the DevTools protocol, so it needs no extra npm package. Set CHROME to override its path.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const ASSETS = resolve(ROOT, '../store-assets', basename(ROOT));
const nextVersion = () => { let n = 1; while (existsSync(join(ASSETS, `v${n}`))) n++; return join(ASSETS, `v${n}`); };
const OUT = resolve(process.argv[2] ?? nextVersion());
if (existsSync(OUT)) throw new Error(`${OUT} already exists; pick a new folder so the old shots are kept`);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 5189, DEBUG = 9333;
const APP = `http://localhost:${PORT}/app.html`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// Page helpers. Labels come from the app's own messages, so the same steps work in both languages.
const HELPERS = `
  const msg = k => chrome.i18n.getMessage(k);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const button = pick => [...document.querySelectorAll('button')].find(pick);
  const tab = async k => { button(b => b.textContent.trim().startsWith(msg(k))).click(); await wait(600); };
  const openNote = async () => { const b = button(b => b.textContent.includes(msg('noteTitle'))); if (b.getAttribute('aria-expanded') !== 'true') b.click(); await wait(600); };
`;
// One highlight per screenshot: what to do in the app, and the headline for each language.
const SHOTS = [
  { steps: '', zh: '收藏的貼文，<br>自動分好類。', en: 'Sort your saved posts<br>into topics, automatically.' },
  { steps: `await tab('tabBookmarks'); await openNote();`, zh: '每個主題，<br>整理成一份筆記。', en: 'Turn each topic<br>into a one-page note.' },
  { steps: `await tab('tabBookmarks'); await openNote();
      const h = [...document.querySelectorAll('*')].find(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === msg('noteTensions')));
      h.scrollIntoView({ block: 'start' }); document.scrollingElement.scrollBy(0, -140); await wait(400);`,
    zh: '說法哪裡不同、<br>這週先做什麼，一眼看懂。', en: 'See where advice disagrees,<br>and what to do this week.' },
  { steps: `await tab('tabFollowing');`, zh: '你追蹤的帳號，<br>也幫你分好類。', en: 'Know who you follow,<br>by topic.' },
  { steps: `const b = button(b => (b.getAttribute('aria-label') ?? '').includes(msg('moveTo')));
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); await wait(600);`,
    zh: '分錯了？<br>一鍵改分類。', en: 'Wrong topic?<br>Fix it in one click.' },
];

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
async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function shot(url, file, { width = 1280, height = 800, scale = 1, ready, steps = '' }) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', { url });
  await until(() => evaluate(ready), `${file} to render`);
  if (steps) await evaluate(`(async () => { ${HELPERS} ${steps} })()`);
  await sleep(800); // covers and fonts settle
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(data, 'base64'));
}

try {
  await until(() => fetch(APP).then(r => r.ok), 'the dev server');
  const target = await until(() => fetch(`http://127.0.0.1:${DEBUG}/json/list`).then(r => r.json()).then(t => t.find(x => x.type === 'page')), 'Chrome');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = e => { const msg = JSON.parse(e.data); pending.get(msg.id)?.(msg); pending.delete(msg.id); };
  await new Promise(r => (ws.onopen = r));

  const inner = join(OUT, 'inner.png');
  for (const lang of ['zh', 'en']) {
    for (const [i, s] of SHOTS.entries()) {
      await shot(`${APP}${lang === 'en' ? '?lang=en' : ''}`, inner,
        { width: 1100, height: 720, scale: 2, steps: s.steps, ready: `document.querySelectorAll('img').length > 5` });
      const frame = new URL(pathToFileURL(join(ROOT, 'scripts/store-frame.html')));
      frame.search = new URLSearchParams({
        title: s[lang],
        orb: pathToFileURL(join(ROOT, 'public/icons/icon-128.png')).href,
        shot: pathToFileURL(inner).href,
      }).toString();
      const dir = join(OUT, lang === 'zh' ? 'tw' : 'en');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `screenshot-${i + 1}.png`);
      await shot(frame.href, file, { ready: `[...document.images].every(i => i.complete && i.naturalWidth)` });
      console.log('saved', file);
    }
  }
  rmSync(inner);
} finally {
  ws?.close();
  kill(chrome);
  kill(server);
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
