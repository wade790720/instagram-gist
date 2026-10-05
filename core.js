// Pure logic, no chrome.* APIs, so `node test.js` can check it.
const Core = (() => {
  const TYPES = { 1: 'image', 2: 'video', 8: 'carousel' };
  const LANGS = {
    zh: { name: 'Traditional Chinese (Taiwan)', other: '其他', friends: '好友', eg: '美髮、行銷、滑雪、美食、趣味' },
    en: { name: 'English', other: 'Other', friends: 'Friends', eg: 'Hair, Marketing, Skiing, Food, Humor' },
  };
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
  // Media pk (~3e18) is above 2^53 and loses digits as a JSON number; the string `id`
  // ("<pk>_<owner>") does not. igFetch in app.js must use the same rule.
  const idOf = x => String(x.id ?? x.pk).split('_')[0];

  // IG's alt text ("May be an image of text that says ...") is free OCR for carousels.
  function slimPost(m) {
    const alts = [m.accessibility_caption, ...(m.carousel_media || []).map(c => c.accessibility_caption)].filter(Boolean);
    return {
      id: idOf(m),
      code: m.code,
      user: m.user?.username || '',
      caption: m.caption?.text || '',
      alt: [...new Set(alts)].join(' | '),
      type: TYPES[m.media_type] || 'post',
      takenAt: m.taken_at || 0,
    };
  }

  const slimUser = u => ({ id: idOf(u), username: u.username, name: u.full_name || '', private: !!u.is_private, verified: !!u.is_verified });

  // Rule, not AI: the model only sees a handle and a name and cannot tell a friend from a shop.
  // Friend = not verified AND (follows you back OR private account). Hand-picked topics win.
  // ponytail: mutual small shops/creators land here too; the user moves them once (manual sticks).
  function markFriends(users, followerIds, lang) {
    const label = (LANGS[lang] || LANGS.en).friends;
    let n = 0;
    for (const u of users) {
      if (u.manual || u.verified || !(u.private || followerIds.has(u.id))) continue;
      u.cat = label;
      n++;
    }
    return n;
  }

  // Full refetch (following): drop accounts no longer present, keep old category tags
  // and the manual flag (user-chosen topics survive re-sorting).
  function keepCats(fresh, old) {
    const prev = new Map(old.map(x => [x.id, x]));
    return fresh.map(x => {
      const o = prev.get(x.id);
      return o?.cat ? { ...x, cat: o.cat, ...(o.manual && { manual: true }) } : x;
    });
  }

  // Incremental fetch (saved): new items first, old ones after.
  // ponytail: never sees un-saves; add a full-refetch button if that matters.
  function mergeById(fresh, old) {
    const out = keepCats(fresh, old);
    const ids = new Set(out.map(x => x.id));
    return out.concat(old.filter(x => !ids.has(x.id)));
  }

  function itemText(x, max = 300) {
    if (x.username !== undefined) return `@${x.username} ${x.name}`.trim();
    const alt = x.alt ? ` [image: ${clip(x.alt, max)}]` : '';
    return `@${x.user}: ${clip(x.caption.replace(/\s+/g, ' '), max)}${alt}`;
  }

  function categorizePrompt(items, cats, lang) {
    const l = LANGS[lang] || LANGS.en;
    return [
      'Sort these Instagram items (followed accounts or saved posts) into broad topic categories.',
      `- Write category names in ${l.name}, short (1-4 words), like: ${l.eg}.`,
      `- Reuse an existing category when it fits. Existing: ${cats.length ? cats.join(', ') : '(none)'}`,
      '- Create a new category only when none fits. Keep the total under 15.',
      `- Use "${l.other}" when you cannot tell.`,
      'Return only a JSON object that maps every item number to one category, e.g. {"1": "...", "2": "..."}.',
      '',
      ...items.map((x, i) => `${i + 1}. ${itemText(x)}`),
    ].join('\n');
  }

  // notes: the user's saved rewrite instructions, re-applied on every regenerate.
  // current: the previous digest, so a rewrite improves it instead of starting over.
  function summaryPrompt(cat, posts, lang, notes = [], current = '') {
    const l = LANGS[lang] || LANGS.en;
    const extra = [
      ...(notes.length ? ['', 'Follow these instructions from the user (later ones win on conflict):', ...notes.map(n => `- ${n}`)] : []),
      ...(current ? ['', 'Previous digest. Use it as the base; the instructions above decide the new form. Keep the [n] source numbers valid:', current] : []),
    ];
    return [
      `These are Instagram posts a user saved under the topic "${cat}".`,
      `Write a digest in ${l.name} so the user does not need to open each post.`,
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

  // Free-tier tokens-per-minute is small: one 114-post prompt at 1500 chars (caption + alt each)
  // was ~340k chars and got 429 on every retry. Fixed total budget: more posts, shorter clips.
  // ponytail: chars, not tokens; CJK is about 1 token per char, so 60k chars stays well under the limit.
  const SUMMARY_BUDGET = 60000;
  const perPost = n => Math.max(150, Math.min(1500, Math.floor(SUMMARY_BUDGET / 2 / Math.max(n, 1))));

  function parseJson(text) {
    const t = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    for (const s of [t, t.match(/\{[\s\S]*\}/)?.[0]]) {
      try { if (s) return JSON.parse(s); } catch { /* try next */ }
    }
    return {};
  }

  // Items the model skipped stay untagged and get retried on the next run.
  function applyCategories(batch, map) {
    let n = 0;
    batch.forEach((x, i) => {
      const c = map[String(i + 1)];
      if (typeof c === 'string' && c.trim()) { x.cat = c.trim(); n++; }
    });
    return n;
  }

  function groupCounts(items) {
    const m = {};
    for (const x of items) if (x.cat) m[x.cat] = (m[x.cat] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }

  // Before v0.2 a topic held one digest object; now it holds a list of digests (different angles
  // on the same posts, each with its own instructions). Converts in place, safe to run every load.
  function normalizeSummaries(all = {}) {
    for (const [cat, v] of Object.entries(all)) if (!Array.isArray(v)) all[cat] = [{ id: 'd0', ...v }];
    return all;
  }

  // Old sources keep their [n] numbers; new posts are appended after them.
  function orderSources(prevIds, posts) {
    const byId = new Map(posts.map(p => [p.id, p]));
    const had = new Set(prevIds);
    return prevIds.map(id => byId.get(id)).filter(Boolean).concat(posts.filter(p => !had.has(p.id)));
  }

  function newSources(summary, posts) {
    const had = new Set(summary.sourceIds);
    return posts.filter(p => !had.has(p.id)).length;
  }

  const matches = (x, q) =>
    [x.username, x.name, x.user, x.caption, x.alt, x.cat].join(' ').toLowerCase().includes(q.toLowerCase());

  return { slimPost, slimUser, markFriends, keepCats, mergeById, itemText, categorizePrompt, summaryPrompt, parseJson, applyCategories, groupCounts, normalizeSummaries, orderSources, newSources, matches };
})();

if (typeof module !== 'undefined') module.exports = Core;
