// Pure logic, no chrome.* APIs, so `node test.js` can check it.
const Core = (() => {
  const TYPES = { 1: 'image', 2: 'video', 8: 'carousel' };
  const LANGS = {
    zh: { name: 'Traditional Chinese (Taiwan)', other: '其他', eg: '美髮、行銷、滑雪、美食、趣味' },
    en: { name: 'English', other: 'Other', eg: 'Hair, Marketing, Skiing, Food, Humor' },
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

  const slimUser = u => ({ id: idOf(u), username: u.username, name: u.full_name || '' });

  // Full refetch (following): drop accounts no longer present, keep old category tags.
  function keepCats(fresh, old) {
    const prev = new Map(old.map(x => [x.id, x.cat]));
    return fresh.map(x => (prev.get(x.id) ? { ...x, cat: prev.get(x.id) } : x));
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

  function summaryPrompt(cat, posts, lang) {
    const l = LANGS[lang] || LANGS.en;
    return [
      `These are Instagram posts a user saved under the topic "${cat}".`,
      `Write a digest in ${l.name} so the user does not need to open each post.`,
      '- Plain text, no Markdown. Use "• " bullets.',
      '- Merge overlapping points. Keep concrete steps, numbers, names, places and tools.',
      '- End every bullet with its source numbers, e.g. [2][5].',
      '- Skip greetings, ads and filler.',
      '',
      ...posts.map((p, i) => `[${i + 1}] ${itemText(p, 1500)}`),
    ].join('\n');
  }

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

  function newSources(summary, posts) {
    const had = new Set(summary.sourceIds);
    return posts.filter(p => !had.has(p.id)).length;
  }

  const matches = (x, q) =>
    [x.username, x.name, x.user, x.caption, x.alt, x.cat].join(' ').toLowerCase().includes(q.toLowerCase());

  return { slimPost, slimUser, keepCats, mergeById, itemText, categorizePrompt, summaryPrompt, parseJson, applyCategories, groupCounts, newSources, matches };
})();

if (typeof module !== 'undefined') module.exports = Core;
