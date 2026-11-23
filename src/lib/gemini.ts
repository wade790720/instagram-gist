import { t } from './i18n';
import { db, status } from './store';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function gemini(prompt: string, json: boolean, model: string, fallback?: string | null): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': db.settings.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: json ? { responseMimeType: 'application/json', temperature: 0 } : {} }),
    });
    if (r.ok) return ((await r.json()).candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
    const body = await r.text();
    // Google's own message: names a retired model's replacement, or which limit was hit.
    let msg = body.slice(0, 300);
    try { msg = JSON.parse(body).error.message || msg; } catch {}
    // Google says how long to wait. Per-minute limits clear in under a minute: wait and retry.
    // A daily quota says ~18 h: retrying is pointless, so stop and say so.
    // 503 = this model is busy for everyone right now. After one retry, switch models instead of
    // waiting out two more minutes of retries that usually fail the same way.
    if (r.status === 503 && fallback && fallback !== model && attempt >= 1) {
      status(t('fellBack', model, fallback));
      [model, fallback, attempt] = [fallback, null, -1];
      continue;
    }
    const told = body.match(/"retryDelay":\s*"([\d.]+)s"/)?.[1];
    const wait = Number(told ?? 20 * (attempt + 1));
    if ((r.status === 429 || r.status === 503) && wait <= 90 && attempt < 3) {
      status(`${t('rateLimited', Math.ceil(wait))} (${r.status}: ${msg.slice(0, 120)})`);
      await sleep(wait * 1000);
      continue;
    }
    if (r.status === 429 && told && wait > 90) throw new Error(t('quotaOut', model, Math.ceil(wait / 3600)));
    throw new Error(t('geminiFailed', r.status, msg));
  }
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
