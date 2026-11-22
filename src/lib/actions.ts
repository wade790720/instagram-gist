import * as Core from '@/core';
import type { Digest, Item, Post, User } from '@/core';
import { record } from './error-log';
import { gemini } from './gemini';
import { t, when } from './i18n';
import { fromIg } from './ig';
import { clearThumbs, coverJobs, pool } from './thumbs';
import { allItems, ask, avatars, db, DB_KEYS, DEFAULTS, emit, save, status, ui } from './store';

const DAY = 864e5;

export async function run(fn: () => Promise<void>) {
  if (ui.busy) return;
  Object.assign(ui, { busy: true, progress: 'busy' });
  emit();
  try {
    await fn();
  } catch (e) {
    status(t('error', (e as Error).message), true);
    void record(e, 'action').catch(() => {});
  }
  finally { Object.assign(ui, { busy: false, progress: null }); emit(); }
}

export const sync = () => run(async () => {
  status(t('syncingSaved'));
  // ponytail: 50 pages caps the first import (~1000 posts) for good: later syncs stop at the
  // first known post, so older posts are never reached. Store next_max_id to resume if needed.
  const backfill = db.saved.some(p => p.pic === undefined || p.thumb === undefined);
  const saved = await fromIg<Parameters<typeof Core.slimPost>[0]>('saved', backfill ? [] : db.saved.map(x => x.id), 50);
  db.saved = Core.mergeById(saved.map(Core.slimPost), db.saved);
  for (const p of db.saved) { p.pic ??= ''; p.thumb ??= ''; }
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
      throw new Error(t('followingShrank', following.length, db.following.length));
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
  if (covers.length) { ui.thumbs++; emit(); }
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
  for (const [list, size] of [[db.following, 400], [db.saved, 150]] as [Item[], number][]) {
    const todo = list.filter(x => !x.cat);
    for (let i = 0; i < todo.length; i += size) {
      ui.progress = i / todo.length;
      status(t('categorizing', i, todo.length));
      const batch = todo.slice(i, i + size);
      const known = cats();
      const answer = Core.parseJson(await gemini(Core.categorizePrompt(batch, known, db.settings.lang, db.defs), true, db.settings.model));
      Core.applyCategories(batch, answer, known, db.settings.lang);
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
  const answer = Core.parseJson(await gemini(Core.tidyPrompt(items, db.settings.lang), true, db.settings.summaryModel, db.settings.model));
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

export const summarize = (cat: string, i?: number, note = '', asNew = false) => run(async () => {
  status(t('summarizing'));
  const list = (db.summaries[cat] ||= []);
  const old = i === undefined ? undefined : list[i];
  const notes = asNew ? [note.trim()] : [...(old?.notes || []), note.trim()].filter(Boolean);
  const posts = Core.orderSources(old?.sourceIds || [], db.saved.filter(x => x.cat === cat));
  const text = await gemini(Core.summaryPrompt(cat, posts, db.settings.lang, notes, old?.text), false, db.settings.summaryModel, db.settings.model);
  // A blocked prompt returns no text; saving it would wipe the old digest and mark it up to date.
  if (!text.trim()) throw new Error(t('digestEmpty'));
  const next: Digest = { id: old && !asNew ? old.id : Date.now().toString(36), title: asNew ? note.trim() : old?.title, text, sourceIds: posts.map(p => p.id), notes, at: Date.now() };
  if (asNew) {
    list.push(next);
    ui.opened.add(cat + '#' + next.id);
  } else {
    // ponytail: one level of undo (prev); keep a list if people want to step back further.
    if (old) { const { prev: _, ...rest } = old; next.prev = rest; }
    list[i ?? 0] = next;
  }
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
  if (!(await ask({ msg: t('confirmDeleteDigest'), ok: t('deleteDigest'), danger: true }))) return;
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
  if (!(await ask({ msg: t('confirmDeleteCat', cat, n), ok: t('deleteCat'), danger: true })) || ui.busy) return;
  Core.deleteCat(allItems(), db.summaries, cat);
  delete db.defs[cat];
  if (ui.view.cat === cat) ui.view.cat = '';
  await save();
  emit();
}

export async function moveItem(x: Item, cat: string | null) {
  const c = cat ?? (await ask({ msg: t('newCatPrompt'), ok: t('create'), input: true }));
  if (typeof c !== 'string' || !c) return;
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
  status(t('saved'));
  if (db.settings.apiKey) run(async () => { await categorize(); status(t('saved')); });
}

export const resortAll = async () => {
  if (!(await ask({ msg: t('confirmResort'), ok: t('recategorize') }))) return;
  run(async () => {
    for (const x of allItems()) if (!x.manual) delete x.cat;
    db.summaries = {};
    await save();
    if (!db.settings.apiKey) return status(t('needKey'));
    await categorize();
    status('');
  });
};

export async function clearAll() {
  if (ui.busy || !(await ask({ msg: t('confirmClear'), ok: t('clearData'), danger: true })) || ui.busy) return;
  Object.assign(db, { following: [] as User[], saved: [] as Post[], summaries: {}, lastSync: {}, defs: {} });
  for (const k of Object.keys(avatars)) delete avatars[k];
  await chrome.storage.local.remove([...DB_KEYS, 'avatars']);
  await clearThumbs();
  await save();
  emit();
}

export async function load() {
  const { avatars: stored, ...rest } = (await chrome.storage.local.get(null)) as Partial<typeof db> & { avatars?: Record<string, string> };
  Object.assign(avatars, stored);
  for (const k of DB_KEYS) if (k in rest) Object.assign(db, { [k]: rest[k] });
  if (db.settings?.model && !db.settings.summaryModel && db.settings.model === 'gemini-3.8-flash') db.settings.model = DEFAULTS.model;
  db.settings = { ...DEFAULTS, ...db.settings };
  db.summaries = Core.normalizeSummaries(db.summaries);
  db.following = Core.uniqById(db.following);
  db.saved = Core.uniqById(db.saved);
  // gemini-2.x returns 404 for keys created after 2026-09-18; move saved settings off it.
  if (/^gemini-2\./.test(db.settings.model)) db.settings.model = DEFAULTS.model;
  if (db.following.length && (db.following[0].private === undefined || db.following[0].pic === undefined)) db.lastSync.following = 0;
  ui.status = t('lastSync', when(db.lastSync.saved), when(db.lastSync.following));
}
