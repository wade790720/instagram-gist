// Run: npm test. error-log keeps its consent in the same chrome.storage as the app's data;
// the app's save() must never write back a stale copy of it.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import '@/dev/mock'; // fake chrome.storage with sample data

test('save keeps the error-report choice made after load', async () => {
  const { load } = await import('./actions');
  const { save } = await import('./store');
  await chrome.storage.local.set({ errorReporting: 'on' });
  await load();
  await chrome.storage.local.set({ errorReporting: 'off' }); // the user unticks it in settings
  await save();
  assert.equal((await chrome.storage.local.get(null)).errorReporting, 'off');
});

test('"Delete all data" keeps the error-report choice and the settings', async () => {
  const { clearAll } = await import('./actions');
  const { ui } = await import('./store');
  Object.assign(globalThis, { caches: { delete: async () => true } }); // covers live in the Cache API
  await chrome.storage.local.set({ errorReporting: 'off' });
  const done = clearAll();
  await new Promise(r => setTimeout(r, 0));
  ui.ask!.resolve(true); // the confirm dialog
  await done;
  const stored = await chrome.storage.local.get(null);
  assert.equal(stored.errorReporting, 'off');
  assert.deepEqual(stored.saved, []);
  assert.equal(stored.settings.apiKey, 'dev');
});
