import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import '@/dev/mock';

vi.mock('./ig', () => ({
  fromIg: async (kind: string) => {
    if (kind === 'followers') throw new Error('IG refused');
    return kind === 'following' ? [{ pk: 1, username: 'a', full_name: 'A', is_private: true }] : [];
  },
}));

test('a failed follower read leaves follows, friends and mutual flags as they were', async () => {
  const { sync } = await import('./actions');
  const { db } = await import('./store');
  db.following = [{ id: '1', username: 'a', name: 'A', private: true, verified: false, mutual: true, pic: '', cat: '好友' }];
  db.lastSync.following = 0;
  await sync();
  assert.equal(db.following[0].mutual, true);
  assert.equal(db.following[0].cat, '好友');
  assert.equal(db.lastSync.following, 0);
});
