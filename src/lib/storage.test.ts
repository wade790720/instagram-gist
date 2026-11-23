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

test('onboarding stays done after "Re-sort everything" leaves nothing sorted', async () => {
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

test('upgrade() run twice equals run once, for empty storage and every legacy shape', async () => {
  const { upgrade } = await import('./actions');
  for (const stored of [{}, legacy]) {
    const once = upgrade(structuredClone(stored), 'en');
    assert.deepEqual(upgrade(structuredClone(once), 'en'), once);
  }
});
