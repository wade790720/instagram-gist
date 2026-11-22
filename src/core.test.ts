import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as C from './core';

test('core', () => {

const post = C.slimPost({
  pk: 123, code: 'Abc', media_type: 8, taken_at: 1700000000, user: { username: 'hairbykai', profile_pic_url: 'https://cdn/k.jpg' },
  caption: null, accessibility_caption: 'text: 剪髮步驟',
  carousel_media: [{ accessibility_caption: 'text: 剪髮步驟' }, { accessibility_caption: 'text: 吹整' }],
});
assert.deepEqual(post, { id: '123', code: 'Abc', user: 'hairbykai', caption: '', alt: 'text: 剪髮步驟 | text: 吹整', type: 'carousel', takenAt: 1700000000, pic: 'https://cdn/k.jpg', thumb: '' });

const cands = [{ url: 'big', width: 1080, height: 1350 }, { url: 'small', width: 320, height: 400 }, { url: 'mid', width: 480, height: 600 }];
assert.deepEqual(C.thumbOf({ code: 'x', image_versions2: { candidates: cands }, original_width: 1080, original_height: 1350 }), { thumb: 'mid', w: 1080, h: 1350 });
assert.deepEqual(C.thumbOf({ code: 'x', carousel_media: [{ image_versions2: { candidates: [{ url: 's1', width: 640, height: 640 }] } }] }), { thumb: 's1', w: 640, h: 640 });
assert.deepEqual(C.thumbOf({ code: 'x', image_versions2: { candidates: [{ url: 'tiny', width: 150, height: 150 }] } }).thumb, 'tiny');

assert.equal(C.slimPost({ id: '3456789012345678901_42', pk: 3456789012345678901, code: 'X' }).id, '3456789012345678901');
assert.equal(C.slimUser({ pk: 42, username: 'a' }).id, '42');

assert.deepEqual(C.slimUser({ pk: 7, username: 'b', full_name: 'B', is_private: true, is_verified: false, profile_pic_url: 'https://cdn/b.jpg' }), { id: '7', username: 'b', name: 'B', private: true, verified: false, pic: 'https://cdn/b.jpg' });
assert.equal(C.slimUser({ pk: 8, username: 'c' }).pic, '');

const people = [
  { id: '1', private: true, verified: false },
  { id: '2', private: false, verified: false },
  { id: '3', private: false, verified: false, cat: '美髮' },
  { id: '4', private: true, verified: true, cat: '音樂' },
  { id: '5', private: true, verified: false, cat: '滑雪', manual: true },
  { id: '6', private: false, verified: false, cat: '好友' },
];
assert.equal(C.markFriends(people, new Set(['2']), 'zh'), 2);
assert.deepEqual(people.map(p => p.cat), ['好友', '好友', '美髮', '音樂', '滑雪', undefined]);

const old = [{ id: '1', cat: '美髮' }, { id: '2', cat: '滑雪' }];
assert.deepEqual(C.keepCats([{ id: '1' }, { id: '3' }], old), [{ id: '1', cat: '美髮' }, { id: '3' }]);

assert.deepEqual(C.keepCats([{ id: '1' }], [{ id: '1', cat: '滑雪', manual: true }]), [{ id: '1', cat: '滑雪', manual: true }]);

assert.deepEqual(C.uniqById([{ id: '1', cat: 'A' }, { id: '2' }, { id: '1', cat: 'B' }]), [{ id: '1', cat: 'A' }, { id: '2' }]);
assert.deepEqual(C.keepCats([{ id: '1' }, { id: '1' }], []).length, 1);
assert.deepEqual(C.mergeById([], [{ id: '1' }, { id: '1' }]).length, 1);

assert.deepEqual(C.mergeById([{ id: '3' }, { id: '1' }], old).map(x => x.id), ['3', '1', '2']);

assert.deepEqual(C.parseJson('```json\n{"1":"美髮"}\n```'), { 1: '美髮' });
assert.deepEqual(C.parseJson('Sure! {"1":"A"} hope this helps'), { 1: 'A' });
assert.deepEqual(C.parseJson('not json'), {});

const batch = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
assert.equal(C.applyCategories(batch, { 1: ' 行銷 ', 2: '', 3: 7 }), 1);
assert.deepEqual(batch, [{ id: 'a', cat: '行銷' }, { id: 'b' }, { id: 'c' }]);

const items = [{ cat: '行銷' }, { cat: '商業' }, { cat: '行銷' }, {}];
const digests = { 行銷: [{ id: 'a' }], 商業: [{ id: 'b' }] };
assert.equal(C.renameCat(items, digests, '行銷', '商業'), 2);
assert.deepEqual(items.map(x => x.cat), ['商業', '商業', '商業', undefined]);
assert.deepEqual(digests, { 商業: [{ id: 'b' }, { id: 'a' }] });

const tagged = [{ cat: '美食', manual: true }, { cat: '滑雪' }];
const ds = { 美食: [{ id: 'a' }], 滑雪: [{ id: 'b' }] };
assert.equal(C.deleteCat(tagged, ds, '美食'), 1);
assert.deepEqual(tagged, [{}, { cat: '滑雪' }]);
assert.deepEqual(ds, { 滑雪: [{ id: 'b' }] });

assert.deepEqual(C.groupCounts([{ cat: 'A' }, { cat: 'B' }, { cat: 'B' }, {}]), [['B', 2], ['A', 1]]);

const sums = C.normalizeSummaries({ 行銷: { text: 'a', sourceIds: ['1'] }, 美髮: [{ id: 'x', text: 'b' }] });
assert.deepEqual(sums, { 行銷: [{ id: 'd0', text: 'a', sourceIds: ['1'] }], 美髮: [{ id: 'x', text: 'b' }] });
assert.deepEqual(C.normalizeSummaries(undefined), {});

assert.deepEqual(C.orderSources(['1', '2'], [{ id: '9' }, { id: '2' }, { id: '1' }]).map(p => p.id), ['1', '2', '9']);
assert.deepEqual(C.orderSources([], [{ id: '9' }, { id: '1' }]).map(p => p.id), ['9', '1']);

assert.equal(C.newSources({ sourceIds: ['1', '2'] }, [{ id: '1' }, { id: '2' }, { id: '9' }]), 1);

const p = C.categorizePrompt([{ username: 'kai', name: 'Kai 剪髮' }, post], ['美髮'], 'zh');
assert.match(p, /from this list: 美髮\n/);
assert.match(p, /exactly 2 Chinese characters/);
const first = C.categorizePrompt([post], [], 'zh');
assert.match(first, /from this list: 行銷, 商業, .*, 運動, 其他\n/);
assert.equal(first.match(/from this list: (.*)\n/)[1].split(', ').length, 15);
assert.doesNotMatch(first, /Keep the total/);

const named = [{}, {}, {}, {}];
C.applyCategories(named, { 1: '滑雪', 2: '心靈療癒', 3: '自我提升', 4: '行銷商業' }, ['自我提升'], 'zh');
assert.deepEqual(named.map(x => x.cat), ['滑雪', '其他', '自我提升', '其他']);
const english = [{}, {}];
C.applyCategories(english, { 1: 'Home Decor', 2: 'Arts and Crafts' }, [], 'en');
assert.deepEqual(english.map(x => x.cat), ['Home Decor', 'Other']);
assert.match(p, /\n1\. @kai Kai 剪髮\n2\. @hairbykai: /);
assert.match(C.summaryPrompt('美髮', [post], 'en'), /\[1\] @hairbykai: .*\[image: text: 剪髮步驟/);
assert.doesNotMatch(C.summaryPrompt('美髮', [post], 'en'), /instructions from the user|Previous digest/);
const long = 'x'.repeat(5000);
const big = Array.from({ length: 200 }, (_, i) => ({ id: String(i), user: 'u', caption: long, alt: long }));
assert.ok(C.summaryPrompt('T', big, 'zh').length < 75000, 'summary prompt over budget');
assert.ok(C.summaryPrompt('T', big.slice(0, 3), 'zh').includes('x'.repeat(1500)));

const refine = C.summaryPrompt('美髮', [post], 'zh', ['用底層邏輯收斂', '合併同質內容'], '• 舊摘要 [1]');
assert.match(refine, /- 用底層邏輯收斂\n- 合併同質內容/);
assert.match(refine, /Previous digest.*\n• 舊摘要 \[1\]/);

assert.ok(C.matches({ username: 'KaiHair', name: '' }, 'kaih'));
assert.ok(C.matches({ user: 'x', caption: '', alt: '', cat: '滑雪' }, '滑雪'));
assert.ok(!C.matches({ user: 'x', caption: 'abc' }, 'zzz'));

const many = (cat: string, n: number, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: cat + i, cat, ...extra }));
const pool = [...many('娛樂', 6), ...many('喜劇', 2), ...many('玩具', 1), ...many('其他', 1), ...many('好友', 1), ...many('滑雪', 1, { manual: true }), { id: 'mx', cat: '玩具', manual: true }];
assert.deepEqual(C.smallTopics(pool, 'zh'), { small: ['喜劇', '玩具'], big: ['娛樂'] });
assert.deepEqual(C.smallTopics(many('喜劇', 2), 'zh').small, []);
const smallSums = { 喜劇: [{ id: 'd1', text: 't', sourceIds: [] }], 玩具: [{ id: 'd2', text: 't', sourceIds: [] }] };
assert.equal(C.mergeSmall(pool, smallSums, { 喜劇: '娛樂', 玩具: '娛樂', 滑雪: '不存在' }, ['娛樂']), 3);
assert.equal(pool.filter(x => x.cat === '娛樂').length, 9);
assert.equal(pool.find(x => x.id === 'mx').cat, '玩具');
assert.deepEqual(Object.keys(smallSums), ['玩具', '娛樂']);

const defined = C.categorizePrompt([post], ['心靈', '成長'], 'zh', { 心靈: '情緒、療癒' });
assert.match(defined, /\n  心靈: 情緒、療癒\n  成長\n/);
assert.match(C.categorizePrompt([post], ['心靈', '成長'], 'zh', { 其他: 'x' }), /from this list: 心靈, 成長\n/);

const posts = (cat: string, n: number) => many(cat, n, { user: 'u', caption: 'text', alt: '' });
const topicsPool = [...posts('心靈', 8), ...posts('成長', 6), ...posts('健康', 3), ...posts('醫療', 9), ...posts('其他', 2)];
const plan = C.parseTidy({
  merge: { 健康: '醫療', 成長: '心靈', 心靈: '醫療', 其他: '心靈', 不存在: '醫療', 醫療: 7 },
  defs: { 心靈: ' 情緒、療癒 ', 醫療: '看病與治療', 其他: 'x', 不存在: 'y', 成長: '' },
}, topicsPool, 'zh');
assert.deepEqual(plan.merges, [['健康', '醫療'], ['心靈', '醫療']]);
assert.deepEqual(plan.defs, { 心靈: '情緒、療癒', 醫療: '看病與治療' });
assert.match(C.tidyPrompt(topicsPool, 'zh'), /\n心靈 \(8 items\): @u: text/);
assert.doesNotMatch(C.tidyPrompt(topicsPool, 'zh'), /\n其他 \(/);
});
