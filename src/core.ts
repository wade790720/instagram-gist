export type Lang = 'zh' | 'en';
export type PostType = 'image' | 'video' | 'carousel' | 'post';

interface Tagged {
  id: string;
  cat?: string;
  manual?: boolean;
  pic: string;
}
export interface User extends Tagged { username: string; name: string; private: boolean; verified: boolean; mutual: boolean; kind?: 'person' | 'page' }
export interface Post extends Tagged {
  code: string; user: string; caption: string; alt: string; type: PostType; takenAt: number;
  thumb: string;
  w?: number;
  h?: number;
}
export type Item = User | Post;

export interface Digest {
  id: string;
  title?: string;
  text: string;
  sourceIds: string[];
  notes?: string[];
  at?: number;
  prev?: Omit<Digest, 'prev'>;
  edited?: EditedNote;
}
export type Summaries = Record<string, Digest[]>;

interface IgImage { image_versions2?: { candidates?: { url: string; width: number; height: number }[] }; original_width?: number; original_height?: number }
interface IgMedia extends IgImage {
  id?: string; pk?: number | string; code: string; media_type?: number; taken_at?: number;
  user?: { username?: string; profile_pic_url?: string };
  caption?: { text?: string } | null;
  accessibility_caption?: string;
  carousel_media?: (IgImage & { accessibility_caption?: string })[];
}

const MIN_THUMB_WIDTH = 400;
export function thumbOf(m: IgMedia): Pick<Post, 'thumb' | 'w' | 'h'> {
  const src = m.image_versions2?.candidates?.length ? m : m.carousel_media?.[0];
  const sizes = [...(src?.image_versions2?.candidates || [])].sort((a, b) => a.width - b.width);
  const c = sizes.find(x => x.width >= MIN_THUMB_WIDTH) ?? sizes.at(-1);
  if (!c) return { thumb: '' };
  return { thumb: c.url, w: src?.original_width || c.width, h: src?.original_height || c.height };
}
interface IgUser { id?: string; pk?: number | string; username: string; full_name?: string; is_private?: boolean; is_verified?: boolean; profile_pic_url?: string }

const TYPES: Record<number, PostType> = { 1: 'image', 2: 'video', 8: 'carousel' };
const LANGS = {
  zh: {
    name: 'Traditional Chinese (Taiwan)', other: '其他', friends: '好友', tones: { key: '重點', method: '做法', action: '照做', caution: '留意' }, nameRule: 'exactly 2 Chinese characters',
    topics: ['行銷', '商業', '科技', '設計', '藝術', '攝影', '時尚', '美食', '旅遊', '生活', '娛樂', '音樂', '心靈', '運動'],
  },
  en: {
    name: 'English', other: 'Other', friends: 'Friends', tones: { key: 'Key', method: 'How', action: 'Do', caution: 'Watch' }, nameRule: 'one or two words',
    topics: ['Marketing', 'Business', 'Tech', 'Design', 'Art', 'Photography', 'Fashion', 'Food', 'Travel', 'Lifestyle', 'Entertainment', 'Music', 'Wellbeing', 'Sports'],
  },
};
const lang = (l: string) => LANGS[l as Lang] || LANGS.en;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
// Media pk (~3e18) is above 2^53 and loses digits as a JSON number; the string `id`
// ("<pk>_<owner>") does not. igFetch in lib/ig.ts must use the same rule.
const idOf = (x: { id?: string; pk?: number | string }) => String(x.id ?? x.pk).split('_')[0];

export const isUser = (x: Item): x is User => (x as User).username !== undefined;

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
  ({ id: idOf(u), username: u.username, name: u.full_name || '', private: !!u.is_private, verified: !!u.is_verified, mutual: false, pic: u.profile_pic_url || '' });

export const friendsLabel = (l: string) => lang(l).friends;

// Mutual and private is a friend outright. One signal alone also fits shops and creators, so the model checks those.
const isFriend = (u: User) => !u.verified && ((u.mutual && u.private) || (u.kind === 'person' && (u.mutual || u.private)));

export function labelFriends(users: User[], l: string) {
  const label = lang(l).friends;
  let n = 0;
  for (const u of users) {
    if (u.manual) continue;
    if (u.cat === label) delete u.cat;
    if (!isFriend(u)) continue;
    u.cat = label;
    n++;
  }
  return n;
}

export function markFriends(users: User[], followerIds: Set<string>, l: string) {
  for (const u of users) u.mutual = followerIds.has(u.id);
  return labelFriends(users, l);
}

export const friendCandidates = (users: User[]) =>
  users.filter(u => !u.manual && !u.verified && !u.kind && (u.mutual || u.private) && !(u.mutual && u.private));

export function friendPrompt(users: User[]) {
  return [
    'Each line is an Instagram account: its handle and display name. Decide who runs it.',
    '- "person": one private individual, such as a real name or a personal nickname.',
    '- "page": a shop, brand, studio, salon, restaurant, school, organization, media, fan, meme or topic account, or a person using the account as a business.',
    '- "unsure": the handle and name do not show which.',
    'Return only a JSON object that maps every number to "person", "page" or "unsure", e.g. {"1": "person", "2": "page"}.',
    '',
    ...users.map((u, i) => `${i + 1}. ${itemText(u)}`),
  ].join('\n');
}

// "unsure" counts as a person only for a mutual follow: following each other is the stronger signal.
export function applyFriendCheck(batch: User[], map: Record<string, unknown>, l: string) {
  batch.forEach((u, i) => {
    const v = map[String(i + 1)];
    if (v !== 'person' && v !== 'page' && v !== 'unsure') return;
    u.kind = v === 'person' || (v === 'unsure' && u.mutual) ? 'person' : 'page';
    if (u.kind === 'person') u.cat = lang(l).friends;
  });
}

// IG's list paging can repeat an account or post across pages. First copy wins, order kept.
export const uniqById = <T extends Tagged>(xs: T[]): T[] => {
  const seen = new Set<string>();
  return xs.filter(x => !seen.has(x.id) && !!seen.add(x.id));
};

export function keepCats<T extends Tagged>(fresh: T[], old: T[]): T[] {
  const prev = new Map(old.map(x => [x.id, x]));
  return uniqById(fresh).map(x => {
    const o = prev.get(x.id) as (T & Pick<User, 'kind'>) | undefined;
    const kept = o?.kind ? { ...x, kind: o.kind } : x;
    return o?.cat ? { ...kept, cat: o.cat, ...(o.manual && { manual: true }) } : kept;
  });
}

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

// The model names categories freely only when nothing constrains it, and the first batch's style then
// sticks: one run gave 2-character names, the next 4-character ones. So the list is fixed: the
// user's own categories once there are any, the starting list before that.
export function categorizePrompt(items: Item[], cats: string[], l: string, defs: Record<string, string> = {}) {
  const L = lang(l);
  // 好友 comes from the follow graph, never from the text. On a first sync it can be the only category there is.
  const named = cats.filter(c => c !== L.friends);
  const list = named.length ? named : [...L.topics, L.other];
  return [
    'Sort these Instagram items (followed accounts or saved posts) into broad topic categories.',
    ...(list.some(c => defs[c])
      ? ["- Pick each item's category from this list. A name may be followed by what belongs in it:", ...list.map(c => (defs[c] ? `  ${c}: ${defs[c]}` : `  ${c}`))]
      : [`- Pick each item's category from this list: ${list.join(', ')}`]),
    `- Only when an item fits none of them, create a new category in ${L.name}, ${L.nameRule}, in the same style as the list.`,
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

export function summaryPrompt(cat: string, posts: Post[], l: string, notes: string[] = [], current = '') {
  const L = lang(l);
  const extra = [
    ...(notes.length ? ['', 'Follow these instructions from the user (later ones win on conflict):', ...notes.map(n => `- ${n}`)] : []),
    ...(current ? ['', 'Previous digest. Use it as the base; the instructions above decide the new form. Keep the [n] source numbers valid:', current] : []),
  ];
  return [
    `These are Instagram posts a user saved under the topic "${cat}".`,
    `Write a digest in ${L.name} so the user does not need to open each post.`,
    '- Plain text, no Markdown. Use "• " bullets, and "   ◦ " for sub-points under a bullet.',
    `- Start every "• " bullet with one tag, then "｜", a short label, a colon and the content, e.g. "• ${L.tones.key}｜Label: content [1]".`,
    `- Tags: ${L.tones.key} = the main insight. ${L.tones.method} = how something works. ${L.tones.action} = a concrete step to do. ${L.tones.caution} = a pitfall, limit or risk.`,
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
    try { if (s) return JSON.parse(s); } catch {}
  }
  return {};
}

const fitsRule = (name: string, l: string) => (l === 'zh' ? [...name].length === 2 : name.split(/\s+/).length <= 2);
export function applyCategories(batch: Tagged[], map: Record<string, unknown>, known: string[] = [], l?: string) {
  let n = 0;
  batch.forEach((x, i) => {
    const c = map[String(i + 1)];
    if (typeof c !== 'string' || !c.trim()) return;
    const name = c.trim();
    x.cat = !l || (name !== lang(l).friends && (known.includes(name) || fitsRule(name, l))) ? name : lang(l).other;
    n++;
  });
  return n;
}

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

const SMALL = 5;
export function smallTopics(items: Tagged[], l: string) {
  const L = lang(l);
  const counts = groupCounts(items).filter(([c]) => c !== L.other && c !== L.friends);
  const big = counts.filter(([, n]) => n > SMALL).map(([c]) => c);
  const small = counts.filter(([c, n]) => n <= SMALL && items.some(x => x.cat === c && !x.manual)).map(([c]) => c);
  return { small: big.length ? small : [], big };
}

export function mergePrompt(small: string[], big: string[], l: string) {
  return [
    'These are topic categories for Instagram items. The small ones should join a similar big one.',
    '- For each small category, pick the most similar big category, e.g. comedy or toys -> entertainment.',
    '- If no big category is clearly similar, use "".',
    `- Answer with big category names exactly as written (they are in ${lang(l).name}).`,
    'Return only a JSON object that maps every small category to a big category or "", e.g. {"A": "B", "C": ""}.',
    '',
    `Big categories: ${big.join(', ')}`,
    `Small categories: ${small.join(', ')}`,
  ].join('\n');
}

export function mergeSmall(items: Tagged[], summaries: Summaries, map: Record<string, unknown>, big: string[]) {
  let n = 0;
  for (const [from, to] of Object.entries(map)) {
    if (typeof to !== 'string' || !big.includes(to) || to === from) continue;
    for (const x of items) if (x.cat === from && !x.manual) { x.cat = to; n++; }
    if (summaries[from] && !items.some(x => x.cat === from)) {
      summaries[to] = [...(summaries[to] || []), ...summaries[from]];
      delete summaries[from];
    }
  }
  return n;
}

const tidyNames = (items: Tagged[], l: string) => groupCounts(items).filter(([c]) => c !== lang(l).other && c !== lang(l).friends);
export function tidyPrompt(items: Item[], l: string) {
  const L = lang(l);
  return [
    'These are the topic categories a user sorts saved Instagram posts and followed accounts into.',
    'Several overlap, so the same post lands in different ones from run to run. Make the edges clear.',
    '- "merge": map a category to another category in the list only when a reader would see them as the same area (e.g. health and medicine). Keep the name with more items. Do not merge neighbours that are worth keeping apart.',
    `- "defs": for every category in the list, one short line in ${L.name} that says what belongs in it (${l === 'zh' ? 'at most 25 characters' : 'at most 12 words'}), so neighbouring categories do not overlap.`,
    'Return only JSON: {"merge": {"from": "to"}, "defs": {"category": "definition"}}.',
    '',
    ...tidyNames(items, l).map(([c, n]) => `${c} (${n} items): ${items.filter(x => x.cat === c).slice(0, 3).map(x => itemText(x, 80)).join(' / ')}`),
  ].join('\n');
}

export function parseTidy(answer: Record<string, unknown>, items: Tagged[], l: string) {
  const names = tidyNames(items, l).map(([c]) => c);
  const obj = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const merges = Object.entries(obj(answer.merge))
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[0] !== e[1] && names.includes(e[0]) && names.includes(e[1]));
  const froms = new Set(merges.map(([f]) => f));
  const defs = Object.fromEntries(Object.entries(obj(answer.defs))
    .filter((e): e is [string, string] => names.includes(e[0]) && typeof e[1] === 'string' && !!e[1].trim())
    .map(([c, d]) => [c, clip(d.trim(), 60)]));
  return { merges: merges.filter(([, to]) => !froms.has(to)), defs };
}

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

export function normalizeSummaries(all: Record<string, Digest[] | Omit<Digest, 'id'>> = {}): Summaries {
  for (const [cat, v] of Object.entries(all)) if (!Array.isArray(v)) all[cat] = [{ id: 'd0', ...v }];
  return all as Summaries;
}

/** One line of a digest, parsed for layout. `lead` is a short label before a colon ("刻滑：…"). */
export type DigestTone = keyof typeof LANGS.zh.tones;
export interface DigestLine { depth: 0 | 1; bullet: boolean; tone?: DigestTone; lead?: string; body: string }

export const toneLabel = (tone: DigestTone, l: string) => lang(l).tones[tone];
const toneOfTag = (tag: string) =>
  Object.values(LANGS).flatMap(L => Object.entries(L.tones)).find(([, word]) => word === tag)?.[0] as DigestTone | undefined;

export function digestLines(text: string): DigestLine[] {
  let parentTone: DigestTone | undefined;
  return text.split('\n').filter(l => l.trim()).map(line => {
    const m = line.match(/^(\s*)([•◦▪‣*-])\s+/);
    const depth = m && (m[1].length >= 2 || '◦▪‣'.includes(m[2])) ? 1 : 0;
    const raw = m ? line.slice(m[0].length) : line.trim();
    const tagged = depth ? null : raw.match(/^([^｜|\s]{1,6})\s*[｜|]\s*/);
    const own = tagged ? toneOfTag(tagged[1]) : undefined;
    if (!depth) parentTone = own;
    const tone = depth ? parentTone : own;
    const rest = own ? raw.slice(tagged![0].length) : raw;
    const lead = rest.match(/^([^：:[\]]{2,20})[：:]\s*/);
    return { depth, bullet: !!m, ...(tone && { tone }), ...(lead && { lead: lead[1] }), body: lead ? rest.slice(lead[0].length) : rest };
  });
}

export type ClaimKind = 'principle' | 'case' | 'data' | 'event';
export interface Claim { n: number; kind: ClaimKind; who?: string; text: string }
export type SkipWhy = 'teaser' | 'promo' | 'offtopic' | 'risky';
export interface Skipped { n: number; why: SkipWhy }
export interface NotePoint { text: string; sources: number[]; kind?: ClaimKind; steps?: string[] }
/** A digest an editor would sign: one thesis, chapters that are claims, and the rest kept apart from the knowledge. */
export interface EditedNote {
  thesis: string;
  chapters: { claim: string; points: NotePoint[] }[];
  tensions: { a: NotePoint; b: NotePoint }[];
  actions: string[];
  resources: NotePoint[];
  /** Ideas from posts the edited text never cites, so cutting can't silently lose a saved post. */
  rest?: NotePoint[];
  skipped?: Partial<Record<SkipWhy, number[]>>;
  thin: number;
}

const CLAIM_KINDS: ClaimKind[] = ['principle', 'case', 'data', 'event'];
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function extractPrompt(posts: Post[], numbers: number[], l: string, cat: string, retry = false) {
  return [
    `Read these saved Instagram posts and pull out their separate ideas, written in ${lang(l).name}.`,
    '- Every post goes in claims or in skipped.',
    '- A claim must state the idea itself. A hook that only promises it, like "3 sentences that beat 90% of people" or "follow along as we break it down", is not a claim.',
    '- One plain sentence that states an opinion IS a claim, like "the market buys certainty, not products". When unsure between a claim and a teaser, make it a claim: the editor cuts weak ones later.',
    `- skipped.why: "teaser" = the idea is only in the video or images, "promo" = it only pushes a course, link, DM or giveaway, "offtopic" = it does not belong under "${cat}".`,
    '- One idea per claim, but a named framework or step list stays whole in one claim, with every step.',
    '- Copy exact numbers, names, formulas, tools and steps. Never soften them into a general statement.',
    '- who: the person this post credits for the idea. Use "" if it names nobody. Never guess, and never use the account that posted it.',
    '- kind: "principle" = a general idea, "case" = a story about someone, "data" = a number or a fact, "event" = a course, talk, sale or anything people can sign up for. Research and product news are "data".',
    ...(retry ? ['- These posts were missed the first time. Give a claim to every post whose text states any idea.'] : []),
    'Return only JSON: {"claims": [{"n": <post number>, "kind": "principle", "who": "", "text": "..."}], "skipped": [{"n": <post number>, "why": "teaser"}]}',
    '',
    ...posts.map((p, i) => `[${numbers[i]}] ${itemText(p, 600)}`),
  ].join('\n');
}

export function parseClaims(raw: Record<string, unknown>, total: number): Claim[] {
  return list(raw.claims).flatMap(c => {
    const o = c as Record<string, unknown>;
    const n = Number(o?.n);
    const text = str(o?.text);
    const who = str(o?.who);
    const kind = CLAIM_KINDS.includes(o?.kind as ClaimKind) ? (o.kind as ClaimKind) : 'principle';
    return Number.isInteger(n) && n >= 1 && n <= total && text ? [{ n, kind, ...(who && { who }), text }] : [];
  });
}

const SKIP_WHYS: SkipWhy[] = ['teaser', 'promo', 'offtopic'];
// shortcut: keyword match on the post, so a finance topic loses these too; add a per-topic rule if people want them.
export const isRisky = (p: Post) => /信貸|質押|貸款|買借死/.test(p.caption + p.alt);
export function parseSkipped(raw: Record<string, unknown>, total: number): Skipped[] {
  return list(raw.skipped).flatMap(s => {
    const o = s as Record<string, unknown>;
    const n = Number(o?.n);
    return Number.isInteger(n) && n >= 1 && n <= total && SKIP_WHYS.includes(o?.why as SkipWhy) ? [{ n, why: o.why as SkipWhy }] : [];
  });
}

/** Skipped posts by reason. A post that also produced a claim was used, so it is not listed. */
export function groupSkipped(skipped: Skipped[], claims: Claim[]) {
  const used = new Set(claims.map(c => c.n));
  const out: Partial<Record<SkipWhy, number[]>> = {};
  // A post asked about twice can get two labels; the later answer wins.
  for (const [n, why] of new Map(skipped.map(s => [s.n, s.why]))) if (!used.has(n)) (out[why] ||= []).push(n);
  return out;
}

/** 1-based numbers of posts with real text that the model neither used nor skipped, to ask about once more. */
export function missedPosts(posts: Post[], done: { n: number; why?: SkipWhy }[]) {
  // A long caption is not a teaser, whatever the model called it.
  const wordy = (p: Post) => (p.caption + p.alt).replace(/#\S+/g, '').trim().length >= 120;
  const covered = new Set(done.filter(d => !(d.why === 'teaser' && wordy(posts[d.n - 1]))).map(d => d.n));
  return posts.flatMap((p, i) => (!covered.has(i + 1) && (p.caption + p.alt).trim().length >= 30 ? [i + 1] : []));
}

export function editPrompt(cat: string, claims: Claim[], l: string, today: string, notes: string[] = [], previous = '') {
  return [
    `You are a book editor turning notes on "${cat}" into one note worth rereading, written in ${lang(l).name}. Today is ${today}.`,
    'Work like this:',
    '1. Compare the claims across sources. Merge claims that say the same thing, even in different words, and cite all their sources.',
    '2. thesis = one sentence in plain words, at most 30 Chinese characters or 15 English words, taking a side that a smart person could disagree with.',
    '   Bad: "Success comes from efficient systems, great products and long-term action."',
    '   Good: "Delete work before you automate it: a tiny team wins only when what remains is worth doing."',
    '   Write it last: it must be what the chapters add up to, using only ideas in them.',
    '3. Write 2 to 6 chapters, as many as the ideas really need, grouped by idea, never by person, with no overlap. Each title makes one short claim, said the way you would tell a friend. If it needs "and", split the chapter or drop a part.',
    '   Bad: "Prioritize subtraction and first-principles optimization when executing projects." Good: "Delete a step before you speed it up."',
    '4. Each chapter has 2 to 5 points, one idea each, with no semicolons. Lead with the idea. One post\'s list of examples is one point, with the examples in steps.',
    '5. Keep the specifics. Never replace a number, name, formula or step with a general statement. A framework goes in one point: only its name in text, and each step in steps. Never repeat the steps in text.',
    '6. Cut repeats, filler and slogans with no reason or method, like "do what you love and never give up". Keep every distinct method, number and case. A short note from a few strong posts is better than padding.',
    '7. tensions: most notes have none, so use []. Add a pair only when doing one means you cannot do the other. Two ideas that can coexist, like long-term vision and fast iteration, are not a tension. Write each side in under 12 words and do not copy a point.',
    '8. actions: 1 to 3 things to do this week. Each starts with a verb, takes under an hour and uses a method from the points.',
    '9. resources: every "event" claim goes here and nowhere else, in one line with its full date if it has one. Include only details the claim gives.',
    'Accuracy rules:',
    '- Use only these claims. Do not add facts.',
    '- Credit a person only if that exact claim lists them as who. If merged claims have different people or none, name nobody. Never move an idea from one person to another.',
    '- If a named person is a fictional character, say so or leave them out.',
    '- Leave out promises of returns and get-rich plans that rely on loans or leverage. Never state them as fact.',
    '- Every point must cite source numbers from the claims.',
    '- No empty intensifiers such as key, core, ultimate, powerful, unlock (關鍵、核心、極致、賦能、打造).',
    ...(notes.length ? ['', 'Follow these instructions from the user (later ones win on conflict):', ...notes.map(n => `- ${n}`)] : []),
    ...(previous ? ['', 'Previous version. Keep what still holds and keep its source numbers valid:', previous] : []),
    '',
    'Return only JSON:',
    '{"thesis": "...", "chapters": [{"claim": "...", "points": [{"text": "...", "sources": [1, 2], "kind": "principle", "steps": []}]}], "tensions": [{"a": {"text": "...", "sources": [1]}, "b": {"text": "...", "sources": [2]}}], "actions": ["..."], "resources": [{"text": "...", "sources": [3]}]}',
    '',
    'Claims:',
    ...claims.map(c => `[${c.n}] (${c.kind}${c.who ? `, who: ${c.who}` : ''}) ${c.text}`),
  ].join('\n');
}

// Models often write the steps into the sentence above the list as well; keep only the lead-in.
function stepsIntro(text: string, steps: string[]) {
  const at = text.indexOf(steps[0].slice(0, 4));
  if (steps.length < 2 || at < 2 || !text.includes(steps[1].slice(0, 4))) return text;
  const intro = text.slice(0, at).replace(/[\s：:，,、]*(?:結構)?(?:包含|包括|如下)?[\s：:，,、]*(?:step\s*1|第一步|1[.、])?[\s：:，,、]*$/i, '');
  return intro.length >= 2 ? intro : text;
}

// A point with no valid source is dropped: every line in a note must lead back to a real post.
function parsePoint(v: unknown, total: number): NotePoint | null {
  const o = v as Record<string, unknown>;
  const text = str(o?.text);
  const sources = [...new Set(list(o?.sources).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= total))];
  if (!text || !sources.length) return null;
  const steps = list(o.steps).map(str).filter(Boolean);
  return { text: steps.length ? stepsIntro(text, steps) : text, sources, ...(CLAIM_KINDS.includes(o.kind as ClaimKind) && { kind: o.kind as ClaimKind }), ...(steps.length && { steps }) };
}

export function parseNote(raw: Record<string, unknown>, total: number, thin: number): EditedNote | null {
  const points = (v: unknown) => list(v).flatMap(p => parsePoint(p, total) ?? []);
  const chapters = list(raw.chapters).flatMap(c => {
    const o = c as Record<string, unknown>;
    const claim = str(o?.claim);
    const pts = points(o?.points);
    return claim && pts.length ? [{ claim, points: pts }] : [];
  });
  const thesis = str(raw.thesis);
  if (!thesis || !chapters.length) return null;
  return {
    thesis,
    chapters,
    tensions: list(raw.tensions).flatMap(x => {
      const o = x as Record<string, unknown>;
      const a = parsePoint(o?.a, total);
      const b = parsePoint(o?.b, total);
      return a && b ? [{ a, b }] : [];
    }),
    actions: list(raw.actions).map(str).filter(Boolean),
    resources: points(raw.resources),
    thin,
  };
}

/** Rules a draft can be checked against in code. The model breaks them on some runs, so it gets one chance to fix them. */
export function noteProblems(note: EditedNote) {
  const lone = note.chapters.filter(c => c.points.length < 2).map(c => c.claim);
  const double = note.chapters.filter(c => /[，,]|並(?!不|非)|\band\b/i.test(c.claim)).map(c => c.claim);
  const onePost = note.chapters.filter(c => c.points.length >= 3 && new Set(c.points.flatMap(p => p.sources)).size === 1).map(c => c.claim);
  return [
    ...(note.chapters.length > 6 ? [`It has ${note.chapters.length} chapters. Merge them into at most 6.`] : []),
    ...(lone.length ? [`These chapters have only one point. Merge each into a related chapter: ${lone.join(' / ')}`] : []),
    ...(double.length ? [`These titles make more than one claim. Rewrite each as one short claim: ${double.join(' / ')}`] : []),
    ...(onePost.length ? [`These chapters are one post's examples. Make them one point with steps, or add other sources: ${onePost.join(' / ')}`] : []),
  ];
}

/** Claims from posts the note never cites. Kept apart so the main text can stay edited. */
export function leftOver(note: EditedNote, claims: Claim[]): NotePoint[] {
  const used = new Set([...note.chapters.flatMap(c => c.points), ...note.tensions.flatMap(x => [x.a, x.b]), ...note.resources].flatMap(p => p.sources));
  return claims.filter(c => !used.has(c.n)).map(c => ({ text: c.who ? `${c.who}：${c.text}` : c.text, sources: [c.n], kind: c.kind }));
}

/** True when a text's latest full date (2026年5月30日, 2026/5/30, 2026-05-30) is before today. */
export function isPast(text: string, today: string) {
  const dates = [...text.matchAll(/(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/g)]
    .map(([, y, m, d]) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`).sort();
  return dates.length > 0 && dates[dates.length - 1] < today;
}

const cited = (p: NotePoint) => `${p.text} ${p.sources.map(n => `[${n}]`).join('')}`;
export const citedText = cited;

/** Plain text of a note, kept in Digest.text so revisions can build on it. */
export function noteToText(note: EditedNote) {
  return [
    note.thesis,
    ...note.chapters.flatMap(c => ['', c.claim, ...c.points.flatMap(p => [`• ${cited(p)}`, ...(p.steps ?? []).map((s, i) => `   ${i + 1}. ${s}`)])]),
    ...note.tensions.flatMap(x => ['', `• ${cited(x.a)}`, `• ${cited(x.b)}`]),
    ...(note.actions.length ? ['', ...note.actions.map(a => `• ${a}`)] : []),
    ...(note.resources.length ? ['', ...note.resources.map(r => `• ${cited(r)}`)] : []),
  ].join('\n');
}

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

export type ModelTier = 'quality' | 'balanced' | 'quota';
const TIER_ORDER: ModelTier[] = ['quality', 'balanced', 'quota'];
const tierOf = (name: string): ModelTier | undefined =>
  /-pro\b/.test(name) ? 'quality' : /-flash-lite\b/.test(name) ? 'quota' : /-flash\b/.test(name) ? 'balanced' : undefined;
const versionOf = (name: string) => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? 0);

/** Text models from ListModels, newest first, pro then flash then lite. Previews, TTS, image and other
 *  special-purpose variants are left out. Names in `keep` (the saved choices) are always listed. */
export function modelOptions(names: string[], keep: string[]): { name: string; tier?: ModelTier }[] {
  const ok = names.map(n => n.replace(/^models\//, '')).filter(n => {
    const v = versionOf(n);
    // 2.x answers 404 for newer keys. Gemini 4 uses names like gemini-4-neon instead of flash or pro.
    return (v === 0 || v >= 3) && (/^gemini-(\d[\d.]*-)?(pro|flash|flash-lite)(-latest)?$/.test(n)
      || (v >= 4 && /^gemini-[\d.]+-(?!live|tts|image|embedding|robotics|omni|audio)[a-z]+$/.test(n)));
  });
  return [...new Set([...ok, ...keep.filter(Boolean)])]
    .map(name => ({ name, tier: tierOf(name) }))
    .sort((a, b) => versionOf(b.name) - versionOf(a.name)
      || (a.tier ? TIER_ORDER.indexOf(a.tier) : 9) - (b.tier ? TIER_ORDER.indexOf(b.tier) : 9)
      || a.name.localeCompare(b.name));
}

// Pro is left out so an automatic switch never lands on the priciest model; 2.x answers 404 for newer keys.
export function backupModels(names: string[]) {
  const options = modelOptions(names, []).filter(o => versionOf(o.name) >= 3);
  return (['quota', 'balanced'] as ModelTier[]).flatMap(tier => options.filter(o => o.tier === tier).map(o => o.name));
}
