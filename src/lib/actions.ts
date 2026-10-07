import * as Core from '@/core';
import type { Digest, Item, Post, User } from '@/core';
import { gemini } from './gemini';
import { t, when } from './i18n';
import { fromIg } from './ig';
import { clearThumbs, fetchThumbs } from './thumbs';
import { allItems, ask, avatars, db, DEFAULTS, emit, save, status, ui } from './store';

const DAY = 864e5;

// One action at a time. While busy, action buttons are disabled so ignored clicks are visible.
export async function run(fn: () => Promise<void>) {
  if (ui.busy) return;
  Object.assign(ui, { busy: true, progress: 'busy' });
  emit();
  try { await fn(); } catch (e) { status(t('error', (e as Error).message), true); }
  finally { Object.assign(ui, { busy: false, progress: null }); emit(); }
}

// Runs only when the user presses Sync: no background fetching, to keep IG traffic low.
export const sync = () => run(async () => {
  status(t('syncingSaved'));
  // ponytail: 50 pages caps the first import (~1000 posts) for good: later syncs stop at the
  // first known post, so older posts are never reached. Store next_max_id to resume if needed.
  // Posts synced before avatars (pic) or covers (thumb) existed lack those URLs: refetch the whole
  // list once (passing no known ids) to fill them in. Topics and manual picks survive through mergeById.
  const backfill = db.saved.some(p => p.pic === undefined || p.thumb === undefined);
  const saved = await fromIg<Parameters<typeof Core.slimPost>[0]>('saved', backfill ? [] : db.saved.map(x => x.id), 50);
  db.saved = Core.mergeById(saved.map(Core.slimPost), db.saved);
  // Posts past the 50-page cap stay without URLs; mark them so the refetch never repeats.
  for (const p of db.saved) { p.pic ??= ''; p.thumb ??= ''; }
  db.lastSync.saved = Date.now();
  await save(); // keep saved progress even if the following fetch below fails
  emit();

  // Following has no "newest first" order, so it is a full refetch: at most once a day,
  // however often Sync is pressed.
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
    // Followers are only needed to spot mutual follows (friends); the list itself is not stored.
    // ponytail: 40 pages x 50 = 2000 followers read; past that, mutual friends fall back to the private-account signal.
    status(t('syncingFollowers'));
    const followers = await fromIg<Parameters<typeof Core.slimUser>[0]>('followers', [], 40);
    Core.markFriends(db.following, new Set(followers.map(u => Core.slimUser(u).id)), db.settings.lang);
    db.lastSync.following = Date.now();
  }
  await save();
  await fetchAvatars();
  await fetchThumbs();
  if (!db.settings.apiKey) return status(t('needKey'));
  await categorize();
  status(t('synced', new Date().toLocaleTimeString()));
});

// IG's CDN blocks <img> on other sites, and its URLs expire. host_permissions let the extension
// fetch them, so each avatar is downloaded once and kept as a data URL under its own storage key.
// ponytail: never refreshed once stored; a changed avatar stays old until "Delete all data".
async function fetchAvatars() {
  const urls = new Map<string, string>();
  for (const p of db.saved) if (p.pic) urls.set(p.user, p.pic);
  for (const u of db.following) if (u.pic) urls.set(u.username, u.pic); // fresher than saved posts: wins
  const todo = [...urls].filter(([name]) => !avatars[name]);
  const total = todo.length;
  let done = 0;
  const worker = async () => {
    for (let job; (job = todo.pop()); ) {
      const [name, url] = job;
      try {
        const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (r.ok) {
          const blob = await r.blob();
          avatars[name] = await new Promise<string>(res => {
            const f = new FileReader();
            f.onload = () => res(f.result as string);
            f.readAsDataURL(blob);
          });
        }
      } catch { /* expired or blocked: the placeholder stays */ }
      ui.progress = ++done / total;
      status(t('syncingAvatars', done, total));
    }
  };
  // ponytail: 6 at a time; the CDN is not the rate-limited API, so no pauses.
  await Promise.all(Array.from({ length: 6 }, worker));
  if (total) await chrome.storage.local.set({ avatars });
}

export async function categorize() {
  const cats = () => Core.groupCounts(allItems()).map(([c]) => c);
  // Following first: it is cheap (only @name + display name, so 400 per call) and a quota
  // error during saved posts would otherwise leave it untouched. Saved posts carry captions: 150 per call.
  // Big batches keep a full first sort (~600 follows + ~500 posts) to about 5 calls of the daily quota.
  for (const [list, size] of [[db.following, 400], [db.saved, 150]] as [Item[], number][]) {
    const todo = list.filter(x => !x.cat);
    for (let i = 0; i < todo.length; i += size) {
      ui.progress = i / todo.length;
      status(t('categorizing', i, todo.length));
      const batch = todo.slice(i, i + size);
      Core.applyCategories(batch, Core.parseJson(await gemini(Core.categorizePrompt(batch, cats(), db.settings.lang), true, db.settings.model)));
      await save();
      emit();
    }
  }
}

/** Resume sorting without touching IG (Sync would fetch again) after a quota error or a stop. */
export const sortRest = () => run(async () => { await categorize(); status(t('sortDone')); });

// A topic holds a list of digests: different angles on the same posts (key points, formulas…).
// i: which digest; undefined makes the topic's first one.
// note: an instruction, saved on the digest so later updates keep applying it.
// asNew: build a new digest from digest i and leave digest i untouched.
export const summarize = (cat: string, i?: number, note = '', asNew = false) => run(async () => {
  status(t('summarizing'));
  const list = (db.summaries[cat] ||= []);
  const old = i === undefined ? undefined : list[i];
  const notes = asNew ? [note.trim()] : [...(old?.notes || []), note.trim()].filter(Boolean);
  const posts = Core.orderSources(old?.sourceIds || [], db.saved.filter(x => x.cat === cat));
  const text = await gemini(Core.summaryPrompt(cat, posts, db.settings.lang, notes, old?.text), false, db.settings.summaryModel, db.settings.model);
  // A blocked prompt returns no text; saving it would wipe the old digest and mark it up to date.
  if (!text.trim()) throw new Error('Gemini: empty response');
  const next: Digest = { id: old && !asNew ? old.id : Date.now().toString(36), title: asNew ? note.trim() : old?.title, text, sourceIds: posts.map(p => p.id), notes, at: Date.now() };
  if (asNew) {
    list.push(next);
    ui.opened.add(cat + '#' + next.id); // show the new digest open
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

// Topics are shared by following and saved, so both lists change together.
// Renaming onto an existing topic merges the two (the UI warns before Enter).
export async function renameTopic(from: string, to: string) {
  if (!to || to === from || ui.busy) return;
  Core.renameCat(allItems(), db.summaries, from, to);
  if (ui.view.cat === from) ui.view.cat = to;
  await save();
  emit();
}

export async function deleteTopic(cat: string) {
  const n = allItems().filter(x => x.cat === cat).length;
  if (!(await ask({ msg: t('confirmDeleteCat', cat, n), ok: t('deleteCat'), danger: true })) || ui.busy) return;
  Core.deleteCat(allItems(), db.summaries, cat);
  if (ui.view.cat === cat) ui.view.cat = '';
  await save();
  emit();
}

/** Move one item by hand. manual = true keeps the choice through "Re-sort everything". */
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
  // A running sync picks up the new key itself; otherwise sort what is already synced.
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
  Object.assign(db, { following: [] as User[], saved: [] as Post[], summaries: {}, lastSync: {} });
  for (const k of Object.keys(avatars)) delete avatars[k];
  await chrome.storage.local.clear();
  await clearThumbs();
  await save();
  emit();
}

/** Loads storage and moves old data forward. Called once before the first render. */
export async function load() {
  const { avatars: stored, ...rest } = (await chrome.storage.local.get(null)) as Partial<typeof db> & { avatars?: Record<string, string> };
  Object.assign(avatars, stored);
  Object.assign(db, rest);
  // Settings saved before summaryModel existed used 3.8-flash for sorting too; move sorting to lite once.
  if (db.settings?.model && !db.settings.summaryModel && db.settings.model === 'gemini-3.8-flash') db.settings.model = DEFAULTS.model;
  db.settings = { ...DEFAULTS, ...db.settings };
  db.summaries = Core.normalizeSummaries(db.summaries);
  // Lists stored before uniqById may hold the same account or post twice (IG paging overlap).
  db.following = Core.uniqById(db.following);
  db.saved = Core.uniqById(db.saved);
  // gemini-2.x returns 404 for keys created after 2026-09-18; move saved settings off it.
  if (/^gemini-2\./.test(db.settings.model)) db.settings.model = DEFAULTS.model;
  // Follows stored before the friend rule (private/verified) or avatars (pic) lack fields: refetch on the next Sync.
  if (db.following.length && (db.following[0].private === undefined || db.following[0].pic === undefined)) db.lastSync.following = 0;
  if (!db.settings.apiKey) ui.view.tab = 'settings';
  ui.status = t('lastSync', when(db.lastSync.saved), when(db.lastSync.following));
}
