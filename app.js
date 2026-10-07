const $ = s => document.querySelector(s);
const t = (k, ...a) => chrome.i18n.getMessage(k, a.map(String)) || k;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;
// Free tier, 2026-09: 3.5-flash-lite ~500 calls/day (sorting needs many), 3.8-flash ~20/day
// (better writing; enough for digests).
const DEFAULTS = { apiKey: '', model: 'gemini-3.5-flash-lite', summaryModel: 'gemini-3.8-flash', lang: chrome.i18n.getUILanguage().startsWith('zh') ? 'zh' : 'en' };

let db = { following: [], saved: [], summaries: {}, settings: {}, lastSync: {} };
let avatars = {}; // username -> data URL
const view = { tab: 'saved', cat: '', q: '' };
let busy = false;
// Digests the user opened. render() rebuilds the DOM often, so <details> state lives here.
const opened = new Set();

const save = () => chrome.storage.local.set(db);
const status = (msg, err) => { $('#status').textContent = msg; $('#status').classList.toggle('err', !!err); };
const postUrl = p => `https://www.instagram.com/p/${p.code}/`;
const when = ts => (ts ? new Date(ts).toLocaleString() : t('never'));

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter(k => k != null && k !== false && k !== ''));
  return e;
}

// Lucide icons (ISC license), inner SVG markup. Constant strings only, so innerHTML is safe.
// Rule: sparkles = the button calls Gemini.
const ICONS = {
  sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name];
  return s;
}

// Native <dialog>: showModal() traps focus and turns Esc into a 'cancel' event.
// Resolves to the trimmed text (input mode), true (confirm), or null when cancelled.
// It settles on the click or key itself: Chrome queues the 'close' event, and it can arrive late.
function modal(msg, { input = false, ok, danger = false }) {
  const d = $('#dlg'), field = $('#dlg-input');
  $('#dlg-msg').textContent = msg;
  field.hidden = !input;
  field.value = '';
  Object.assign($('#dlg-ok'), { textContent: ok, className: danger ? 'danger' : 'primary' });
  return new Promise(res => {
    const done = yes => { d.close(); res(!yes ? null : input ? field.value.trim() || null : true); };
    $('#dlg-ok').onclick = () => done(true);
    $('#dlg-cancel').onclick = () => done(false);
    field.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } };
    d.oncancel = e => { e.preventDefault(); done(false); };
    d.showModal(); // focus lands on Cancel: the safe choice for destructive actions
    if (input) field.focus();
  });
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
    const url = kind === 'saved' ? `/api/v1/feed/saved/posts/?${q}` : `/api/v1/friendships/${uid}/${kind}/?count=50&${q}`; // following | followers
    const r = await fetch(url, { headers });
    if (!r.ok) return { error: 'HTTP ' + r.status, items };
    const j = await r.json();
    const batch = kind === 'saved' ? (j.items || []).map(i => i.media).filter(Boolean) : j.users || [];
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

async function fromIg(kind, known, maxPages, retry = true) {
  const tab = await igTab();
  let result;
  try {
    [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: igFetch, args: [kind, known, maxPages] });
  } catch (e) {
    // IG sometimes reloads its own page while igFetch runs ("Frame with ID 0 was removed").
    // igTab() waits for the reload to finish; one more try usually works.
    if (retry && /frame/i.test(e.message)) return fromIg(kind, known, maxPages, false);
    throw e;
  } finally {
    // Close the tab only if we opened it; never touch the user's own IG tab.
    if (tab.created) chrome.tabs.remove(tab.id).catch(() => {}); // user may have closed it
  }
  // Chrome has no InjectionResult.error: if igFetch throws, result is just null.
  if (!result) throw new Error(t('igFailed'));
  if (result.error) throw new Error(result.error === 'not_logged_in' ? t('loginFirst') : result.error);
  return result.items;
}

// ---------- Gemini ----------

// fallback: a second model to use when `model` is overloaded (503). The newest model often is.
async function gemini(prompt, json, model, fallback) {
  const { apiKey } = db.settings;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: json ? { responseMimeType: 'application/json' } : {} }),
    });
    if (r.ok) return ((await r.json()).candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    const body = await r.text();
    // Google's own message: names a retired model's replacement, or which limit was hit.
    let msg = body.slice(0, 300);
    try { msg = JSON.parse(body).error.message || msg; } catch { /* not JSON, keep raw text */ }
    // Google says how long to wait. Per-minute limits clear in under a minute: wait and retry.
    // A daily quota says ~18 h: retrying is pointless, so stop and say so.
    // 503 = this model is busy for everyone right now. After one retry, switch models instead of
    // waiting out two more minutes of retries that usually fail the same way.
    if (r.status === 503 && fallback && fallback !== model && attempt >= 1) {
      status(t('fellBack', model, fallback));
      [model, fallback, attempt] = [fallback, null, -1];
      continue;
    }
    const told = body.match(/"retryDelay":\s*"([\d.]+)s"/)?.[1];
    const wait = Number(told ?? 20 * (attempt + 1));
    if ((r.status === 429 || r.status === 503) && wait <= 90 && attempt < 3) {
      // Show the reason too, so "overloaded" (503) and "limit X exceeded" (429) can be told apart.
      status(`${t('rateLimited', Math.ceil(wait))} (${r.status}: ${msg.slice(0, 120)})`);
      await sleep(wait * 1000);
      continue;
    }
    // Only call it the daily quota when Google gave a long retryDelay; otherwise show its text.
    if (r.status === 429 && told && wait > 90) throw new Error(t('quotaOut', model, Math.ceil(wait / 3600)));
    throw new Error(`Gemini ${r.status}: ${msg}`);
  }
}

// ---------- Actions ----------

// One action at a time. body.busy greys out .act buttons so ignored clicks are visible.
async function run(fn) {
  if (busy) return;
  // The bar has no value (it just moves) until categorize() knows a count.
  const setBusy = on => {
    busy = on;
    $('#sync').disabled = on;
    document.body.classList.toggle('busy', on);
    $('#prog').removeAttribute('value');
    $('#prog').hidden = !on;
  };
  setBusy(true);
  try { await fn(); } catch (e) { status(t('error', e.message), true); }
  finally { setBusy(false); render(); }
}

// Runs only when the user presses Sync: no background fetching, to keep IG traffic low.
const sync = () => run(async () => {
  status(t('syncingSaved'));
  // ponytail: 50 pages caps the first import (~1000 posts) for good: later syncs stop at the
  // first known post, so older posts are never reached. Store next_max_id to resume if needed.
  // Posts synced before avatars existed have no pic URL: refetch the whole list once (passing no
  // known ids) to fill it in. Topics and manual picks survive through mergeById.
  const backfill = db.saved.some(p => p.pic === undefined);
  const saved = await fromIg('saved', backfill ? [] : db.saved.map(x => x.id), 50);
  db.saved = Core.mergeById(saved.map(Core.slimPost), db.saved);
  // Posts past the 50-page cap stay without a URL; mark them so the refetch never repeats.
  for (const p of db.saved) p.pic ??= '';
  db.lastSync.saved = Date.now();
  await save(); // keep saved progress even if the following fetch below fails

  // Following has no "newest first" order, so it is a full refetch: at most once a day,
  // however often Sync is pressed.
  if (Date.now() - (db.lastSync.following || 0) > DAY) {
    status(t('syncingFollowing'));
    // ponytail: 40 pages x 50 = 2000 accounts max; raise if someone follows more.
    const following = await fromIg('following', [], 40);
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
    const followers = await fromIg('followers', [], 40);
    Core.markFriends(db.following, new Set(followers.map(u => Core.slimUser(u).id)), db.settings.lang);
    db.lastSync.following = Date.now();
  }
  await save();
  await fetchAvatars();
  render();
  if (!db.settings.apiKey) return status(t('needKey'));
  await categorize();
  status(t('synced', new Date().toLocaleTimeString()));
});

// IG's CDN blocks <img> on other sites, and its URLs expire. host_permissions let the extension
// fetch them, so each avatar is downloaded once and kept as a data URL. It has its own storage
// key, not db, so save() does not rewrite ~5 MB on every call.
// ponytail: never refreshed once stored; a changed avatar stays old until "Delete all data".
async function fetchAvatars() {
  const urls = new Map();
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
          avatars[name] = await new Promise(res => {
            const f = new FileReader();
            f.onload = () => res(f.result);
            f.readAsDataURL(blob);
          });
        }
      } catch { /* expired or blocked: the grey circle stays */ }
      status(t('syncingAvatars', ++done, total));
    }
  };
  // ponytail: 6 at a time; the CDN is not the rate-limited API, so no pauses.
  await Promise.all(Array.from({ length: 6 }, worker));
  if (total) await chrome.storage.local.set({ avatars });
}

async function categorize() {
  const cats = () => Core.groupCounts([...db.following, ...db.saved]).map(([c]) => c);
  // Following first: it is cheap (only @name + display name, so 400 per call) and a quota
  // error during saved posts would otherwise leave it untouched. Saved posts carry captions: 150 per call.
  // Big batches keep a full first sort (~600 follows + ~500 posts) to about 5 calls of the daily quota.
  for (const [list, size] of [[db.following, 400], [db.saved, 150]]) {
    const todo = list.filter(x => !x.cat);
    for (let i = 0; i < todo.length; i += size) {
      status(t('categorizing', i, todo.length));
      Object.assign($('#prog'), { max: todo.length, value: i });
      const batch = todo.slice(i, i + size);
      Core.applyCategories(batch, Core.parseJson(await gemini(Core.categorizePrompt(batch, cats(), db.settings.lang), true, db.settings.model)));
      await save();
      render();
    }
  }
}

// A topic holds a list of digests: different angles on the same posts (key points, formulas…).
// i: which digest; undefined makes the topic's first one.
// note: an instruction, saved on the digest so later updates keep applying it.
// asNew: build a new digest from digest i and leave digest i untouched.
const summarize = (cat, i, note = '', asNew = false) => run(async () => {
  status(t('summarizing'));
  const list = (db.summaries[cat] ||= []);
  const old = list[i];
  const notes = asNew ? [note.trim()] : [...(old?.notes || []), note.trim()].filter(Boolean);
  const posts = Core.orderSources(old?.sourceIds || [], db.saved.filter(x => x.cat === cat));
  const text = await gemini(Core.summaryPrompt(cat, posts, db.settings.lang, notes, old?.text), false, db.settings.summaryModel, db.settings.model);
  // A blocked prompt returns no text; saving it would wipe the old digest and mark it up to date.
  if (!text.trim()) throw new Error('Gemini: empty response');
  const next = { id: old && !asNew ? old.id : Date.now().toString(36), title: asNew ? note.trim() : old?.title, text, sourceIds: posts.map(p => p.id), notes, at: Date.now() };
  if (asNew) {
    list.push(next);
    opened.add(cat + '#' + next.id); // show the new digest open
  } else {
    // ponytail: one level of undo (prev); keep a list if people want to step back further.
    if (old) { const { prev, ...rest } = old; next.prev = rest; }
    list[i ?? 0] = next;
  }
  await save();
  status('');
});

const undoSummary = async (cat, i) => {
  const list = db.summaries[cat];
  list[i] = { ...list[i].prev, id: list[i].id };
  await save();
  render();
};

const deleteDigest = async (cat, i) => {
  const list = db.summaries[cat];
  list.splice(i, 1);
  if (!list.length) delete db.summaries[cat];
  await save();
  render();
};

// ---------- Views ----------

// Background syncs call render() often; the settings form only redraws on navigation (force)
// so a half-typed API key is not wiped.
function render(force) {
  document.querySelectorAll('nav button').forEach(b => {
    const on = b.dataset.tab === view.tab;
    b.classList.toggle('on', on);
    b.ariaCurrent = on ? 'page' : null;
  });
  $('.search').hidden = !['following', 'saved'].includes(view.tab);
  if (view.tab === 'settings' && !force) return;
  const main = $('#main');
  main.replaceChildren();
  ({ following: renderList, saved: renderList, bookmarks: renderBookmarks, settings: renderSettings })[view.tab](main);
}

// Topic chips. Edit sits on the chip itself, as in Gmail, Todoist and Notion: the selected chip
// gets a "⋯" button, and right-click opens the same menu on any chip.
function chip(cat, label, n) {
  const on = view.cat === cat;
  const b = el('button', {
    className: 'chip' + (on ? ' on' : ''), ariaPressed: String(on), textContent: `${label} ${n}`,
    onclick: () => {
      if (view.cat === cat) return;
      view.cat = cat;
      render();
      // Only on a new selection: render() also runs on every search keystroke, and the
      // "⋯" must not slide in again each time.
      $('.chip.more')?.classList.add('enter');
    },
  });
  if (!cat) return b; // "All" is not a topic
  b.oncontextmenu = e => { e.preventDefault(); catMenu(cat, b, b); };
  if (!on) return b;
  const group = el('span', { className: 'chipgroup' }, b);
  // .act: locked during a sync or digest, which could still be writing under the old name.
  const more = el('button', { className: 'chip more act', ariaLabel: t('editCat', cat), title: t('editCat', cat), ariaHasPopup: 'menu', onclick: () => catMenu(cat, more, group) }, icon('more'));
  group.append(more);
  return group;
}

const allItems = () => [...db.following, ...db.saved];

// Dropdown under the "⋯" (or under a right-clicked chip): Edit / Delete.
// One shared popover (#catmenu in app.html); Esc or a click outside closes it (light dismiss).
// node: the chip element that Edit turns into a text field.
function catMenu(cat, anchor, node) {
  if (busy) return;
  const m = $('#catmenu');
  const r = anchor.getBoundingClientRect();
  Object.assign(m.style, { top: r.bottom + 6 + 'px', left: Math.max(16, Math.min(r.left, innerWidth - 176)) + 'px' });
  $('#catmenu-edit').onclick = () => { m.hidePopover(); editChip(cat, node); };
  $('#catmenu-delete').onclick = async () => {
    m.hidePopover();
    const n = allItems().filter(x => x.cat === cat).length;
    if (!(await modal(t('confirmDeleteCat', cat, n), { ok: t('deleteCat'), danger: true })) || busy) return;
    Core.deleteCat(allItems(), db.summaries, cat);
    if (view.cat === cat) view.cat = '';
    await save();
    render();
  };
  // Arrow keys move between the two items, as in a native menu.
  const items = [$('#catmenu-edit'), $('#catmenu-delete')];
  m.onkeydown = e => {
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
  };
  m.showPopover();
  items[0].focus();
}

// The chip itself becomes a text field. Enter saves; Esc or clicking away cancels, so a
// half-typed name never merges two topics by accident.
// Topics are shared by following and saved, so both lists change together.
function editChip(cat, node) {
  const others = Core.groupCounts(allItems()).map(([c]) => c).filter(c => c !== cat);
  const before = $('#status').textContent;
  const input = el('input', { className: 'chip chipedit', value: cat, ariaLabel: t('editCat', cat), autocomplete: 'off' });
  // Merging is said before it happens (in the status line above the chips), not discovered after.
  const hint = () => { const v = input.value.trim(); status(others.includes(v) ? t('mergeHint', v) : t('enterToSave')); };
  let done = false;
  const finish = async keep => {
    if (done) return; // render() below removes the field, which fires blur again
    done = true;
    status(before);
    const to = input.value.trim();
    if (keep && to && to !== cat && !busy) {
      Core.renameCat(allItems(), db.summaries, cat, to);
      if (view.cat === cat) view.cat = to;
      await save();
    }
    render();
  };
  input.oninput = hint;
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  input.onblur = () => finish(false);
  node.replaceWith(input);
  input.focus();
  input.select();
  hint();
}

// Native <select> to move one item to another topic, or a new one. manual = true keeps the
// choice through "Re-sort everything".
function catPicker(x, cats) {
  const sel = el('select', { className: 'catpick', ariaLabel: t('moveTo') },
    ...[...new Set([x.cat || '', ...cats])].map(c => el('option', { value: c, textContent: c || t('unsorted') })),
    el('option', { value: '\u0000new', textContent: t('newCat') }));
  sel.value = x.cat || '';
  sel.onchange = async () => {
    const c = sel.value === '\u0000new' ? await modal(t('newCatPrompt'), { input: true, ok: t('create') }) : sel.value;
    if (!c) { sel.value = x.cat || ''; return; }
    x.cat = c;
    x.manual = true;
    await save();
    render();
  };
  return sel;
}

// src: a stored data URL (see fetchAvatars). alt '' because the @name sits next to it.
// Not downloaded yet: no src, so only the grey circle shows and rows keep the same layout.
const avatar = src => el('img', { className: 'av', alt: '', ...(src && { src }) });

// Rows: name on the left, topic picker pinned to the right edge, so moving many items
// keeps the mouse in one column.
const userRow = (u, cats) => el('li', {},
  el('div', { className: 'who' },
    avatar(avatars[u.username]),
    el('a', { href: `https://www.instagram.com/${u.username}/`, target: '_blank', textContent: '@' + u.username }),
    el('span', { className: 'muted', textContent: ' ' + u.name })),
  catPicker(u, cats));

const postRow = (p, cats) => el('li', {},
  el('div', { className: 'who' },
    avatar(avatars[p.user]),
    el('a', { href: postUrl(p), target: '_blank', textContent: '@' + p.user }),
    el('span', { className: 'tag', textContent: t('type_' + p.type) })),
  catPicker(p, cats),
  el('p', { className: 'cap', textContent: (p.caption || p.alt).slice(0, 160) }));

function renderList(main) {
  const items = db[view.tab];
  if (!items.length) return main.append(el('p', { className: 'empty', textContent: t('empty') }), el('button', { className: 'act primary', onclick: sync }, icon('sync'), t('sync')));
  main.append(el('div', { className: 'chips' }, chip('', t('all'), items.length), ...Core.groupCounts(items).map(([c, n]) => chip(c, c, n))));
  // Resume sorting without touching IG (Sync would fetch again) after a quota error or a stop.
  const untagged = items.filter(x => !x.cat).length;
  if (untagged && db.settings.apiKey) main.append(el('p', {}, el('button', {
    className: 'act',
    onclick: () => run(async () => { await categorize(); status(t('sortDone')); }),
  }, icon('sparkles'), t('sortRest', untagged))));
  if (view.tab === 'saved' && view.cat) {
    const list = db.summaries[view.cat] || [];
    main.append(...(list.length ? list.map((_, i) => summaryBox(view.cat, i)) : [summaryBox(view.cat)]));
  }
  const shown = items.filter(x => (!view.cat || x.cat === view.cat) && (!view.q || Core.matches(x, view.q)));
  // ponytail: renders at most 500 rows; add paging if lists get bigger.
  // Topics from both lists, so an account can move into a topic that so far only has posts.
  const cats = Core.groupCounts([...db.following, ...db.saved]).map(([c]) => c);
  const row = view.tab === 'following' ? userRow : postRow;
  main.append(el('ul', { className: 'list' }, ...shown.slice(0, 500).map(x => row(x, cats))));
}

// [n] in the digest links back to the n-th source post. Model output goes in as text nodes only.
function digestText(s) {
  return el('div', { className: 'digest' }, ...s.text.split(/(\[\d+\])/).map(part => {
    const n = part.match(/^\[(\d+)\]$/)?.[1];
    const p = n && db.saved.find(x => x.id === s.sourceIds[n - 1]);
    return p ? el('a', { href: postUrl(p), target: '_blank', textContent: part }) : part;
  }));
}

// i: digest index in the topic; undefined = the topic has none yet, show "Make digest".
function summaryBox(cat, i) {
  const s = db.summaries[cat]?.[i];
  if (!s) return el('section', { className: 'summary' }, el('button', { className: 'act primary', onclick: () => summarize(cat) }, icon('sparkles'), t('makeSummary')));
  const key = cat + '#' + s.id;
  const fresh = Core.newSources(s, db.saved.filter(x => x.cat === cat));
  const ask = el('input', { placeholder: t('refinePlaceholder'), ariaLabel: t('refine') });
  const send = asNew => { if (ask.value.trim()) summarize(cat, i, ask.value, asNew); };
  return el('details', { className: 'summary', open: opened.has(key), ontoggle: e => opened[e.target.open ? 'add' : 'delete'](key) },
    el('summary', { textContent: s.title ? `${cat} · ${s.title.slice(0, 40)}` : t('digestTitle', cat, s.sourceIds.length) }),
    digestText(s),
    s.notes?.length > 0 && el('p', { className: 'muted', textContent: t('notesApplied', s.notes.join('；')) }),
    // Enter = rewrite this digest. "Save as new" keeps this one and adds another built from it.
    el('form', { className: 'refine', onsubmit: e => { e.preventDefault(); send(false); } },
      ask,
      el('button', { className: 'act' }, icon('sparkles'), t('refine')),
      el('button', { type: 'button', className: 'act', onclick: () => send(true) }, icon('sparkles'), t('saveAsNew'))),
    el('div', { className: 'row' },
      fresh
        ? el('button', { className: 'act', onclick: () => summarize(cat, i) }, icon('sparkles'), t('updateSummary', fresh))
        : el('span', { className: 'muted', textContent: t('upToDate') }),
      s.prev && el('button', { className: 'act', onclick: () => undoSummary(cat, i) }, icon('undo'), t('undo')),
      el('button', {
        className: 'act danger',
        onclick: async () => (await modal(t('confirmDeleteDigest'), { ok: t('deleteDigest'), danger: true })) && deleteDigest(cat, i),
      }, icon('trash'), t('deleteDigest'))));
}

function renderBookmarks(main) {
  const boxes = Object.entries(db.summaries).flatMap(([cat, list]) => list.map((_, i) => summaryBox(cat, i)));
  if (!boxes.length) return main.append(el('p', { className: 'empty', textContent: t('noBookmarks') }));
  main.append(...boxes);
}

function renderSettings(main) {
  const s = db.settings;
  const key = el('input', { type: 'password', value: s.apiKey, placeholder: 'AIza…', autocomplete: 'off' });
  const model = el('input', { value: s.model });
  const summaryModel = el('input', { value: s.summaryModel });
  const lang = el('select', {}, el('option', { value: 'zh', textContent: '繁體中文' }), el('option', { value: 'en', textContent: 'English' }));
  lang.value = s.lang;
  main.append(
    el('label', {}, t('apiKey'), key),
    el('p', { className: 'muted', textContent: t('apiKeyHelp') }),
    el('label', {}, t('model'), model),
    el('label', {}, t('summaryModel'), summaryModel),
    el('label', {}, t('aiLang'), lang),
    el('button', {
      className: 'primary',
      textContent: t('save'),
      onclick: async () => {
        Object.assign(s, { apiKey: key.value.trim(), model: model.value.trim() || DEFAULTS.model,
          summaryModel: summaryModel.value.trim() || DEFAULTS.summaryModel, lang: lang.value });
        await save();
        status(t('saved'));
        // A running sync picks up the new key itself; otherwise sort what is already synced.
        if (s.apiKey) run(async () => { await categorize(); status(t('saved')); });
      },
    }),
    el('hr'),
    el('button', {
      className: 'act',
      onclick: async () => (await modal(t('confirmResort'), { ok: t('recategorize') })) && run(async () => {
        for (const x of [...db.following, ...db.saved]) if (!x.manual) delete x.cat;
        db.summaries = {};
        await save();
        if (!s.apiKey) return status(t('needKey'));
        await categorize();
        status('');
      }),
    }, icon('sparkles'), t('recategorize')),
    el('button', {
      className: 'danger act',
      onclick: async () => {
        if (busy || !(await modal(t('confirmClear'), { ok: t('clearData'), danger: true })) || busy) return;
        db = { following: [], saved: [], summaries: {}, settings: s, lastSync: {} };
        await chrome.storage.local.clear();
        avatars = {};
        await save();
        render(true);
      },
    }, icon('trash'), t('clearData')),
    el('p', { className: 'muted', textContent: t('lastSync', when(db.lastSync.saved), when(db.lastSync.following)) }));
}

// ---------- Start ----------

(async () => {
  // avatars has its own storage key and stays out of db (see fetchAvatars).
  const { avatars: stored, ...rest } = await chrome.storage.local.get(null);
  avatars = stored || {};
  Object.assign(db, rest);
  // Settings saved before summaryModel existed used 3.8-flash for sorting too; move sorting to lite once.
  if (db.settings?.model && !db.settings.summaryModel && db.settings.model === 'gemini-3.8-flash') db.settings.model = DEFAULTS.model;
  db.settings = { ...DEFAULTS, ...db.settings };
  db.summaries = Core.normalizeSummaries(db.summaries);
  // gemini-2.x returns 404 for keys created after 2026-09-18; move saved settings off it.
  if (/^gemini-2\./.test(db.settings.model)) db.settings.model = DEFAULTS.model;
  // Follows stored before the friend rule (private/verified) or avatars (pic) lack fields: refetch on the next Sync.
  if (db.following.length && (db.following[0].private === undefined || db.following[0].pic === undefined)) db.lastSync.following = 0;
  document.querySelectorAll('[data-i18n]').forEach(e => (e.textContent = t(e.dataset.i18n)));
  document.documentElement.lang = chrome.i18n.getUILanguage();
  $('#search').placeholder = t('search');
  $('#search').oninput = e => { view.q = e.target.value; render(); };
  $('#sync').prepend(icon('sync')); // after the i18n pass, which sets textContent
  $('#sync').onclick = sync;
  // Shown after about one screen of scrolling.
  Object.assign($('#top'), { ariaLabel: t('backToTop'), title: t('backToTop'),
    onclick: () => scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) });
  $('#top').append(icon('up'));
  addEventListener('scroll', () => {
    $('#top').hidden = scrollY < innerHeight;
    // The menu is placed under its chip once; close it rather than leave it floating.
    if ($('#catmenu').matches(':popover-open')) $('#catmenu').hidePopover();
  }, { passive: true });
  // After the i18n pass, which sets textContent.
  $('#catmenu-edit').prepend(icon('pencil'));
  $('#catmenu-delete').prepend(icon('trash'));
  document.querySelectorAll('nav button').forEach(b => (b.onclick = () => { view.tab = b.dataset.tab; view.cat = ''; render(true); }));
  if (!db.settings.apiKey) view.tab = 'settings';
  render(true);
  status(t('lastSync', when(db.lastSync.saved), when(db.lastSync.following)));
})();
