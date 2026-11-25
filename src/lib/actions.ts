import * as Core from '@/core';
import type { Digest, Item, Lang, Post, User } from '@/core';
import { toast } from 'sonner';
import { record } from './error-log';
import { gemini, Notice } from './gemini';
import { t, when } from './i18n';
import { fromIg } from './ig';
import { clearThumbs, coverJobs, pool } from './thumbs';
import { allItems, askConfirm, askText, avatars, db, DB_KEYS, DEFAULTS, emit, save, status, ui, uiLang, type DB, type Settings } from './store';

const DAY = 864e5;
const FOLLOWS_PER_CALL = 400;
const POSTS_PER_CALL = 150;
const FRIEND_CHECKS_PER_CALL = 40;
const POSTS_PER_EXTRACT = 60;

// Stops an action to tell the user something that is not a failure, so it is shown without the error prefix.

export async function run(fn: () => Promise<void>) {
  if (ui.busy) return;
  Object.assign(ui, { busy: true, progress: 'busy', status: '' });
  emit();
  // 狀態列只顯示進度；結果用 toast 回報，結束後狀態列回到上次同步時間
  try {
    await fn();
    if (ui.status) toast(ui.status);
  } catch (e) {
    if (e instanceof Notice) { if (e.alert) toast.error(e.message, { duration: 10000 }); else toast(e.message); return; }
    toast.error(t('error', (e as Error).message), { duration: 10000 });
    void record(e, 'action').catch(() => {});
  }
  finally { Object.assign(ui, { busy: false, progress: null, status: idleStatus(), err: false }); emit(); }
}

export const sync = () => run(async () => {
  status(t('syncingSaved'));
  // ponytail: 50 pages caps the first import (~1000 posts) for good: later syncs stop at the
  // first known post, so older posts are never reached. Store next_max_id to resume if needed.
  const saved = await fromIg<Parameters<typeof Core.slimPost>[0]>('saved', db.lastSync.saved ? db.saved.map(x => x.id) : [], 50);
  db.saved = Core.mergeById(saved.map(Core.slimPost), db.saved);
  db.lastSync.saved = Date.now();
  await save();
  emit();

  if (Date.now() - (db.lastSync.following || 0) > DAY) {
    status(t('syncingFollowing'));
    // ponytail: 40 pages x 50 = 2000 accounts max; raise if someone follows more.
    const following = await fromIg<Parameters<typeof Core.slimUser>[0]>('following', [], 40);
    // Less than half the stored list usually means IG cut paging short, not a mass unfollow.
    // Refuse it once; the same short count on the next Sync is accepted as real.
    const short = following.length < db.following.length / 2;
    if (short && db.shortFollowing !== following.length) {
      db.shortFollowing = following.length;
      await save();
      throw new Notice(t('followingShrank', following.length, db.following.length));
    }
    delete db.shortFollowing;
    db.following = Core.keepCats(following.map(Core.slimUser), db.following);
    // ponytail: 40 pages x 50 = 2000 followers read; past that, mutual friends fall back to the private-account signal.
    status(t('syncingFollowers'));
    const followers = await fromIg<Parameters<typeof Core.slimUser>[0]>('followers', [], 40);
    Core.markFriends(db.following, new Set(followers.map(u => Core.slimUser(u).id)), db.settings.lang);
    db.lastSync.following = Date.now();
  }
  await save();
  const avatarJobs = avatarDownloads();
  const covers = await coverJobs();
  await pool([...avatarJobs, ...covers], job => job(), 'syncingImages');
  if (avatarJobs.length) await chrome.storage.local.set({ avatars });
  if (covers.length) { ui.thumbsVersion++; emit(); }
  if (!db.settings.apiKey) return status(t('needKey'));
  await categorize();
  status(t('synced', new Date().toLocaleTimeString()));
});

// IG's CDN blocks <img> on other sites, and its URLs expire. host_permissions let the extension
// fetch them, so each avatar is downloaded once and kept as a data URL under its own storage key.
// ponytail: never refreshed once stored; a changed avatar stays old until "Delete all data".
function avatarDownloads() {
  const urls = new Map<string, string>();
  for (const p of db.saved) if (p.pic) urls.set(p.user, p.pic);
  for (const u of db.following) if (u.pic) urls.set(u.username, u.pic);
  return [...urls].filter(([name]) => !avatars[name]).map(([name, url]) => async () => {
    const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) return;
    const blob = await r.blob();
    avatars[name] = await new Promise<string>(res => {
      const f = new FileReader();
      f.onload = () => res(f.result as string);
      f.readAsDataURL(blob);
    });
  });
}

export async function categorize() {
  const first = !allItems().some(x => x.cat);
  const cats = () => Core.groupCounts(allItems()).map(([c]) => c);
  const candidates = Core.friendCandidates(db.following);
  for (let i = 0; i < candidates.length; i += FRIEND_CHECKS_PER_CALL) {
    ui.progress = i / candidates.length;
    status(t('checkingFriends', i, candidates.length));
    const batch = candidates.slice(i, i + FRIEND_CHECKS_PER_CALL);
    Core.applyFriendCheck(batch, Core.parseJson(await gemini(Core.friendPrompt(batch), true, db.settings.model)), db.settings.lang);
    await save();
    emit();
  }
  for (const [list, size] of [[db.following, FOLLOWS_PER_CALL], [db.saved, POSTS_PER_CALL]] as [Item[], number][]) {
    const todo = list.filter(x => !x.cat);
    for (let i = 0; i < todo.length; i += size) {
      ui.progress = i / todo.length;
      status(t('categorizing', i, todo.length));
      const batch = todo.slice(i, i + size);
      const known = cats();
      const answer = Core.parseJson(await gemini(Core.categorizePrompt(batch, known, db.settings.lang, db.defs), true, db.settings.model));
      Core.applyCategories(batch, answer, known, db.settings.lang);
      db.onboarded = true;
      await save();
      emit();
    }
  }
  if (first && db.clubHint === undefined && allItems().some(x => x.cat)) { db.clubHint = true; await save(); }

  // ponytail: asks again on every run while a small topic has no similar big one; cheap on the lite model.
  const { small, big } = Core.smallTopics(allItems(), db.settings.lang);
  if (!small.length) return;
  status(t('mergingSmall', small.length));
  const map = Core.parseJson(await gemini(Core.mergePrompt(small, big, db.settings.lang), true, db.settings.model));
  Core.mergeSmall(allItems(), db.summaries, map, big);
  if (ui.view.cat && !allItems().some(x => x.cat === ui.view.cat)) ui.view.cat = '';
  await save();
  emit();
}

export const tidyTopics = () => run(async () => {
  status(t('tidying'));
  const items = [...db.saved, ...db.following];
  const answer = Core.parseJson(await gemini(Core.tidyPrompt(items, db.settings.lang), true, db.settings.summaryModel));
  const plan = Core.parseTidy(answer, items, db.settings.lang);
  if (!Object.keys(plan.defs).length) throw new Error(t('tidyEmpty'));
  ui.tidy = plan;
  status('');
});

export async function hideClubHint() {
  db.clubHint = false;
  await save();
  emit();
}

export async function applyTidy(merges: [string, string][], defs: Record<string, string>) {
  ui.tidy = null;
  for (const [from, to] of merges) {
    Core.renameCat(allItems(), db.summaries, from, to);
    if (ui.view.cat === from) ui.view.cat = to;
  }
  const live = new Set(Core.groupCounts(allItems()).map(([c]) => c));
  db.defs = Object.fromEntries(Object.entries({ ...db.defs, ...defs }).filter(([c]) => live.has(c)));
  await save();
  status(t('tidyDone', merges.length, Object.keys(db.defs).length));
}

export const sortRest = () => run(async () => { await categorize(); status(t('sortDone')); });

// One digest written from the topic's saved posts. Throws before anything is stored when Gemini returns no text:
// a blocked prompt returns none, and saving it would wipe the old digest and mark it up to date.
async function draft(cat: string, old: Digest | undefined, notes: string[]) {
  status(t('summarizing'));
  const posts = Core.orderSources(old?.sourceIds || [], db.saved.filter(x => x.cat === cat));
  const text = await gemini(Core.summaryPrompt(cat, posts, db.settings.lang, notes, old?.text), false, db.settings.summaryModel);
  if (!text.trim()) throw new Error(t('digestEmpty'));
  return { text, sourceIds: posts.map(p => p.id), notes, at: Date.now() };
}

/** Editor pipeline: pull separate ideas from the posts, then merge and edit them into one note. */
async function draftNote(cat: string, old: Digest | undefined, notes: string[]) {
  const posts = Core.orderSources(old?.sourceIds || [], db.saved.filter(x => x.cat === cat));
  const claims: Core.Claim[] = [];
  const skipped: Core.Skipped[] = [];
  const extract = async (numbers: number[], retry = false) => {
    for (let i = 0; i < numbers.length; i += POSTS_PER_EXTRACT) {
      ui.progress = i / numbers.length;
      status(t('notePulling', i, numbers.length));
      const batch = numbers.slice(i, i + POSTS_PER_EXTRACT);
      const prompt = Core.extractPrompt(batch.map(n => posts[n - 1]), batch, db.settings.lang, cat, retry);
      const answer = Core.parseJson(await gemini(prompt, true, db.settings.model));
      claims.push(...Core.parseClaims(answer, posts.length));
      skipped.push(...Core.parseSkipped(answer, posts.length));
    }
  };
  await extract(posts.map((_, i) => i + 1));
  await extract(Core.missedPosts(posts, [...claims, ...skipped]), true);
  const safe = claims.filter(c => !Core.isRisky(posts[c.n - 1]));
  for (const c of claims) if (Core.isRisky(posts[c.n - 1])) skipped.push({ n: c.n, why: 'risky' });
  if (!safe.length) throw new Notice(t('noteNoContent'));
  ui.progress = 'busy';
  status(t('noteEditing'));
  const thin = posts.length - new Set([...claims, ...skipped].map(c => c.n)).size;
  const prompt = Core.editPrompt(cat, safe, db.settings.lang, new Date().toISOString().slice(0, 10), notes, old?.edited ? old.text : '');
  let edited: Core.EditedNote | null = null;
  for (let tries = 0; tries < 2 && !edited; tries++) {
    edited = Core.parseNote(Core.parseJson(await gemini(prompt, true, db.settings.summaryModel)), posts.length, thin);
  }
  if (!edited) throw new Error(t('digestEmpty'));
  const problems = Core.noteProblems(edited);
  if (problems.length) {
    const fix = `${prompt}\n\nYour draft broke these rules. Return the full corrected JSON:\n${problems.map(p => `- ${p}`).join('\n')}\n\nDraft:\n${JSON.stringify(edited)}`;
    // The draft is already usable, so a failed fix keeps it instead of losing the whole note.
    const fixed = Core.parseNote(Core.parseJson(await gemini(fix, true, db.settings.summaryModel).catch(() => '')), posts.length, thin);
    if (fixed && Core.noteProblems(fixed).length < problems.length) edited = fixed;
  }
  edited.rest = Core.leftOver(edited, safe);
  edited.skipped = Core.groupSkipped(skipped, safe);
  return { text: Core.noteToText(edited), edited, sourceIds: posts.map(p => p.id), notes, at: Date.now() };
}

/** A new edited note next to digest i, so the two can be compared. Digest i stays as it is. */
export const editDigest = (cat: string, i: number) => run(async () => {
  const list = db.summaries[cat];
  const next: Digest = { ...(await draftNote(cat, undefined, list[i].notes || [])), id: Date.now().toString(36), title: t('noteTitle') };
  list.push(next);
  ui.opened.add(cat + '#' + next.id);
  await save();
  status('');
});

/** The topic's first digest, in slot 0. */
export const createDigest = (cat: string) => run(async () => {
  const next: Digest = { id: Date.now().toString(36), ...(await draftNote(cat, undefined, [])) };
  (db.summaries[cat] ||= [])[0] = next;
  await save();
  status('');
});

/** Rewrites digest i with its new posts and, if given, one more instruction kept for later updates. */
export const reviseDigest = (cat: string, i: number, note = '') => run(async () => {
  const list = db.summaries[cat];
  const old = list[i];
  const notes = [...(old.notes || []), note.trim()].filter(Boolean);
  const next = await (old.edited ? draftNote : draft)(cat, old, notes);
  // ponytail: one level of undo (prev); keep a list if people want to step back further.
  const { prev: _, ...undo } = old;
  list[i] = { ...next, id: old.id, title: old.title, prev: undo };
  await save();
  status('');
});

/** A new digest built from digest i and titled by the instruction; digest i stays as it is. */
export const branchDigest = (cat: string, i: number, note: string) => run(async () => {
  const list = db.summaries[cat];
  const next: Digest = { ...(await (list[i].edited ? draftNote : draft)(cat, list[i], [note.trim()])), id: Date.now().toString(36), title: note.trim() };
  list.push(next);
  ui.opened.add(cat + '#' + next.id);
  await save();
  status('');
});

export async function undoDigest(cat: string, i: number) {
  const list = db.summaries[cat];
  list[i] = { ...list[i].prev!, id: list[i].id };
  await save();
  emit();
}

export async function deleteDigest(cat: string, i: number) {
  if (!(await askConfirm({ title: t('deleteDigestTitle'), msg: t('confirmDeleteDigest'), ok: t('deleteDigestOk'), danger: true }))) return;
  const list = db.summaries[cat];
  list.splice(i, 1);
  if (!list.length) delete db.summaries[cat];
  await save();
  emit();
}

export async function renameTopic(from: string, to: string) {
  if (!to || to === from || ui.busy) return;
  Core.renameCat(allItems(), db.summaries, from, to);
  if (ui.view.cat === from) ui.view.cat = to;
  if (db.defs[from]) { db.defs[to] ??= db.defs[from]; delete db.defs[from]; }
  await save();
  emit();
}

export async function deleteTopic(cat: string) {
  const n = allItems().filter(x => x.cat === cat).length;
  if (!(await askConfirm({ title: t('deleteCatTitle', cat), msg: t('confirmDeleteCat', cat, n), ok: t('deleteCatOk'), danger: true })) || ui.busy) return;
  Core.deleteCat(allItems(), db.summaries, cat);
  delete db.defs[cat];
  if (ui.view.cat === cat) ui.view.cat = '';
  await save();
  emit();
}

export async function moveItem(x: Item, cat: string | null) {
  const c = cat ?? (await askText({ msg: t('newCatPrompt'), ok: t('create') }));
  if (!c) return;
  x.cat = c;
  x.manual = true;
  await save();
  emit();
}

export async function saveSettings(s: typeof db.settings) {
  Object.assign(db.settings, {
    apiKey: s.apiKey.trim(), model: s.model.trim() || DEFAULTS.model,
    summaryModel: s.summaryModel.trim() || DEFAULTS.summaryModel, lang: s.lang,
  });
  await save();
  toast(t('saved'));
  if (db.settings.apiKey) run(async () => { await categorize(); status(''); });
}

export const resortAll = async () => {
  if (!(await askConfirm({ msg: t('confirmResort'), ok: t('recategorize') }))) return;
  run(async () => {
    for (const x of allItems()) if (!x.manual) delete x.cat;
    Core.labelFriends(db.following, db.settings.lang);
    db.summaries = {};
    await save();
    if (!db.settings.apiKey) return status(t('needKey'));
    await categorize();
    status('');
  });
};

export async function clearAll() {
  if (ui.busy || !(await askConfirm({ msg: t('confirmClear'), ok: t('clearData'), danger: true })) || ui.busy) return;
  Object.assign(db, { following: [] as User[], saved: [] as Post[], summaries: {}, lastSync: {}, defs: {} });
  for (const k of Object.keys(avatars)) delete avatars[k];
  await chrome.storage.local.remove(['avatars']);
  await clearThumbs();
  await save();
  emit();
}

/** Stored data in any shape an older version wrote. Only upgrade() reads it. */
type Legacy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type Stored = Partial<Omit<DB, 'summaries' | 'saved' | 'following'>> & {
  summaries?: Parameters<typeof Core.normalizeSummaries>[0];
  saved?: Legacy<Post, 'pic' | 'thumb'>[];
  following?: Legacy<User, 'pic' | 'private' | 'mutual'>[];
};

/** Brings any stored shape up to DB. Pure, and load() runs it on every page open, so each step must be idempotent. */
export function upgrade(s: Stored, lang: Lang): DB {
  const old = s.settings;
  // Settings saved before summaryModel existed sorted with 3.8-flash: sorting moves to lite once.
  const model = old?.model === 'gemini-3.8-flash' && !old.summaryModel ? DEFAULTS.model : old?.model;
  const settings: Settings = { ...DEFAULTS, ...old, ...(model && { model }), lang: old?.lang || lang };
  // The list view was replaced by a compact grid.
  if ((settings.followView as string) === 'list') settings.followView = 'compact';
  // gemini-2.x returns 404 for keys created after 2026-09-18; move saved settings off it.
  if (/^gemini-2\./.test(settings.model)) settings.model = DEFAULTS.model;
  const lastSync = { ...s.lastSync };
  // Posts stored before covers (thumb) or avatars (pic) existed: fill '' and refetch the whole list on the next sync.
  if (s.saved?.some(p => p.pic === undefined || p.thumb === undefined)) lastSync.saved = 0;
  // Older versions let the model file posts under 好友. Those go back to unsorted; hand-picked ones stay.
  const friends = Core.friendsLabel(settings.lang);
  const notFriend = <T extends { cat?: string; manual?: boolean }>(p: T): T => {
    if (p.cat !== friends || p.manual) return p;
    const { cat: _, ...rest } = p;
    return rest as T;
  };
  const saved = Core.uniqById((s.saved ?? []).map(p => notFriend({ ...p, pic: p.pic ?? '', thumb: p.thumb ?? '' })));
  // Follows stored before the friend signals (private, mutual) or avatars (pic) existed: refetch on the next sync.
  const first = s.following?.[0];
  if (first && (first.private === undefined || first.mutual === undefined || first.pic === undefined)) lastSync.following = 0;
  const following = Core.uniqById((s.following ?? []).map(u => ({ ...u, pic: u.pic ?? '', private: u.private ?? false, mutual: u.mutual ?? false })));
  return {
    ...s, settings, following, saved, lastSync,
    summaries: Core.normalizeSummaries(s.summaries),
    defs: s.defs ?? {},
    onboarded: s.onboarded || [...following, ...saved].some(x => x.cat),
  };
}

const idleStatus = () => t('lastSync', when(db.lastSync.saved), when(db.lastSync.following));

export async function load() {
  const { avatars: stored, ...rest } = (await chrome.storage.local.get(null)) as Stored & { avatars?: Record<string, string> };
  Object.assign(avatars, stored);
  const own: Stored = {};
  for (const k of DB_KEYS) if (k in rest) Object.assign(own, { [k]: rest[k] });
  Object.assign(db, upgrade(own, uiLang()));
  ui.status = idleStatus();
}

