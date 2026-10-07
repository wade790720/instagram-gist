import { t } from './i18n';
import { db, status } from './store';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// fallback: a second model to use when `model` is overloaded (503). The newest model often is.
export async function gemini(prompt: string, json: boolean, model: string, fallback?: string | null): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': db.settings.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: json ? { responseMimeType: 'application/json' } : {} }),
    });
    if (r.ok) return ((await r.json()).candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
    const body = await r.text();
    // Google's own message: names a retired model's replacement, or which limit was hit.
    let msg = body.slice(0, 300);
    try { msg = JSON.parse(body).error.message || msg; } catch { /* not JSON, keep raw text */ }
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
      // Show the reason too, so "overloaded" (503) and "limit X exceeded" (429) can be told apart.
      status(`${t('rateLimited', Math.ceil(wait))} (${r.status}: ${msg.slice(0, 120)})`);
      await sleep(wait * 1000);
      continue;
    }
    // Only call it the daily quota when Google gave a long retryDelay; otherwise show its text.
    if (r.status === 429 && told && wait > 90) throw new Error(t('quotaOut', model, Math.ceil(wait / 3600)));
    throw new Error(`Gemini ${r.status}: ${msg}`);
  }
}
