// Error reporting module: keeps the last errors of this page so a member can send them in one click.
// Nothing is uploaded; the member decides to send the report. The same file lives in ig-sorter,
// jev-model-router and brand-digest-extension: change all three.
// Stores no user content: URLs lose their query (API keys travel there), long tokens are masked,
// messages are cut to 200 characters.
const KEY = 'errorLog';
const MAX = 20;
export const SUPPORT_EMAIL = 'tekuei.xx@gmail.com';

export type ErrorEntry = { at: number; where: string; message: string };

export const clean = (text: string) =>
  text.replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g, '$1').replace(/[A-Za-z0-9_-]{24,}/g, '[…]').slice(0, 200);

const memory: ErrorEntry[] = []; // `npm run dev` pages without chrome.storage
const hasStorage = () => !!globalThis.chrome?.storage;

async function load(): Promise<ErrorEntry[]> {
  return hasStorage() ? ((await chrome.storage.local.get([KEY]))[KEY] as ErrorEntry[] | undefined) ?? [] : memory;
}

export async function record(error: unknown, where = 'page') {
  const message = clean(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  const log = [...(await load()), { at: Date.now(), where, message }].slice(-MAX);
  if (hasStorage()) await chrome.storage.local.set({ [KEY]: log });
  else memory.splice(0, memory.length, ...log);
}

/** Call once per page, first thing: uncaught errors, rejected promises and console.error land in the log. */
export function captureErrors() {
  // `.catch`: a failing log write must not raise a new error, or the handlers would loop.
  addEventListener('error', (e) => void record(e.error ?? e.message).catch(() => {}));
  addEventListener('unhandledrejection', (e) => void record(e.reason, 'promise').catch(() => {}));
  const original = console.error;
  console.error = (...args: unknown[]) => {
    void record(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '), 'console').catch(() => {});
    original(...args);
  };
}

export function formatReport(log: ErrorEntry[], meta: Record<string, string>) {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
  const errors = log.slice(-10).map((e) => `${new Date(e.at).toISOString()} [${e.where}] ${e.message}`);
  return [...lines, '', errors.length ? 'Recent errors:' : 'No errors recorded.', ...errors].join('\n');
}

export async function buildReport() {
  return formatReport(await load(), {
    tool: document.title,
    version: globalThis.chrome?.runtime?.getManifest?.().version ?? 'dev',
    browser: navigator.userAgent.match(/Edg\/[\d.]+|Chrome\/[\d.]+/)?.[0] ?? 'unknown',
    language: navigator.language,
    time: new Date().toISOString(),
  });
}
