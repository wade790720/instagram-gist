import { useEffect, useState } from 'react';
import type { Post } from '@/core';
import { t } from './i18n';
import { db, status, ui } from './store';

const CACHE = 'thumbs';
const key = (id: string) => `https://ig-sorter.invalid/thumb/${id}`;

// ponytail: 12 at a time (avatars and covers together), no pauses; the CDN is not the rate-limited API.
export async function pool<T>(todo: T[], job: (x: T) => Promise<void>, label: string) {
  const total = todo.length;
  let done = 0;
  const lane = async () => {
    for (let x; (x = todo.pop()) !== undefined; ) {
      try { await job(x); } catch {}
      ui.progress = ++done / total;
      status(t(label, done, total));
    }
  };
  await Promise.all(Array.from({ length: 12 }, lane));
  return total;
}

// Same reason as avatars: IG's CDN blocks <img> on other sites and its URLs expire, so sync
// downloads each cover once while its URL is fresh (host_permissions allow the fetch).
export async function coverJobs() {
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map(r => r.url));
  return db.saved.filter(p => p.thumb && !have.has(key(p.id))).map(p => async () => {
    const r = await fetch(p.thumb!, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (r.ok) await cache.put(key(p.id), r);
  });
}

export const clearThumbs = () => caches.delete(CACHE);

export function useThumb(p: Post) {
  const [src, setSrc] = useState<string>();
  const version = ui.thumbs;
  useEffect(() => {
    if (p.thumb?.startsWith('data:')) return setSrc(p.thumb);
    let url: string | undefined;
    let live = true;
    caches.open(CACHE).then(c => c.match(key(p.id))).then(r => r?.blob()).then(b => {
      if (b && live) setSrc((url = URL.createObjectURL(b)));
    });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [p.id, p.thumb, version]);
  return src;
}
