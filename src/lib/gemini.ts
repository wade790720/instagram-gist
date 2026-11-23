import { backupModels } from '@/core';
import { t } from './i18n';
import { db, DEFAULTS, emit, status, ui } from './store';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** An expected stop, not a bug: shown in the status bar and never sent as an error report. */
export class Notice extends Error {
  constructor(message: string, readonly alert = false) { super(message); }
}

type Failure = 'busy' | 'daily' | 'gone';
type Attempt = { text: string } | { failed: Failure; code: number; msg: string };

const BUSY_RETRY_SECONDS = 5;
const ALL_BUSY_WAITS = [15, 30, 60];
const MAX_MODELS_PER_CALL = 5;
const REST_MS: Record<Failure, number> = { busy: 5 * 60_000, daily: 60 * 60_000, gone: Infinity };
// A model that just failed sits out for a while, so each later batch doesn't pay for the same failure.
const resting = new Map<string, number>();

/** Reads the models this key can use right now. Free to call; a failed read keeps the last list. */
export async function refreshModels() {
  const key = db.settings.apiKey;
  if (!key) return;
  const names = await listModels(key);
  if (!names.length || key !== db.settings.apiKey) return;
  ui.models = names;
  emit();
}

async function addKeyBackups(chain: string[]) {
  if (!ui.models.length) await refreshModels();
  for (const m of backupModels(ui.models)) {
    if (chain.length < MAX_MODELS_PER_CALL && !chain.includes(m) && (resting.get(m) ?? 0) <= Date.now()) chain.push(m);
  }
}

function modelChain(first: string) {
  const all = [...new Set([first, db.settings.model, db.settings.summaryModel, DEFAULTS.model, DEFAULTS.summaryModel])];
  const awake = all.filter(m => (resting.get(m) ?? 0) <= Date.now());
  return awake.length ? awake : all;
}

async function tryModel(model: string, prompt: string, json: boolean, retryBusy: boolean): Promise<Attempt> {
  for (let attempt = 0; ; attempt++) {
    let r: Response | null = null;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': db.settings.apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: json ? { responseMimeType: 'application/json', temperature: 0 } : {} }),
      });
    } catch {}
    if (r?.ok) return { text: ((await r.json()).candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('') };
    const code = r?.status ?? 0;
    const body = r ? await r.text() : '';
    // Google's own message: names a retired model's replacement, or which limit was hit.
    let msg = body.slice(0, 300);
    try { msg = JSON.parse(body).error.message || msg; } catch {}

    if (code === 404) return { failed: 'gone', code, msg };
    if (code === 429) {
      const told = body.match(/"retryDelay":\s*"([\d.]+)s"/)?.[1];
      const wait = Number(told ?? 20 * (attempt + 1));
      // A daily limit won't clear by waiting. Google marks it PerDay or asks for hours.
      if (/PerDay/i.test(body) || wait > 90) return { failed: 'daily', code, msg };
      if (attempt >= 3) return { failed: 'busy', code, msg };
      status(t('rateLimited', Math.ceil(wait)));
      await sleep(wait * 1000);
      continue;
    }
    if (!code || code >= 500) {
      if (!retryBusy || attempt >= 1) return { failed: 'busy', code, msg };
      await sleep(BUSY_RETRY_SECONDS * 1000);
      continue;
    }
    throw new Error(t('geminiFailed', code, msg));
  }
}

/** Busy, retired or out-of-quota models hand over to the next one. People only see a stop when none is left. */
export async function gemini(prompt: string, json: boolean, first: string): Promise<string> {
  const chain = modelChain(first);
  const out = new Map<string, Extract<Attempt, { failed: Failure }>>();
  let extended = false;
  for (let round = 0; round <= ALL_BUSY_WAITS.length; round++) {
    if (round) {
      status(t('geminiBusy'));
      await sleep(ALL_BUSY_WAITS[round - 1] * 1000);
    }
    for (let i = 0; i < chain.length; i++) {
      const model = chain[i];
      if (out.has(model)) continue;
      const result = await tryModel(model, prompt, json, round === 0);
      if ('text' in result) return result.text;
      resting.set(model, Date.now() + REST_MS[result.failed]);
      if (result.failed !== 'busy') out.set(model, result);
      if (!extended) {
        extended = true;
        await addKeyBackups(chain);
      }
      const next = chain.slice(i + 1).find(m => !out.has(m));
      if (next) status(t(result.failed === 'daily' ? 'fellBackQuota' : 'fellBack', model, next));
    }
    if (chain.every(m => out.has(m))) break;
  }
  if (!chain.every(m => out.has(m))) throw new Notice(t('allBusy'));
  const failures = [...out.values()];
  if (failures.some(f => f.failed === 'daily')) throw new Notice(t('quotaOutAll'), true);
  throw new Error(t('geminiFailed', failures[0].code, failures[0].msg));
}

// Onboarding: listing one model costs no quota and proves the key works before it is saved.
export async function keyProblem(key: string): Promise<string | null> {
  let r: Response;
  try {
    r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } });
  } catch {
    return t('keyOffline');
  }
  if (r.ok) return null;
  if (r.status === 400 || r.status === 401) return t('keyBad');
  if (r.status === 403) return t('keyDenied');
  if (r.status === 429) return t('keyBusy');
  return t('keyOther', r.status);
}

// Free to call, like keyProblem. An empty list (offline, bad key) leaves only the saved choices.
export async function listModels(key: string): Promise<string[]> {
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key } });
    if (!r.ok) return [];
    const { models = [] } = await r.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return models.filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name);
  } catch {
    return [];
  }
}
