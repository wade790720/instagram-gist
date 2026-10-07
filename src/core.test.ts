// Run: npm test. Fixtures are partial objects, so this file is left out of tsc (see tsconfig.json).
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as C from './core';

test('core', () => {

// slimPost: carousel alt texts are merged and de-duplicated; missing caption is ''.
const post = C.slimPost({
  pk: 123, code: 'Abc', media_type: 8, taken_at: 1700000000, user: { username: 'hairbykai', profile_pic_url: 'https://cdn/k.jpg' },
  caption: null, accessibility_caption: 'text: 剪髮步驟',
  carousel_media: [{ accessibility_caption: 'text: 剪髮步驟' }, { accessibility_caption: 'text: 吹整' }],
});
assert.deepEqual(post, { id: '123', code: 'Abc', user: 'hairbykai', caption: '', alt: 'text: 剪髮步驟 | text: 吹整', type: 'carousel', takenAt: 1700000000, pic: 'https://cdn/k.jpg', thumb: '' });

// thumbOf: smallest candidate >= 400 px wide, original size for the aspect ratio; carousels use slide 1.
const cands = [{ url: 'big', width: 1080, height: 1350 }, { url: 'small', width: 320, height: 400 }, { url: 'mid', width: 480, height: 600 }];
assert.deepEqual(C.thumbOf({ code: 'x', image_versions2: { candidates: cands }, original_width: 1080, original_height: 1350 }), { thumb: 'mid', w: 1080, h: 1350 });
assert.deepEqual(C.thumbOf({ code: 'x', carousel_media: [{ image_versions2: { candidates: [{ url: 's1', width: 640, height: 640 }] } }] }), { thumb: 's1', w: 640, h: 640 });
assert.deepEqual(C.thumbOf({ code: 'x', image_versions2: { candidates: [{ url: 'tiny', width: 150, height: 150 }] } }).thumb, 'tiny');

// Big media ids come from the string `id`, not the lossy numeric pk.
assert.equal(C.slimPost({ id: '3456789012345678901_42', pk: 3456789012345678901, code: 'X' }).id, '3456789012345678901');
assert.equal(C.slimUser({ pk: 42, username: 'a' }).id, '42');

// slimUser keeps the two friend signals and the avatar URL ('' when missing).
assert.deepEqual(C.slimUser({ pk: 7, username: 'b', full_name: 'B', is_private: true, is_verified: false, profile_pic_url: 'https://cdn/b.jpg' }), { id: '7', username: 'b', name: 'B', private: true, verified: false, pic: 'https://cdn/b.jpg' });
assert.equal(C.slimUser({ pk: 8, username: 'c' }).pic, '');

// markFriends: mutual or private, never verified, never a hand-picked topic.
const people = [
  { id: '1', private: true, verified: false },                  // private -> friend
  { id: '2', private: false, verified: false },                 // follows back -> friend
  { id: '3', private: false, verified: false, cat: '美髮' },    // stranger -> keeps AI topic
  { id: '4', private: true, verified: true, cat: '音樂' },      // verified -> never
  { id: '5', private: true, verified: false, cat: '滑雪', manual: true }, // hand-picked -> kept
];
assert.equal(C.markFriends(people, new Set(['2']), 'zh'), 2);
assert.deepEqual(people.map(p => p.cat), ['好友', '好友', '美髮', '音樂', '滑雪']);

// keepCats: unfollowed accounts disappear, surviving ones keep their tag.
const old = [{ id: '1', cat: '美髮' }, { id: '2', cat: '滑雪' }];
assert.deepEqual(C.keepCats([{ id: '1' }, { id: '3' }], old), [{ id: '1', cat: '美髮' }, { id: '3' }]);

// keepCats: a hand-picked topic stays hand-picked after a refetch.
assert.deepEqual(C.keepCats([{ id: '1' }], [{ id: '1', cat: '滑雪', manual: true }]), [{ id: '1', cat: '滑雪', manual: true }]);

// IG paging can repeat an item: first copy wins, order kept, in fresh and old lists alike.
assert.deepEqual(C.uniqById([{ id: '1', cat: 'A' }, { id: '2' }, { id: '1', cat: 'B' }]), [{ id: '1', cat: 'A' }, { id: '2' }]);
assert.deepEqual(C.keepCats([{ id: '1' }, { id: '1' }], []).length, 1);
assert.deepEqual(C.mergeById([], [{ id: '1' }, { id: '1' }]).length, 1);

// mergeById: fresh first, old kept after, no duplicates.
assert.deepEqual(C.mergeById([{ id: '3' }, { id: '1' }], old).map(x => x.id), ['3', '1', '2']);

// parseJson: code fences, chatter around JSON, garbage.
assert.deepEqual(C.parseJson('```json\n{"1":"美髮"}\n```'), { 1: '美髮' });
assert.deepEqual(C.parseJson('Sure! {"1":"A"} hope this helps'), { 1: 'A' });
assert.deepEqual(C.parseJson('not json'), {});

// applyCategories: blank / non-string answers leave the item untagged for retry.
const batch = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
assert.equal(C.applyCategories(batch, { 1: ' 行銷 ', 2: '', 3: 7 }), 1);
assert.deepEqual(batch, [{ id: 'a', cat: '行銷' }, { id: 'b' }, { id: 'c' }]);

// renameCat: items and digests move; renaming onto an existing topic merges both.
const items = [{ cat: '行銷' }, { cat: '商業' }, { cat: '行銷' }, {}];
const digests = { 行銷: [{ id: 'a' }], 商業: [{ id: 'b' }] };
assert.equal(C.renameCat(items, digests, '行銷', '商業'), 2);
assert.deepEqual(items.map(x => x.cat), ['商業', '商業', '商業', undefined]);
assert.deepEqual(digests, { 商業: [{ id: 'b' }, { id: 'a' }] });

// deleteCat: items become unsorted and lose the manual flag; digests go; other topics untouched.
const tagged = [{ cat: '美食', manual: true }, { cat: '滑雪' }];
const ds = { 美食: [{ id: 'a' }], 滑雪: [{ id: 'b' }] };
assert.equal(C.deleteCat(tagged, ds, '美食'), 1);
assert.deepEqual(tagged, [{}, { cat: '滑雪' }]);
assert.deepEqual(ds, { 滑雪: [{ id: 'b' }] });

// groupCounts: biggest category first, untagged ignored.
assert.deepEqual(C.groupCounts([{ cat: 'A' }, { cat: 'B' }, { cat: 'B' }, {}]), [['B', 2], ['A', 1]]);

// normalizeSummaries: old single digest becomes a one-item list; lists are left alone.
const sums = C.normalizeSummaries({ 行銷: { text: 'a', sourceIds: ['1'] }, 美髮: [{ id: 'x', text: 'b' }] });
assert.deepEqual(sums, { 行銷: [{ id: 'd0', text: 'a', sourceIds: ['1'] }], 美髮: [{ id: 'x', text: 'b' }] });
assert.deepEqual(C.normalizeSummaries(undefined), {});

// orderSources: saved list is newest-first, but old digest sources must keep their [n].
assert.deepEqual(C.orderSources(['1', '2'], [{ id: '9' }, { id: '2' }, { id: '1' }]).map(p => p.id), ['1', '2', '9']);
assert.deepEqual(C.orderSources([], [{ id: '9' }, { id: '1' }]).map(p => p.id), ['9', '1']);

// newSources: counts posts added after the digest was written.
assert.equal(C.newSources({ sourceIds: ['1', '2'] }, [{ id: '1' }, { id: '2' }, { id: '9' }]), 1);

// Prompts: numbered items, existing categories passed for reuse, follow vs post text.
const p = C.categorizePrompt([{ username: 'kai', name: 'Kai 剪髮' }, post], ['美髮'], 'zh');
assert.match(p, /Existing: 美髮/);
assert.match(p, /\n1\. @kai Kai 剪髮\n2\. @hairbykai: /);
assert.match(C.summaryPrompt('美髮', [post], 'en'), /\[1\] @hairbykai: .*\[image: text: 剪髮步驟/);
assert.doesNotMatch(C.summaryPrompt('美髮', [post], 'en'), /instructions from the user|Previous digest/);
// Big topics stay inside the prompt budget: 200 posts with 5000-char captions and alt text.
const long = 'x'.repeat(5000);
const big = Array.from({ length: 200 }, (_, i) => ({ id: String(i), user: 'u', caption: long, alt: long }));
assert.ok(C.summaryPrompt('T', big, 'zh').length < 75000, 'summary prompt over budget');
// Small topics keep long clips (1500 chars per field).
assert.ok(C.summaryPrompt('T', big.slice(0, 3), 'zh').includes('x'.repeat(1500)));

// Saved rewrite notes and the previous digest are both passed back to the model.
const refine = C.summaryPrompt('美髮', [post], 'zh', ['用底層邏輯收斂', '合併同質內容'], '• 舊摘要 [1]');
assert.match(refine, /- 用底層邏輯收斂\n- 合併同質內容/);
assert.match(refine, /Previous digest.*\n• 舊摘要 \[1\]/);

// matches: case-insensitive across fields, tolerates missing fields.
assert.ok(C.matches({ username: 'KaiHair', name: '' }, 'kaih'));
assert.ok(C.matches({ user: 'x', caption: '', alt: '', cat: '滑雪' }, '滑雪'));
assert.ok(!C.matches({ user: 'x', caption: 'abc' }, 'zzz'));
});
