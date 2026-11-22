import { useEffect, useState } from 'react';
import type { Post } from '@/core';
import { t } from './i18n';
import { db, emit, status, ui } from './store';

// Post covers live in the Cache API, not chrome.storage: ~500 images (~25 MB) would otherwise be
// read into memory on every page load. Each card reads only its own image, when it mounts.
const CACHE = 'thumbs';
const key = (id: string) => `https://ig-sorter.invalid/thumb/${id}`;

/** IG CDN downloads (covers, avatars) with progress in the status bar. Empties todo; returns how many there were.
 * A failed download (expired URL, blocked) is skipped: the card keeps its placeholder. */
// ponytail: 6 at a time, no pauses; the CDN is not the rate-limited API.
export async function pool<T>(todo: T[], job: (x: T) => Promise<void>, label: string) {
  const total = todo.length;
  let done = 0;
  const lane = async () => {
    for (let x; (x = todo.pop()) !== undefined; ) {
      try { await job(x); } catch { /* skipped, see above */ }
      ui.progress = ++done / total;
      status(t(label, done, total));
    }
  };
  await Promise.all(Array.from({ length: 6 }, lane));
  return total;
}

// Same reason as avatars: IG's CDN blocks <img> on other sites and its URLs expire, so sync
// downloads each cover once while its URL is fresh (host_permissions allow the fetch).
export async function fetchThumbs() {
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map(r => r.url));
  const total = await pool(db.saved.filter(p => p.thumb && !have.has(key(p.id))), async p => {
    const r = await fetch(p.thumb!, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (r.ok) await cache.put(key(p.id), r);
  }, 'syncingThumbs');
  if (total) { ui.thumbs++; emit(); } // mounted cards look again
}

export const clearThumbs = () => caches.delete(CACHE);

/** Object URL of a post's cached cover, or undefined while loading / when there is none. */
export function useThumb(p: Post) {
  const [src, setSrc] = useState<string>();
  const version = ui.thumbs;
  useEffect(() => {
    if (p.thumb?.startsWith('data:')) return setSrc(p.thumb); // dev mock
    let url: string | undefined;
    let live = true;
    caches.open(CACHE).then(c => c.match(key(p.id))).then(r => r?.blob()).then(b => {
      if (b && live) setSrc((url = URL.createObjectURL(b)));
    });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [p.id, p.thumb, version]);
  return src;
}
