import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as C from './core';

const post = C.slimPost({
  pk: 123, code: 'Abc', media_type: 8, taken_at: 1700000000, user: { username: 'hairbykai', profile_pic_url: 'https://cdn/k.jpg' },
  caption: null, accessibility_caption: 'text: 剪髮步驟',
  carousel_media: [{ accessibility_caption: 'text: 剪髮步驟' }, { accessibility_caption: 'text: 吹整' }],
});
const many = (cat: string, n: number, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: cat + i, cat, ...extra }));

test("slimPost merges carousel alt texts and defaults a missing caption", () => {
assert.deepEqual(post, { id: '123', code: 'Abc', user: 'hairbykai', caption: '', alt: 'text: 剪髮步驟 | text: 吹整', type: 'carousel', takenAt: 1700000000, pic: 'https://cdn/k.jpg', thumb: '' });
});

test("thumbOf picks the smallest cover at least 400px wide, carousels use slide 1", () => {
const cands = [{ url: 'big', width: 1080, height: 1350 }, { url: 'small', width: 320, height: 400 }, { url: 'mid', width: 480, height: 600 }];
assert.deepEqual(C.thumbOf({ code: 'x', image_versions2: { candidates: cands }, original_width: 1080, original_height: 1350 }), { thumb: 'mid', w: 1080, h: 1350 });
assert.deepEqual(C.thumbOf({ code: 'x', carousel_media: [{ image_versions2: { candidates: [{ url: 's1', width: 640, height: 640 }] } }] }), { thumb: 's1', w: 640, h: 640 });
assert.deepEqual(C.thumbOf({ code: 'x', image_versions2: { candidates: [{ url: 'tiny', width: 150, height: 150 }] } }).thumb, 'tiny');
});

test("ids come from the string id, not the lossy numeric pk", () => {
assert.equal(C.slimPost({ id: '3456789012345678901_42', pk: 3456789012345678901, code: 'X' }).id, '3456789012345678901');
assert.equal(C.slimUser({ pk: 42, username: 'a' }).id, '42');
});

test("slimUser keeps the friend signals and the avatar URL", () => {
assert.deepEqual(C.slimUser({ pk: 7, username: 'b', full_name: 'B', is_private: true, is_verified: false, profile_pic_url: 'https://cdn/b.jpg' }), { id: '7', username: 'b', name: 'B', private: true, verified: false, mutual: false, pic: 'https://cdn/b.jpg' });
assert.equal(C.slimUser({ pk: 8, username: 'c' }).pic, '');
});

const follow = (id: string, extra: Partial<C.User> = {}): C.User => ({ id, username: 'u' + id, name: '', private: false, verified: false, mutual: false, pic: '', ...extra });

test("markFriends: only mutual and private is a friend outright; verified, hand-picked and stale labels stay out", () => {
const people = [
  follow('1', { private: true }),
  follow('2'),
  follow('3', { cat: '美髮' }),
  follow('4', { private: true, verified: true, cat: '音樂' }),
  follow('5', { private: true, cat: '滑雪', manual: true }),
  follow('6', { cat: '好友' }),
  follow('7', { private: true }),
];
assert.equal(C.markFriends(people, new Set(['2', '4', '5', '7']), 'zh'), 1);
assert.deepEqual(people.map(p => p.cat), [undefined, undefined, '美髮', '音樂', '滑雪', undefined, '好友']);
});

test("friendCandidates asks about one-signal accounts only, once", () => {
const people = [
  follow('1', { mutual: true }),
  follow('2', { private: true }),
  follow('3', { mutual: true, private: true }),
  follow('4'),
  follow('5', { mutual: true, verified: true }),
  follow('6', { mutual: true, manual: true, cat: '商業' }),
  follow('7', { mutual: true, kind: 'page' }),
];
assert.deepEqual(C.friendCandidates(people).map(u => u.id), ['1', '2']);
});

test("applyFriendCheck: a shop is not a friend, and unsure needs a mutual follow", () => {
const batch = [follow('1', { mutual: true }), follow('2', { mutual: true }), follow('3', { mutual: true }), follow('4', { private: true }), follow('5', { mutual: true })];
C.applyFriendCheck(batch, { 1: 'person', 2: 'page', 3: 'unsure', 4: 'unsure', 5: 'nonsense' }, 'zh');
assert.deepEqual(batch.map(u => [u.kind, u.cat]), [['person', '好友'], ['page', undefined], ['person', '好友'], ['page', undefined], [undefined, undefined]]);
});

test("a checked account stays checked after a refetch, and labelFriends restores it after a re-sort", () => {
const [kept] = C.keepCats([follow('1')], [follow('1', { kind: 'person', mutual: true, cat: '好友' })]);
assert.equal(kept.kind, 'person');
const person = follow('1', { kind: 'person', mutual: true });
C.labelFriends([person], 'zh');
assert.equal(person.cat, '好友');
});

test("the topic prompt never offers 好友, even when it is the only category so far", () => {
const prompt = C.categorizePrompt([follow('1')], ['好友'], 'zh');
assert.ok(!prompt.includes('好友'));
assert.ok(prompt.includes('行銷'));
const x = follow('2');
C.applyCategories([x], { 1: '好友' }, ['好友', '行銷'], 'zh');
assert.equal(x.cat, '其他');
});

test("keepCats, uniqById and mergeById keep topics, manual picks and order", () => {
const old = [{ id: '1', cat: '美髮' }, { id: '2', cat: '滑雪' }];
assert.deepEqual(C.keepCats([{ id: '1' }, { id: '3' }], old), [{ id: '1', cat: '美髮' }, { id: '3' }]);

assert.deepEqual(C.keepCats([{ id: '1' }], [{ id: '1', cat: '滑雪', manual: true }]), [{ id: '1', cat: '滑雪', manual: true }]);

assert.deepEqual(C.uniqById([{ id: '1', cat: 'A' }, { id: '2' }, { id: '1', cat: 'B' }]), [{ id: '1', cat: 'A' }, { id: '2' }]);
assert.deepEqual(C.keepCats([{ id: '1' }, { id: '1' }], []).length, 1);
assert.deepEqual(C.mergeById([], [{ id: '1' }, { id: '1' }]).length, 1);

assert.deepEqual(C.mergeById([{ id: '3' }, { id: '1' }], old).map(x => x.id), ['3', '1', '2']);
});

test("parseJson tolerates code fences and chatter", () => {
assert.deepEqual(C.parseJson('```json\n{"1":"美髮"}\n```'), { 1: '美髮' });
assert.deepEqual(C.parseJson('Sure! {"1":"A"} hope this helps'), { 1: 'A' });
assert.deepEqual(C.parseJson('not json'), {});
});

test("applyCategories skips empty and non-string answers", () => {
const batch = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
assert.equal(C.applyCategories(batch, { 1: ' 行銷 ', 2: '', 3: 7 }), 1);
assert.deepEqual(batch, [{ id: 'a', cat: '行銷' }, { id: 'b' }, { id: 'c' }]);
});

test("renameCat onto an existing topic merges items and digests", () => {
const items = [{ cat: '行銷' }, { cat: '商業' }, { cat: '行銷' }, {}];
const digests = { 行銷: [{ id: 'a' }], 商業: [{ id: 'b' }] };
assert.equal(C.renameCat(items, digests, '行銷', '商業'), 2);
assert.deepEqual(items.map(x => x.cat), ['商業', '商業', '商業', undefined]);
assert.deepEqual(digests, { 商業: [{ id: 'b' }, { id: 'a' }] });
});

test("deleteCat unsorts its items and deletes its digests", () => {
const tagged = [{ cat: '美食', manual: true }, { cat: '滑雪' }];
const ds = { 美食: [{ id: 'a' }], 滑雪: [{ id: 'b' }] };
assert.equal(C.deleteCat(tagged, ds, '美食'), 1);
assert.deepEqual(tagged, [{}, { cat: '滑雪' }]);
assert.deepEqual(ds, { 滑雪: [{ id: 'b' }] });
});

test("groupCounts sorts topics by size", () => {
assert.deepEqual(C.groupCounts([{ cat: 'A' }, { cat: 'B' }, { cat: 'B' }, {}]), [['B', 2], ['A', 1]]);
});

test("normalizeSummaries upgrades the one-digest shape", () => {
const sums = C.normalizeSummaries({ 行銷: { text: 'a', sourceIds: ['1'] }, 美髮: [{ id: 'x', text: 'b' }] });
assert.deepEqual(sums, { 行銷: [{ id: 'd0', text: 'a', sourceIds: ['1'] }], 美髮: [{ id: 'x', text: 'b' }] });
assert.deepEqual(C.normalizeSummaries(undefined), {});
});

test("orderSources and newSources keep [n] numbers stable", () => {
assert.deepEqual(C.orderSources(['1', '2'], [{ id: '9' }, { id: '2' }, { id: '1' }]).map(p => p.id), ['1', '2', '9']);
assert.deepEqual(C.orderSources([], [{ id: '9' }, { id: '1' }]).map(p => p.id), ['9', '1']);

assert.equal(C.newSources({ sourceIds: ['1', '2'] }, [{ id: '1' }, { id: '2' }, { id: '9' }]), 1);
});

test("categorizePrompt uses a fixed list and numbers the items", () => {
const p = C.categorizePrompt([{ username: 'kai', name: 'Kai 剪髮' }, post], ['美髮'], 'zh');
assert.match(p, /from this list: 美髮\n/);
assert.match(p, /exactly 2 Chinese characters/);
const first = C.categorizePrompt([post], [], 'zh');
assert.match(first, /from this list: 行銷, 商業, .*, 運動, 其他\n/);
assert.equal(first.match(/from this list: (.*)\n/)[1].split(', ').length, 15);
assert.doesNotMatch(first, /Keep the total/);
assert.match(p, /\n1\. @kai Kai 剪髮\n2\. @hairbykai: /);
});

test("applyCategories holds new names to the naming rule", () => {
const named = [{}, {}, {}, {}];
C.applyCategories(named, { 1: '滑雪', 2: '心靈療癒', 3: '自我提升', 4: '行銷商業' }, ['自我提升'], 'zh');
assert.deepEqual(named.map(x => x.cat), ['滑雪', '其他', '自我提升', '其他']);
const english = [{}, {}];
C.applyCategories(english, { 1: 'Home Decor', 2: 'Arts and Crafts' }, [], 'en');
assert.deepEqual(english.map(x => x.cat), ['Home Decor', 'Other']);
});

test("summaryPrompt: sources, a fixed budget and the user instructions", () => {
assert.match(C.summaryPrompt('美髮', [post], 'en'), /\[1\] @hairbykai: .*\[image: text: 剪髮步驟/);
assert.doesNotMatch(C.summaryPrompt('美髮', [post], 'en'), /instructions from the user|Previous digest/);
const long = 'x'.repeat(5000);
const big = Array.from({ length: 200 }, (_, i) => ({ id: String(i), user: 'u', caption: long, alt: long }));
assert.ok(C.summaryPrompt('T', big, 'zh').length < 75000, 'summary prompt over budget');
assert.ok(C.summaryPrompt('T', big.slice(0, 3), 'zh').includes('x'.repeat(1500)));
const refine = C.summaryPrompt('美髮', [post], 'zh', ['用底層邏輯收斂', '合併同質內容'], '• 舊摘要 [1]');
assert.match(refine, /- 用底層邏輯收斂\n- 合併同質內容/);
assert.match(refine, /Previous digest.*\n• 舊摘要 \[1\]/);
});

test("matches searches every field, case-insensitively", () => {
assert.ok(C.matches({ username: 'KaiHair', name: '' }, 'kaih'));
assert.ok(C.matches({ user: 'x', caption: '', alt: '', cat: '滑雪' }, '滑雪'));
assert.ok(!C.matches({ user: 'x', caption: 'abc' }, 'zzz'));
});

test("smallTopics and mergeSmall move small topics into big ones", () => {
const pool = [...many('娛樂', 6), ...many('喜劇', 2), ...many('玩具', 1), ...many('其他', 1), ...many('好友', 1), ...many('滑雪', 1, { manual: true }), { id: 'mx', cat: '玩具', manual: true }];
assert.deepEqual(C.smallTopics(pool, 'zh'), { small: ['喜劇', '玩具'], big: ['娛樂'] });
assert.deepEqual(C.smallTopics(many('喜劇', 2), 'zh').small, []);
const smallSums = { 喜劇: [{ id: 'd1', text: 't', sourceIds: [] }], 玩具: [{ id: 'd2', text: 't', sourceIds: [] }] };
assert.equal(C.mergeSmall(pool, smallSums, { 喜劇: '娛樂', 玩具: '娛樂', 滑雪: '不存在' }, ['娛樂']), 3);
assert.equal(pool.filter(x => x.cat === '娛樂').length, 9);
assert.equal(pool.find(x => x.id === 'mx').cat, '玩具');
assert.deepEqual(Object.keys(smallSums), ['玩具', '娛樂']);
});

test("categorizePrompt lists definitions one per line", () => {
const defined = C.categorizePrompt([post], ['心靈', '成長'], 'zh', { 心靈: '情緒、療癒' });
assert.match(defined, /\n  心靈: 情緒、療癒\n  成長\n/);
assert.match(C.categorizePrompt([post], ['心靈', '成長'], 'zh', { 其他: 'x' }), /from this list: 心靈, 成長\n/);
});

test("parseTidy keeps only usable merges and definitions", () => {
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

test("digestLines splits bullets, nesting and a short lead label, and drops blank lines", () => {
  const lines = C.digestLines('• 刻滑（Carving）：保持放鬆感 [4][13]\n\n• 單板走刃與刻滑技巧調整：\n   ◦ 入彎時重心前移 [2]\nplain closing line');
  assert.deepEqual(lines, [
    { depth: 0, bullet: true, lead: '刻滑（Carving）', body: '保持放鬆感 [4][13]' },
    { depth: 0, bullet: true, lead: '單板走刃與刻滑技巧調整', body: '' },
    { depth: 1, bullet: true, body: '入彎時重心前移 [2]' },
    { depth: 0, bullet: false, body: 'plain closing line' },
  ]);
});

test("digestLines leaves a long sentence with a colon as body, not a lead", () => {
  const [l] = C.digestLines('• 這是一個很長很長的句子，裡面剛好也有冒號出現在後面：然後繼續 [1]');
  assert.equal(l.lead, undefined);
});

test("modelOptions lists Gemini 4 names, hides retired 2.x unless saved, and backups stay on flash", () => {
  const names = ['models/gemini-4-neon', 'models/gemini-3.8-live', 'models/gemini-3.8-flash', 'models/gemini-2.5-flash-lite', 'models/gemini-4-tts', 'models/gemini-3.5-flash-lite'];
  assert.deepEqual(C.modelOptions(names, []).map(m => m.name), ['gemini-4-neon', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  assert.ok(C.modelOptions(names, ['gemini-2.5-flash-lite']).some(m => m.name === 'gemini-2.5-flash-lite'));
  assert.deepEqual(C.backupModels(names), ['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
});

test("modelOptions keeps text models newest first, tags tiers and always lists the saved choice", () => {
  const got = C.modelOptions(
    ['models/gemini-3.5-flash-lite', 'models/gemini-3.8-flash', 'models/gemini-3.8-pro', 'models/gemini-3.8-flash-preview-tts',
      'models/gemini-3.8-flash-image', 'models/text-embedding-004', 'models/gemini-3.8-flash-lite'],
    ['my-custom-model', 'gemini-3.8-flash']);
  assert.deepEqual(got, [
    { name: 'gemini-3.8-pro', tier: 'quality' },
    { name: 'gemini-3.8-flash', tier: 'balanced' },
    { name: 'gemini-3.8-flash-lite', tier: 'quota' },
    { name: 'gemini-3.5-flash-lite', tier: 'quota' },
    { name: 'my-custom-model', tier: undefined },
  ]);
});
