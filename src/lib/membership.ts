// Skool membership check: only members of the Wonder Pocket Club community can use the tool.
// Skool has no public API or OAuth, so we load the community's about page with the user's own
// skool.com session (needs the https://www.skool.com/* host permission) and read the JSON that
// Next.js embeds in it. Skool can change that page at any time; parse() then throws.
// The same file lives in ig-sorter and brand-digest-extension: change both.
export const COMMUNITY_URL = 'https://www.skool.com/forge-1085/about';
const GROUP_ID = '998361e5ef944ec4a6937379dd581002';
// ponytail: whitelist of roles seen so far; add the moderator role name once we see it.
const ROLES = ['member', 'group-admin'];
const RECHECK_MS = 24 * 3600e3; // a confirmed member is checked again after a day
const GRACE_MS = 3 * 86400e3; // Skool unreachable or changed: a recent member keeps access this long
const KEY = 'membership';

export type Status = 'member' | 'not-member' | 'signed-out' | 'unknown';
type Saved = { status: Status; at: number; okAt?: number };

/** Membership from the HTML of a Skool page. Throws when the page has no data we understand. */
export function parse(html: string): Exclude<Status, 'unknown'> {
  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  const page = json && JSON.parse(json).props?.pageProps;
  if (!page) throw new Error('Skool page format changed');
  if (!page.self) return 'signed-out';
  const m = page.self.member;
  return m?.groupId === GROUP_ID && ROLES.includes(m.role) ? 'member' : 'not-member';
}

export async function check(force = false): Promise<Status> {
  // `npm run dev` is a plain web page that cannot reach skool.com: pick the state with ?membership=.
  if (import.meta.env.DEV) return (new URLSearchParams(location.search).get('membership') as Status) || 'member';
  const saved = (await chrome.storage.local.get([KEY]))[KEY] as Saved | undefined;
  const now = Date.now();
  if (!force && saved?.status === 'member' && now - saved.at < RECHECK_MS) return 'member';
  try {
    const res = await fetch(COMMUNITY_URL, { credentials: 'include' });
    if (!res.ok) throw new Error(`Skool ${res.status}`);
    const status = parse(await res.text());
    await chrome.storage.local.set({ [KEY]: { status, at: now, okAt: status === 'member' ? now : undefined } satisfies Saved });
    return status;
  } catch {
    // Network down or Skool changed: fail closed, except for a member confirmed in the last few days.
    return saved?.okAt && now - saved.okAt < GRACE_MS ? 'member' : 'unknown';
  }
}
