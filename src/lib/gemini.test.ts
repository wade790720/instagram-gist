import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import '@/dev/mock';

const LITE = 'gemini-3.5-flash-lite';
const FLASH = 'gemini-3.8-flash';
const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'done' }] } }] }));
const busy = () => new Response('{"error":{"message":"high demand"}}', { status: 503 });
const retired = () => new Response('{"error":{"message":"no longer available to new users"}}', { status: 404 });
const dailyOut = () => new Response('{"error":{"message":"quota","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"},{"retryDelay":"30s"}]}}', { status: 429 });
const perMinute = () => new Response('{"error":{"message":"slow down","details":[{"retryDelay":"7s"}]}}', { status: 429 });

let calls: string[];
function serve(answers: Record<string, () => Response>, keyModels: string[] = []) {
  calls = [];
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('pageSize')) return new Response(JSON.stringify({ models: keyModels.map(name => ({ name: 'models/' + name, supportedGenerationMethods: ['generateContent'] })) }));
    const model = decodeURIComponent(url.match(/models\/(.+):generate/)![1]);
    calls.push(model);
    return answers[model]();
  });
}
async function setup(model = LITE, summaryModel = FLASH) {
  vi.resetModules();
  const { db } = await import('./store');
  Object.assign(db.settings, { apiKey: 'k', model, summaryModel });
  return import('./gemini');
}
async function finish<T>(p: Promise<T>) {
  const settled = p.then(v => ({ v }), e => ({ e: e as Error }));
  await vi.runAllTimersAsync();
  return settled as Promise<{ v?: T; e?: Error }>;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('503: retries once, then finishes on the backup model', async () => {
  const { gemini } = await setup();
  serve({ [LITE]: busy, [FLASH]: ok });
  assert.equal((await finish(gemini('p', true, LITE))).v, 'done');
  assert.deepEqual(calls, [LITE, LITE, FLASH]);
});

test('a dropped connection is treated like a busy model', async () => {
  const { gemini } = await setup();
  serve({ [LITE]: () => { throw new TypeError('Failed to fetch'); }, [FLASH]: ok });
  assert.equal((await finish(gemini('p', true, LITE))).v, 'done');
});

test('a daily 429 switches at once, even when Google suggests a short wait', async () => {
  const { gemini } = await setup();
  serve({ [LITE]: dailyOut, [FLASH]: ok });
  assert.equal((await finish(gemini('p', true, LITE))).v, 'done');
  assert.deepEqual(calls, [LITE, FLASH]);
});

test('a per-minute 429 waits and retries the same model', async () => {
  const { gemini } = await setup();
  let n = 0;
  serve({ [LITE]: () => (n++ ? ok() : perMinute()), [FLASH]: ok });
  assert.equal((await finish(gemini('p', true, LITE))).v, 'done');
  assert.deepEqual(calls, [LITE, LITE]);
});

test('a retired model (404) hands over instead of showing an error', async () => {
  const { gemini } = await setup();
  serve({ [LITE]: retired, [FLASH]: ok });
  assert.equal((await finish(gemini('p', true, LITE))).v, 'done');
  assert.deepEqual(calls, [LITE, FLASH]);
});

test('later calls skip a model that just failed', async () => {
  const { gemini } = await setup();
  serve({ [LITE]: dailyOut, [FLASH]: ok });
  await finish(gemini('p', true, LITE));
  calls.length = 0;
  await finish(gemini('p', true, LITE));
  assert.deepEqual(calls, [FLASH]);
});

test('both models same setting still has a backup', async () => {
  const { gemini } = await setup(FLASH, FLASH);
  serve({ [FLASH]: busy, [LITE]: ok });
  assert.equal((await finish(gemini('p', true, FLASH))).v, 'done');
  assert.deepEqual(calls, [FLASH, FLASH, LITE]);
});

test('backups from the key list skip pro and retired 2.x models', async () => {
  const { gemini } = await setup();
  serve({ [LITE]: busy, [FLASH]: busy, 'gemini-3.8-flash-lite': ok, 'gemini-3.8-pro': ok, 'gemini-2.5-flash-lite': retired },
    [LITE, FLASH, 'gemini-3.8-pro', 'gemini-2.5-flash-lite', 'gemini-3.8-flash-lite']);
  assert.equal((await finish(gemini('p', true, LITE))).v, 'done');
  assert.deepEqual(calls, [LITE, LITE, FLASH, FLASH, 'gemini-3.8-flash-lite']);
});

test('when every model is busy it waits and recovers without an error', async () => {
  const { gemini } = await setup();
  let n = 0;
  serve({ [LITE]: () => (++n > 3 ? ok() : busy()), [FLASH]: busy });
  assert.equal((await finish(gemini('p', true, LITE))).v, 'done');
});

test('if every model stays busy it stops with a calm notice, not an error report', async () => {
  const { gemini, Notice } = await setup();
  serve({ [LITE]: busy, [FLASH]: busy });
  const { e } = await finish(gemini('p', true, LITE));
  assert.ok(e instanceof Notice);
  assert.equal((e as InstanceType<typeof Notice>).alert, false);
});

test('only a full quota on every model is an alert', async () => {
  const { gemini, Notice } = await setup();
  serve({ [LITE]: dailyOut, [FLASH]: dailyOut });
  const { e } = await finish(gemini('p', true, LITE));
  assert.ok(e instanceof Notice);
  assert.equal((e as InstanceType<typeof Notice>).alert, true);
  assert.deepEqual(calls, [LITE, FLASH]);
});

test('a bad request does not switch models', async () => {
  const { gemini, Notice } = await setup();
  serve({ [LITE]: () => new Response('{"error":{"message":"bad key"}}', { status: 400 }), [FLASH]: ok });
  const { e } = await finish(gemini('p', true, LITE));
  assert.ok(e && !(e instanceof Notice));
  assert.deepEqual(calls, [LITE]);
});
