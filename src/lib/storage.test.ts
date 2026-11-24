import assert from 'node:assert/strict';
import { test } from 'vitest';
import '@/dev/mock';

test('save keeps the error-report choice made after load', async () => {
  const { load } = await import('./actions');
  const { save } = await import('./store');
  await chrome.storage.local.set({ errorReporting: 'on' });
  await load();
  await chrome.storage.local.set({ errorReporting: 'off' });
  await save();
  assert.equal((await chrome.storage.local.get(null)).errorReporting, 'off');
});

test('onboarding stays done after "Re-sort" leaves nothing sorted', async () => {
  const { load } = await import('./actions');
  const { allItems, db } = await import('./store');
  const { onboarded } = await import('@/components/Welcome');
  await load();
  assert.ok(onboarded());
  for (const x of allItems()) delete x.cat;
  assert.ok(onboarded());
  assert.equal(db.onboarded, true);
});

test('pool runs every job once, skips failures, returns the count', async () => {
  const { pool } = await import('./thumbs');
  const seen: number[] = [];
  const n = await pool([1, 2, 3, 4, 5, 6, 7, 8], async x => { if (x === 3) throw new Error('expired'); seen.push(x); }, 'syncingImages');
  assert.equal(n, 8);
  assert.deepEqual(seen.sort(), [1, 2, 4, 5, 6, 7, 8]);
});

test('"Delete all data" keeps the error-report choice and the settings', async () => {
  const { clearAll } = await import('./actions');
  const { ui } = await import('./store');
  Object.assign(globalThis, { caches: { delete: async () => true } });
  await chrome.storage.local.set({ errorReporting: 'off' });
  const done = clearAll();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(ui.ask?.kind, 'confirm');
  if (ui.ask?.kind === 'confirm') ui.ask.resolve(true);
  await done;
  const stored = await chrome.storage.local.get(null);
  assert.equal(stored.errorReporting, 'off');
  assert.deepEqual(stored.saved, []);
  assert.equal(stored.settings.apiKey, 'dev');
});

test('a field deleted from db is deleted from storage on the next save', async () => {
  const { db, save } = await import('./store');
  db.shortFollowing = 3;
  await save();
  delete db.shortFollowing;
  await save();
  assert.ok(!('shortFollowing' in (await chrome.storage.local.get(null))));
});

// Every stored shape an older version wrote. load() runs on every page open, so it must be idempotent.
const legacy = {
  settings: { apiKey: 'k', model: 'gemini-3.8-flash' },
  summaries: { 行銷: { text: 'a', sourceIds: ['p1'] } },
  following: [{ id: 'u1', username: 'a', name: 'A' }, { id: 'u1', username: 'a', name: 'A' }],
  saved: [{ id: 'p1', code: 'c', user: 'a', caption: '', alt: '', type: 'post', takenAt: 0, cat: '行銷' }],
  lastSync: { saved: 1, following: 2 },
};

test('load() upgrades every legacy shape, and loading again changes nothing', async () => {
  const { load } = await import('./actions');
  const { db, save } = await import('./store');
  await chrome.storage.local.set(structuredClone(legacy));
  await load();
  assert.equal(db.settings.model, 'gemini-3.5-flash-lite');
  assert.equal(db.settings.summaryModel, 'gemini-3.8-flash');
  assert.deepEqual(db.summaries, { 行銷: [{ id: 'd0', text: 'a', sourceIds: ['p1'] }] });
  assert.equal(db.following.length, 1);
  assert.equal(db.lastSync.following, 0);
  assert.equal(db.saved[0].thumb, '');
  assert.equal(db.lastSync.saved, 0);
  const once = structuredClone(db);
  await save();
  await load();
  assert.deepEqual(db, once);
});

test('upgrade() returns auto-filed posts in 好友 to unsorted, keeps hand-picked ones, and refetches follows without the mutual signal', async () => {
  const { upgrade } = await import('./actions');
  const post = { code: 'c', user: 'a', caption: '', alt: '', type: 'post' as const, takenAt: 0, pic: '', thumb: '' };
  const db = upgrade({
    settings: { lang: 'zh' } as never,
    saved: [{ ...post, id: 'p1', cat: '好友' }, { ...post, id: 'p2', cat: '好友', manual: true }],
    following: [{ id: 'u1', username: 'a', name: '', private: false, verified: false, pic: '' }],
    lastSync: { following: 5 },
  }, 'zh');
  assert.deepEqual(db.saved.map(p => p.cat), [undefined, '好友']);
  assert.equal(db.lastSync.following, 0);
  assert.equal(db.following[0].mutual, false);
});

test('editDigest adds an edited note beside the old digest and leaves it untouched', async () => {
  const { editDigest } = await import('./actions');
  const { db, save } = await import('./store');
  const post = (id: string) => ({ id, code: id, user: 'a', caption: '內容', alt: '', type: 'post' as const, takenAt: 0, pic: '', thumb: '', cat: '商業' });
  db.saved = [post('a1'), post('a2')];
  const old = { id: 'old', text: '• 舊摘要 [1]', sourceIds: ['a1'] };
  db.summaries = { 商業: [old] };
  await save();
  const realFetch = globalThis.fetch;
  const reply = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
  globalThis.fetch = (async (_url: string, init: RequestInit) => String(init.body).includes('book editor')
    ? reply(JSON.stringify({ thesis: '先選對問題', chapters: [{ claim: '先刪減', points: [{ text: '刪掉多餘流程', sources: [1] }] }] }))
    : reply(JSON.stringify({ claims: [{ n: 1, kind: 'principle', text: '刪掉多餘流程' }] }))) as typeof fetch;
  try {
    await editDigest('商業', 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(db.summaries['商業'].length, 2);
  assert.equal(db.summaries['商業'][0].text, '• 舊摘要 [1]');
  assert.equal(db.summaries['商業'][1].edited?.thesis, '先選對問題');
  assert.equal(db.summaries['商業'][1].edited?.thin, 1);
});

test('createDigest writes an edited note, and a topic with no usable text stops with a calm notice', async () => {
  const { createDigest } = await import('./actions');
  const { db, save, ui } = await import('./store');
  const post = { id: 'c1', code: 'c1', user: 'a', caption: '內容', alt: '', type: 'post' as const, takenAt: 0, pic: '', thumb: '', cat: '測試' };
  db.saved = [post];
  db.summaries = {};
  await save();
  const realFetch = globalThis.fetch;
  const reply = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
  try {
    globalThis.fetch = (async () => reply(JSON.stringify({ claims: [], skipped: [{ n: 1, why: 'teaser' }] }))) as typeof fetch;
    await createDigest('測試');
    assert.equal(db.summaries['測試'], undefined);
    assert.equal(ui.err, false);
    globalThis.fetch = (async (_url: string, init: RequestInit) => String(init.body).includes('book editor')
      ? reply(JSON.stringify({ thesis: '主張', chapters: [{ claim: '章節', points: [{ text: '觀點', sources: [1] }, { text: '第二點', sources: [1] }] }] }))
      : reply(JSON.stringify({ claims: [{ n: 1, kind: 'principle', text: '觀點' }] }))) as typeof fetch;
    await createDigest('測試');
    assert.equal(db.summaries['測試'][0].edited?.thesis, '主張');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('upgrade() moves a saved list view to the compact grid', async () => {
  const { upgrade } = await import('./actions');
  assert.equal(upgrade({ settings: { followView: 'list' } as never }, 'zh').settings.followView, 'compact');
  assert.equal(upgrade({ settings: { followView: 'grid' } as never }, 'zh').settings.followView, 'grid');
});

test('upgrade() run twice equals run once, for empty storage and every legacy shape', async () => {
  const { upgrade } = await import('./actions');
  for (const stored of [{}, legacy]) {
    const once = upgrade(structuredClone(stored), 'en');
    assert.deepEqual(upgrade(structuredClone(once), 'en'), once);
  }
});

test('upgrade() moves only gemini-2.x models to the default', async () => {
  const { upgrade } = await import('./actions');
  assert.equal(upgrade({ settings: { model: 'gemini-2.5-flash' } } as never, 'en').settings.model, 'gemini-3.5-flash-lite');
  assert.equal(upgrade({ settings: { model: 'gemini-25-pro' } } as never, 'en').settings.model, 'gemini-25-pro');
});

test('onboarding counts as done once one batch is sorted, even if a later batch fails', async () => {
  const { categorize } = await import('./actions');
  const { db } = await import('./store');
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => ++calls === 1
    ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"1":"行銷"}' }] } }] }))
    : new Response('{"error":{"message":"bad"}}', { status: 400 })) as typeof fetch;
  try {
    db.following = [{ id: 'u9', username: 'z', name: 'Z', pic: '', private: false }];
    db.saved = [{ id: 'p9', code: 'c', user: 'z', caption: '', alt: '', type: 'post', takenAt: 0, pic: '', thumb: '' }] as never;
    delete db.onboarded;
    await assert.rejects(categorize());
    assert.equal(db.onboarded, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
