// Run: node test.js  (no output = pass)
const assert = require('assert/strict');
const C = require('./core.js');

// slimPost: carousel alt texts are merged and de-duplicated; missing caption is ''.
const post = C.slimPost({
  pk: 123, code: 'Abc', media_type: 8, taken_at: 1700000000, user: { username: 'hairbykai' },
  caption: null, accessibility_caption: 'text: 剪髮步驟',
  carousel_media: [{ accessibility_caption: 'text: 剪髮步驟' }, { accessibility_caption: 'text: 吹整' }],
});
assert.deepEqual(post, { id: '123', code: 'Abc', user: 'hairbykai', caption: '', alt: 'text: 剪髮步驟 | text: 吹整', type: 'carousel', takenAt: 1700000000 });

// Big media ids come from the string `id`, not the lossy numeric pk.
assert.equal(C.slimPost({ id: '3456789012345678901_42', pk: 3456789012345678901, code: 'X' }).id, '3456789012345678901');
assert.equal(C.slimUser({ pk: 42, username: 'a' }).id, '42');

// keepCats: unfollowed accounts disappear, surviving ones keep their tag.
const old = [{ id: '1', cat: '美髮' }, { id: '2', cat: '滑雪' }];
assert.deepEqual(C.keepCats([{ id: '1' }, { id: '3' }], old), [{ id: '1', cat: '美髮' }, { id: '3' }]);

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

// groupCounts: biggest category first, untagged ignored.
assert.deepEqual(C.groupCounts([{ cat: 'A' }, { cat: 'B' }, { cat: 'B' }, {}]), [['B', 2], ['A', 1]]);

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
// Saved rewrite notes and the previous digest are both passed back to the model.
const refine = C.summaryPrompt('美髮', [post], 'zh', ['用底層邏輯收斂', '合併同質內容'], '• 舊摘要 [1]');
assert.match(refine, /- 用底層邏輯收斂\n- 合併同質內容/);
assert.match(refine, /Previous digest.*\n• 舊摘要 \[1\]/);

// matches: case-insensitive across fields, tolerates missing fields.
assert.ok(C.matches({ username: 'KaiHair', name: '' }, 'kaih'));
assert.ok(C.matches({ user: 'x', caption: '', alt: '', cat: '滑雪' }, '滑雪'));
assert.ok(!C.matches({ user: 'x', caption: 'abc' }, 'zzz'));
