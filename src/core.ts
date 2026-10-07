// Pure logic, no chrome.* APIs, so `npm test` can check it.

export type Lang = 'zh' | 'en';
export type PostType = 'image' | 'video' | 'carousel' | 'post';

interface Tagged {
  id: string;
  cat?: string;
  /** Picked by hand: survives "Re-sort everything" and the friend rule. */
  manual?: boolean;
  /** IG CDN avatar URL. Signed and expires; following refreshes it daily, saved posts never do. */
  pic?: string;
}
export interface User extends Tagged { username: string; name: string; private: boolean; verified: boolean }
export interface Post extends Tagged {
  code: string; user: string; caption: string; alt: string; type: PostType; takenAt: number;
  /** Cover image URL on IG's CDN ('' = none). Signed and expires, so sync downloads it right away. */
  thumb?: string;
  /** Original size, for the grid's aspect ratio. */
  w?: number;
  h?: number;
}
export type Item = User | Post;

export interface Digest {
  id: string;
  /** Set for digests made with "Save as new": the instruction that made it. */
  title?: string;
  text: string;
  sourceIds: string[];
  /** The user's rewrite instructions, re-applied on every update. */
  notes?: string[];
  at?: number;
  /** One level of undo. */
  prev?: Omit<Digest, 'prev'>;
}
export type Summaries = Record<string, Digest[]>;

// Only the fields we read from IG's private API.
interface IgImage { image_versions2?: { candidates?: { url: string; width: number; height: number }[] }; original_width?: number; original_height?: number }
interface IgMedia extends IgImage {
  id?: string; pk?: number | string; code: string; media_type?: number; taken_at?: number;
  user?: { username?: string; profile_pic_url?: string };
  caption?: { text?: string } | null;
  accessibility_caption?: string;
  carousel_media?: (IgImage & { accessibility_caption?: string })[];
}

// Cover image: the post's own image (a video's is its cover frame), or a carousel's first slide.
// Smallest candidate at least 400 px wide: sharp in a ~240 px grid column on a 2x screen, ~40 KB.
export function thumbOf(m: IgMedia): Pick<Post, 'thumb' | 'w' | 'h'> {
  const src = m.image_versions2?.candidates?.length ? m : m.carousel_media?.[0];
  const sizes = [...(src?.image_versions2?.candidates || [])].sort((a, b) => a.width - b.width);
  const c = sizes.find(x => x.width >= 400) ?? sizes.at(-1);
  if (!c) return { thumb: '' };
  return { thumb: c.url, w: src?.original_width || c.width, h: src?.original_height || c.height };
}
interface IgUser { id?: string; pk?: number | string; username: string; full_name?: string; is_private?: boolean; is_verified?: boolean; profile_pic_url?: string }

const TYPES: Record<number, PostType> = { 1: 'image', 2: 'video', 8: 'carousel' };
const LANGS = {
  zh: { name: 'Traditional Chinese (Taiwan)', other: '其他', friends: '好友', eg: '美髮、行銷、滑雪、美食、趣味' },
  en: { name: 'English', other: 'Other', friends: 'Friends', eg: 'Hair, Marketing, Skiing, Food, Humor' },
};
const lang = (l: string) => LANGS[l as Lang] || LANGS.en;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
// Media pk (~3e18) is above 2^53 and loses digits as a JSON number; the string `id`
// ("<pk>_<owner>") does not. igFetch in lib/ig.ts must use the same rule.
const idOf = (x: { id?: string; pk?: number | string }) => String(x.id ?? x.pk).split('_')[0];

export const isUser = (x: Item): x is User => (x as User).username !== undefined;

// IG's alt text ("May be an image of text that says ...") is free OCR for carousels.
export function slimPost(m: IgMedia): Post {
  const alts = [m.accessibility_caption, ...(m.carousel_media || []).map(c => c.accessibility_caption)].filter(Boolean);
  return {
    id: idOf(m),
    code: m.code,
    user: m.user?.username || '',
    caption: m.caption?.text || '',
    alt: [...new Set(alts)].join(' | '),
    type: TYPES[m.media_type ?? 0] || 'post',
    takenAt: m.taken_at || 0,
    pic: m.user?.profile_pic_url || '',
    ...thumbOf(m),
  };
}

export const slimUser = (u: IgUser): User =>
  ({ id: idOf(u), username: u.username, name: u.full_name || '', private: !!u.is_private, verified: !!u.is_verified, pic: u.profile_pic_url || '' });

// Rule, not AI: the model only sees a handle and a name and cannot tell a friend from a shop.
// Friend = not verified AND (follows you back OR private account). Hand-picked topics win.
// ponytail: mutual small shops/creators land here too; the user moves them once (manual sticks).
export function markFriends(users: User[], followerIds: Set<string>, l: string) {
  const label = lang(l).friends;
  let n = 0;
  for (const u of users) {
    if (u.manual || u.verified || !(u.private || followerIds.has(u.id))) continue;
    u.cat = label;
    n++;
  }
  return n;
}

// IG's list paging can repeat an account or post across pages. First copy wins, order kept.
export const uniqById = <T extends Tagged>(xs: T[]): T[] => {
  const seen = new Set<string>();
  return xs.filter(x => !seen.has(x.id) && !!seen.add(x.id));
};

// Full refetch (following): drop accounts no longer present, keep old category tags
// and the manual flag (user-chosen topics survive re-sorting).
export function keepCats<T extends Tagged>(fresh: T[], old: T[]): T[] {
  const prev = new Map(old.map(x => [x.id, x]));
  return uniqById(fresh).map(x => {
    const o = prev.get(x.id);
    return o?.cat ? { ...x, cat: o.cat, ...(o.manual && { manual: true }) } : x;
  });
}

// Incremental fetch (saved): new items first, old ones after.
// ponytail: never sees un-saves; add a full-refetch button if that matters.
export function mergeById<T extends Tagged>(fresh: T[], old: T[]): T[] {
  const out = keepCats(fresh, old);
  const ids = new Set(out.map(x => x.id));
  return out.concat(uniqById(old).filter(x => !ids.has(x.id)));
}

export function itemText(x: Item, max = 300) {
  if (isUser(x)) return `@${x.username} ${x.name}`.trim();
  const alt = x.alt ? ` [image: ${clip(x.alt, max)}]` : '';
  return `@${x.user}: ${clip(x.caption.replace(/\s+/g, ' '), max)}${alt}`;
}

export function categorizePrompt(items: Item[], cats: string[], l: string) {
  const L = lang(l);
  return [
    'Sort these Instagram items (followed accounts or saved posts) into broad topic categories.',
    `- Write category names in ${L.name}, short (1-4 words), like: ${L.eg}.`,
    `- Reuse an existing category when it fits. Existing: ${cats.length ? cats.join(', ') : '(none)'}`,
    '- Create a new category only when none fits. Keep the total under 15.',
    `- Use "${L.other}" when you cannot tell.`,
    'Return only a JSON object that maps every item number to one category, e.g. {"1": "...", "2": "..."}.',
    '',
    ...items.map((x, i) => `${i + 1}. ${itemText(x)}`),
  ].join('\n');
}

// Free-tier tokens-per-minute is small: one 114-post prompt at 1500 chars (caption + alt each)
// was ~340k chars and got 429 on every retry. Fixed total budget: more posts, shorter clips.
// ponytail: chars, not tokens; CJK is about 1 token per char, so 60k chars stays well under the limit.
const SUMMARY_BUDGET = 60000;
const perPost = (n: number) => Math.max(150, Math.min(1500, Math.floor(SUMMARY_BUDGET / 2 / Math.max(n, 1))));

// notes: the user's saved rewrite instructions, re-applied on every regenerate.
// current: the previous digest, so a rewrite improves it instead of starting over.
export function summaryPrompt(cat: string, posts: Post[], l: string, notes: string[] = [], current = '') {
  const L = lang(l);
  const extra = [
    ...(notes.length ? ['', 'Follow these instructions from the user (later ones win on conflict):', ...notes.map(n => `- ${n}`)] : []),
    ...(current ? ['', 'Previous digest. Use it as the base; the instructions above decide the new form. Keep the [n] source numbers valid:', current] : []),
  ];
  return [
    `These are Instagram posts a user saved under the topic "${cat}".`,
    `Write a digest in ${L.name} so the user does not need to open each post.`,
    '- Plain text, no Markdown. Use "• " bullets.',
    '- Merge overlapping points. Keep concrete steps, numbers, names, places and tools.',
    '- End every bullet with its source numbers, e.g. [2][5].',
    '- Skip greetings, ads and filler.',
    ...extra,
    '',
    'Sources:',
    ...posts.map((p, i) => `[${i + 1}] ${itemText(p, perPost(posts.length))}`),
  ].join('\n');
}

export function parseJson(text: string): Record<string, unknown> {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  for (const s of [t, t.match(/\{[\s\S]*\}/)?.[0]]) {
    try { if (s) return JSON.parse(s); } catch { /* try next */ }
  }
  return {};
}

// Items the model skipped stay untagged and get retried on the next run.
export function applyCategories(batch: Tagged[], map: Record<string, unknown>) {
  let n = 0;
  batch.forEach((x, i) => {
    const c = map[String(i + 1)];
    if (typeof c === 'string' && c.trim()) { x.cat = c.trim(); n++; }
  });
  return n;
}

// Rename a topic on every item and its digests. Renaming onto an existing topic merges the two.
// ponytail: the friend label is fixed, so a renamed 好友 comes back for non-manual follows on the next daily refetch.
export function renameCat(items: Tagged[], summaries: Summaries, from: string, to: string) {
  let n = 0;
  for (const x of items) if (x.cat === from) { x.cat = to; n++; }
  if (summaries[from]) {
    summaries[to] = [...(summaries[to] || []), ...summaries[from]];
    delete summaries[from];
  }
  return n;
}

// Delete a topic: its items go back to unsorted (and lose the manual flag), so the next sort
// run places them again; its digests are deleted.
export function deleteCat(items: Tagged[], summaries: Summaries, cat: string) {
  let n = 0;
  for (const x of items) if (x.cat === cat) { delete x.cat; delete x.manual; n++; }
  delete summaries[cat];
  return n;
}

export function groupCounts(items: Tagged[]): [string, number][] {
  const m: Record<string, number> = {};
  for (const x of items) if (x.cat) m[x.cat] = (m[x.cat] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

// Before v0.2 a topic held one digest object; now it holds a list of digests (different angles
// on the same posts, each with its own instructions). Converts in place, safe to run every load.
export function normalizeSummaries(all: Record<string, Digest[] | Omit<Digest, 'id'>> = {}): Summaries {
  for (const [cat, v] of Object.entries(all)) if (!Array.isArray(v)) all[cat] = [{ id: 'd0', ...v }];
  return all as Summaries;
}

// Old sources keep their [n] numbers; new posts are appended after them.
export function orderSources(prevIds: string[], posts: Post[]): Post[] {
  const byId = new Map(posts.map(p => [p.id, p]));
  const had = new Set(prevIds);
  return prevIds.map(id => byId.get(id)).filter((p): p is Post => !!p).concat(posts.filter(p => !had.has(p.id)));
}

export function newSources(summary: Pick<Digest, 'sourceIds'>, posts: Tagged[]) {
  const had = new Set(summary.sourceIds);
  return posts.filter(p => !had.has(p.id)).length;
}

export const matches = (x: Item, q: string) => {
  const u = x as Partial<User & Post>;
  return [u.username, u.name, u.user, u.caption, u.alt, u.cat].join(' ').toLowerCase().includes(q.toLowerCase());
};
