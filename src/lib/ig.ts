import { t } from './i18n';

type Kind = 'saved' | 'following' | 'followers';
interface IgResult { error?: string; items: unknown[] }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Injected into an instagram.com tab: same origin, so the user's own login applies and
// we never see their password. Must be self-contained: chrome.scripting serializes only this
// function's source, so no outer variables, imports or helpers.
async function igFetch(kind: Kind, known: string[], maxPages: number): Promise<IgResult> {
  const cookie = (n: string) => document.cookie.match('(?:^|; )' + n + '=([^;]*)')?.[1];
  const headers = { 'X-IG-App-ID': '936619743392459', 'X-CSRFToken': cookie('csrftoken') || '', 'X-Requested-With': 'XMLHttpRequest' };
  let uid: string | null | undefined = cookie('ds_user_id');
  if (!uid) {
    const r = await fetch('/api/v1/accounts/current_user/?edit=true', { headers });
    // Logged out, IG can answer with the HTML login page instead of JSON.
    uid = r.ok ? (await r.json().catch(() => ({}))).user?.pk : null;
  }
  if (!uid) return { error: 'not_logged_in', items: [] };

  const seen = new Set(known);
  const items: unknown[] = [];
  let maxId = '';
  for (let page = 0; page < maxPages; page++) {
    const q = maxId ? 'max_id=' + encodeURIComponent(maxId) : '';
    const url = kind === 'saved' ? `/api/v1/feed/saved/posts/?${q}` : `/api/v1/friendships/${uid}/${kind}/?count=50&${q}`;
    const r = await fetch(url, { headers });
    if (!r.ok) return { error: 'HTTP ' + r.status, items };
    const j = await r.json();
    const batch: { id?: string; pk?: string | number }[] = kind === 'saved' ? (j.items || []).map((i: { media?: unknown }) => i.media).filter(Boolean) : j.users || [];
    const stop = batch.findIndex(x => seen.has(String(x.id ?? x.pk).split('_')[0])); // same rule as core idOf
    items.push(...(stop < 0 ? batch : batch.slice(0, stop)));
    maxId = j.next_max_id;
    if (stop >= 0 || !maxId) break;
    // ponytail: 2-5 s between pages, about a person scrolling. Don't shorten; IG rate-limits list endpoints.
    await new Promise(res => setTimeout(res, 2000 + Math.random() * 3000));
  }
  return { items };
}

// A discarded (sleeping) tab never reaches 'complete', so reload it first.
async function igTab() {
  let [tab] = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  const created = !tab;
  if (created) tab = await chrome.tabs.create({ url: 'https://www.instagram.com/', active: false });
  else if (tab.discarded) await chrome.tabs.reload(tab.id!);
  for (let i = 0; i < 60 && (tab.status !== 'complete' || tab.discarded); i++) {
    await sleep(500);
    tab = await chrome.tabs.get(tab.id!);
  }
  return { id: tab.id!, created };
}

export async function fromIg<T>(kind: Kind, known: string[], maxPages: number, retry = true): Promise<T[]> {
  const tab = await igTab();
  let result: IgResult | undefined;
  try {
    [{ result }] = (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: igFetch, args: [kind, known, maxPages] })) as { result?: IgResult }[];
  } catch (e) {
    // IG sometimes reloads its own page while igFetch runs ("Frame with ID 0 was removed").
    // igTab() waits for the reload to finish; one more try usually works.
    if (retry && /frame/i.test((e as Error).message)) return fromIg(kind, known, maxPages, false);
    throw e;
  } finally {
    // Close the tab only if we opened it; never touch the user's own IG tab.
    if (tab.created) chrome.tabs.remove(tab.id).catch(() => {}); // user may have closed it
  }
  // Chrome has no InjectionResult.error: if igFetch throws, result is just null.
  if (!result) throw new Error(t('igFailed'));
  if (result.error) throw new Error(result.error === 'not_logged_in' ? t('loginFirst') : result.error);
  return result.items as T[];
}
