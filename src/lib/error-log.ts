// Error reporting module: keeps the last errors of this page. After the member agrees once, new errors
// also go to the error inbox (router.tekuei.com), where a daily AI routine picks them up.
// The same file lives in instagram-gist, jev-model-router and brand-digest-extension: change all three.
// Stores and sends no user content: URLs lose their query (API keys travel there), long tokens are
// masked, messages are cut to 200 characters. The inbox repeats these rules.
const KEY = 'errorLog';
const CONSENT_KEY = 'errorReporting';
const MAX = 20;
const ENDPOINT = 'https://router.tekuei.com/api/errors';
export const SUPPORT_EMAIL = 'tekuei.xx@gmail.com';
export const ASK_EVENT = 'error-log:ask';

export type ErrorEntry = { at: number; where: string; message: string };
export type Consent = 'on' | 'off' | undefined;

export const clean = (text: string) =>
  text.replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g, '$1').replace(/[A-Za-z0-9_-]{24,}/g, '[…]').slice(0, 200);

let tool = 'unknown';
let pendingAsk = false;
const memory: ErrorEntry[] = []; // `npm run dev` pages without chrome.storage
const hasStorage = () => !!globalThis.chrome?.storage;
const meta = () => ({
  tool,
  version: globalThis.chrome?.runtime?.getManifest?.().version ?? 'dev',
  browser: navigator.userAgent.match(/Edg\/[\d.]+|Chrome\/[\d.]+/)?.[0] ?? 'unknown',
});

async function load(): Promise<ErrorEntry[]> {
  return hasStorage() ? ((await chrome.storage.local.get([KEY]))[KEY] as ErrorEntry[] | undefined) ?? [] : memory;
}

export async function getReporting(): Promise<Consent> {
  return hasStorage() ? ((await chrome.storage.local.get([CONSENT_KEY]))[CONSENT_KEY] as Consent) : undefined;
}

/** The member's answer. Saying yes also sends the errors already in the log. */
export async function setReporting(on: boolean) {
  pendingAsk = false;
  if (hasStorage()) await chrome.storage.local.set({ [CONSENT_KEY]: on ? 'on' : 'off' });
  if (on) send((await load()).slice(-10));
}

/** True when an error happened before anyone was listening for ASK_EVENT. */
export const needsAsk = () => pendingAsk;

function send(entries: ErrorEntry[]) {
  if (import.meta.env.DEV || !entries.length) return; // errors while developing stay out of the inbox
  const body = JSON.stringify({ ...meta(), entries: entries.map(({ message, where }) => ({ message, where })) });
  // A plain string body is a CORS "simple request": no preflight and no extra host permission.
  // The reply is opaque and not needed. Never log a failure here: console.error feeds record().
  fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', body }).catch(() => {});
}

export async function record(error: unknown, where = 'page') {
  const entry = { at: Date.now(), where, message: clean(error instanceof Error ? `${error.name}: ${error.message}` : String(error)) };
  const log = [...(await load()), entry].slice(-MAX);
  if (hasStorage()) await chrome.storage.local.set({ [KEY]: log });
  else memory.splice(0, memory.length, ...log);
  const consent = await getReporting();
  if (consent === 'on') send([entry]);
  else if (consent === undefined && !pendingAsk) { pendingAsk = true; dispatchEvent(new Event(ASK_EVENT)); }
}

/** Call once per page, first thing, with the tool's id: uncaught errors, rejected promises and console.error land in the log. */
export function captureErrors(toolId: 'ig-sorter' | 'brand-digest' | 'jev-model-router') {
  tool = toolId;
  // `.catch`: a failing log write must not raise a new error, or the handlers would loop.
  addEventListener('error', (e) => void record(e.error ?? e.message).catch(() => {}));
  addEventListener('unhandledrejection', (e) => void record(e.reason, 'promise').catch(() => {}));
  const original = console.error;
  console.error = (...args: unknown[]) => {
    void record(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '), 'console').catch(() => {});
    original(...args);
  };
}

export function formatReport(log: ErrorEntry[], info: Record<string, string>) {
  const lines = Object.entries(info).map(([k, v]) => `${k}: ${v}`);
  const errors = log.slice(-10).map((e) => `${new Date(e.at).toISOString()} [${e.where}] ${e.message}`);
  return [...lines, '', errors.length ? 'Recent errors:' : 'No errors recorded.', ...errors].join('\n');
}

export async function buildReport() {
  return formatReport(await load(), { ...meta(), title: document.title, language: navigator.language, time: new Date().toISOString() });
}
