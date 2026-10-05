const $ = s => document.querySelector(s);
const t = (k, ...a) => chrome.i18n.getMessage(k, a.map(String)) || k;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;
const DEFAULTS = { apiKey: '', model: 'gemini-2.5-flash', lang: chrome.i18n.getUILanguage().startsWith('zh') ? 'zh' : 'en' };

let db = { following: [], saved: [], summaries: {}, settings: {}, lastSync: {} };
const view = { tab: 'saved', cat: '', q: '' };
let busy = false;

const save = () => chrome.storage.local.set(db);
const status = msg => ($('#status').textContent = msg);
const postUrl = p => `https://www.instagram.com/p/${p.code}/`;

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter(k => k != null && k !== false && k !== ''));
  return e;
}

// ---------- Instagram ----------

// Injected into an instagram.com tab: same origin, so the user's own login applies and
// we never see their password. Must be self-contained (no outer variables).
async function igFetch(kind, known, maxPages) {
  const cookie = n => document.cookie.match('(?:^|; )' + n + '=([^;]*)')?.[1];
  const headers = { 'X-IG-App-ID': '936619743392459', 'X-CSRFToken': cookie('csrftoken') || '', 'X-Requested-With': 'XMLHttpRequest' };
  let uid = cookie('ds_user_id');
  if (!uid) {
    const r = await fetch('/api/v1/accounts/current_user/?edit=true', { headers });
    // Logged out, IG can answer with the HTML login page instead of JSON.
    uid = r.ok ? (await r.json().catch(() => ({}))).user?.pk : null;
  }
  if (!uid) return { error: 'not_logged_in', items: [] };

  const seen = new Set(known);
  const items = [];
  let maxId = '';
  for (let page = 0; page < maxPages; page++) {
    const q = maxId ? 'max_id=' + encodeURIComponent(maxId) : '';
    const url = kind === 'following' ? `/api/v1/friendships/${uid}/following/?count=50&${q}` : `/api/v1/feed/saved/posts/?${q}`;
    const r = await fetch(url, { headers });
    if (!r.ok) return { error: 'HTTP ' + r.status, items };
    const j = await r.json();
    const batch = kind === 'following' ? j.users || [] : (j.items || []).map(i => i.media).filter(Boolean);
    const stop = batch.findIndex(x => seen.has(String(x.id ?? x.pk).split('_')[0])); // same rule as Core.idOf
    items.push(...(stop < 0 ? batch : batch.slice(0, stop)));
    maxId = j.next_max_id;
    if (stop >= 0 || !maxId) break;
    // ponytail: 2-5 s between pages, about a person scrolling. Don't shorten; IG rate-limits list endpoints.
    await new Promise(res => setTimeout(res, 2000 + Math.random() * 3000));
  }
  return { items };
}

// Returns { id, created }. A discarded (sleeping) tab never reaches 'complete', so reload it first.
async function igTab() {
  let [tab] = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  const created = !tab;
  if (created) tab = await chrome.tabs.create({ url: 'https://www.instagram.com/', active: false });
  else if (tab.discarded) await chrome.tabs.reload(tab.id);
  for (let i = 0; i < 60 && (tab.status !== 'complete' || tab.discarded); i++) {
    await sleep(500);
    tab = await chrome.tabs.get(tab.id);
  }
  return { id: tab.id, created };
}

async function fromIg(kind, known, maxPages) {
  const tab = await igTab();
  // Close the tab only if we opened it; never touch the user's own IG tab.
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: igFetch, args: [kind, known, maxPages] })
    .finally(() => tab.created && chrome.tabs.remove(tab.id).catch(() => {})); // user may have closed it
  // Chrome has no InjectionResult.error: if igFetch throws, result is just null.
  if (!result) throw new Error(t('igFailed'));
  if (result.error) throw new Error(result.error === 'not_logged_in' ? t('loginFirst') : result.error);
  return result.items;
}

// ---------- Gemini ----------

async function gemini(prompt, json) {
  const { apiKey, model } = db.settings;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: json ? { responseMimeType: 'application/json' } : {} }),
    });
    if (r.ok) return ((await r.json()).candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    // Free tier hits 429 often; it usually clears within a minute.
    if ((r.status === 429 || r.status === 503) && attempt < 3) { await sleep(20000 * (attempt + 1)); continue; }
    throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 160)}`);
  }
}

// ---------- Actions ----------

// One action at a time. body.busy greys out .act buttons so ignored clicks are visible.
async function run(fn) {
  if (busy) return;
  const setBusy = on => { busy = on; $('#sync').disabled = on; document.body.classList.toggle('busy', on); };
  setBusy(true);
  try { await fn(); } catch (e) { status(t('error', e.message)); }
  finally { setBusy(false); render(); }
}

const sync = force => run(async () => {
  status(t('syncingSaved'));
  // ponytail: 50 pages caps the first import (~1000 posts) for good: later syncs stop at the
  // first known post, so older posts are never reached. Store next_max_id to resume if needed.
  const saved = await fromIg('saved', db.saved.map(x => x.id), 50);
  db.saved = Core.mergeById(saved.map(Core.slimPost), db.saved);
  db.lastSync.saved = Date.now();
  await save(); // keep saved progress even if the following fetch below fails

  // Following has no "newest first" order, so it is a full refetch, at most once a day.
  if (force || Date.now() - (db.lastSync.following || 0) > DAY) {
    status(t('syncingFollowing'));
    // ponytail: 40 pages x 50 = 2000 accounts max; raise if someone follows more.
    const following = await fromIg('following', [], 40);
    // Less than half the stored list usually means IG cut paging short, not a mass unfollow.
    // Auto-sync refuses it; pressing Sync (force) accepts it, so a real mass unfollow is not stuck.
    if (!force && following.length < db.following.length / 2) throw new Error(t('followingShrank', following.length, db.following.length));
    db.following = Core.keepCats(following.map(Core.slimUser), db.following);
    db.lastSync.following = Date.now();
  }
  await save();
  render();
  if (!db.settings.apiKey) return status(t('needKey'));
  await categorize();
  status(t('synced', new Date().toLocaleTimeString()));
});

async function categorize() {
  const cats = () => Core.groupCounts([...db.following, ...db.saved]).map(([c]) => c);
  for (const list of [db.saved, db.following]) {
    const todo = list.filter(x => !x.cat);
    for (let i = 0; i < todo.length; i += 80) {
      status(t('categorizing', i, todo.length));
      const batch = todo.slice(i, i + 80);
      Core.applyCategories(batch, Core.parseJson(await gemini(Core.categorizePrompt(batch, cats(), db.settings.lang), true)));
      await save();
      render();
    }
  }
}

const summarize = cat => run(async () => {
  status(t('summarizing'));
  const posts = db.saved.filter(x => x.cat === cat);
  const text = await gemini(Core.summaryPrompt(cat, posts, db.settings.lang), false);
  // A blocked prompt returns no text; saving it would wipe the old digest and mark it up to date.
  if (!text.trim()) throw new Error('Gemini: empty response');
  db.summaries[cat] = { text, sourceIds: posts.map(p => p.id), at: Date.now() };
  await save();
  status('');
});

// ---------- Views ----------

// Background syncs call render() often; the settings form only redraws on navigation (force)
// so a half-typed API key is not wiped.
function render(force) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === view.tab));
  $('#search').hidden = !['following', 'saved'].includes(view.tab);
  if (view.tab === 'settings' && !force) return;
  const main = $('#main');
  main.replaceChildren();
  ({ following: renderList, saved: renderList, bookmarks: renderBookmarks, settings: renderSettings })[view.tab](main);
}

const chip = (cat, label, n) =>
  el('button', { className: 'chip' + (view.cat === cat ? ' on' : ''), textContent: `${label} ${n}`, onclick: () => { view.cat = cat; render(); } });

const userRow = u => el('li', {},
  el('a', { href: `https://www.instagram.com/${u.username}/`, target: '_blank', textContent: '@' + u.username }),
  el('span', { className: 'muted', textContent: ' ' + u.name }),
  u.cat && el('span', { className: 'tag', textContent: u.cat }));

const postRow = p => el('li', {},
  el('a', { href: postUrl(p), target: '_blank', textContent: '@' + p.user }),
  el('span', { className: 'tag', textContent: t('type_' + p.type) }),
  p.cat && el('span', { className: 'tag', textContent: p.cat }),
  el('p', { className: 'cap', textContent: (p.caption || p.alt).slice(0, 160) }));

function renderList(main) {
  const items = db[view.tab];
  if (!items.length) return main.append(el('p', { className: 'empty', textContent: t('empty') }));
  main.append(el('div', { className: 'chips' }, chip('', t('all'), items.length), ...Core.groupCounts(items).map(([c, n]) => chip(c, c, n))));
  if (view.tab === 'saved' && view.cat) main.append(summaryBox(view.cat));
  const shown = items.filter(x => (!view.cat || x.cat === view.cat) && (!view.q || Core.matches(x, view.q)));
  // ponytail: renders at most 500 rows; add paging if lists get bigger.
  main.append(el('ul', { className: 'list' }, ...shown.slice(0, 500).map(view.tab === 'following' ? userRow : postRow)));
}

// [n] in the digest links back to the n-th source post. Model output goes in as text nodes only.
function digestText(s) {
  return el('div', { className: 'digest' }, ...s.text.split(/(\[\d+\])/).map(part => {
    const n = part.match(/^\[(\d+)\]$/)?.[1];
    const p = n && db.saved.find(x => x.id === s.sourceIds[n - 1]);
    return p ? el('a', { href: postUrl(p), target: '_blank', textContent: part }) : part;
  }));
}

function summaryBox(cat) {
  const s = db.summaries[cat];
  if (!s) return el('section', { className: 'summary' }, el('button', { className: 'act', textContent: t('makeSummary'), onclick: () => summarize(cat) }));
  const fresh = Core.newSources(s, db.saved.filter(x => x.cat === cat));
  return el('section', { className: 'summary' },
    el('h3', { textContent: cat }),
    digestText(s),
    fresh
      ? el('button', { className: 'act', textContent: t('updateSummary', fresh), onclick: () => summarize(cat) })
      : el('p', { className: 'muted', textContent: t('upToDate') }));
}

function renderBookmarks(main) {
  const cats = Object.keys(db.summaries);
  if (!cats.length) return main.append(el('p', { className: 'empty', textContent: t('noBookmarks') }));
  main.append(...cats.map(summaryBox));
}

function renderSettings(main) {
  const s = db.settings;
  const key = el('input', { type: 'password', value: s.apiKey, placeholder: 'AIza…', autocomplete: 'off' });
  const model = el('input', { value: s.model });
  const lang = el('select', {}, el('option', { value: 'zh', textContent: '繁體中文' }), el('option', { value: 'en', textContent: 'English' }));
  lang.value = s.lang;
  const when = ts => (ts ? new Date(ts).toLocaleString() : t('never'));
  main.append(
    el('label', {}, t('apiKey'), key),
    el('p', { className: 'muted', textContent: t('apiKeyHelp') }),
    el('label', {}, t('model'), model),
    el('label', {}, t('aiLang'), lang),
    el('button', {
      textContent: t('save'),
      onclick: async () => {
        Object.assign(s, { apiKey: key.value.trim(), model: model.value.trim() || DEFAULTS.model, lang: lang.value });
        await save();
        status(t('saved'));
        // A running sync picks up the new key itself; otherwise sort what is already synced.
        if (s.apiKey) run(async () => { await categorize(); status(t('saved')); });
      },
    }),
    el('hr'),
    el('button', {
      className: 'act',
      textContent: t('recategorize'),
      onclick: () => confirm(t('confirmResort')) && run(async () => {
        for (const x of [...db.following, ...db.saved]) delete x.cat;
        db.summaries = {};
        await save();
        if (!s.apiKey) return status(t('needKey'));
        await categorize();
        status('');
      }),
    }),
    el('button', {
      className: 'danger act',
      textContent: t('clearData'),
      onclick: async () => {
        if (busy || !confirm(t('confirmClear'))) return;
        db = { following: [], saved: [], summaries: {}, settings: s, lastSync: {} };
        await chrome.storage.local.clear();
        await save();
        render(true);
      },
    }),
    el('p', { className: 'muted', textContent: t('lastSync', when(db.lastSync.saved), when(db.lastSync.following)) }));
}

// ---------- Start ----------

(async () => {
  Object.assign(db, await chrome.storage.local.get(null));
  db.settings = { ...DEFAULTS, ...db.settings };
  document.querySelectorAll('[data-i18n]').forEach(e => (e.textContent = t(e.dataset.i18n)));
  document.documentElement.lang = chrome.i18n.getUILanguage();
  $('#search').placeholder = t('search');
  $('#search').oninput = e => { view.q = e.target.value; render(); };
  $('#sync').onclick = () => sync(true);
  document.querySelectorAll('nav button').forEach(b => (b.onclick = () => { view.tab = b.dataset.tab; view.cat = ''; render(true); }));
  if (!db.settings.apiKey) view.tab = 'settings';
  render(true);
  sync(false); // auto-sync on every open
})();
