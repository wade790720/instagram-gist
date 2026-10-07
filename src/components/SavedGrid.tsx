import { useLayoutEffect, useRef, useState } from 'react';
import { Copy, Play } from 'lucide-react';
import type { Post } from '@/core';
import { t } from '@/lib/i18n';
import { useThumb } from '@/lib/thumbs';
import { Avatar, TopicPicker, useProgressive } from './ItemParts';

const COL = 220; // min column width, px
const GAP = 12;
// Height / width, kept between 4:5-ish landscape and 2:3 portrait so no card is a sliver or a tower.
const ratio = (p: Post) => Math.min(1.5, Math.max(0.75, p.w && p.h ? p.h / p.w : 1.25));

// Masonry like Pinterest: each card goes to the shortest column, in saved order, so the newest
// posts stay near the top. Assignment depends only on the order, so loading more never reshuffles.
export function SavedGrid({ posts, cats }: { posts: Post[]; cats: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setCols(Math.max(2, Math.floor((e.contentRect.width + GAP) / (COL + GAP)))));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);
  const { n, sentinel } = useProgressive(posts.length, 40);

  const columns = Array.from({ length: cols }, () => ({ h: 0, items: [] as Post[] }));
  for (const p of posts.slice(0, n)) {
    const c = columns.reduce((a, b) => (b.h < a.h ? b : a));
    c.items.push(p);
    c.h += ratio(p);
  }

  return (
    <div ref={ref} className="px-6 py-5">
      <div className="flex items-start" style={{ gap: GAP }}>
        {columns.map((c, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col" style={{ gap: GAP }}>
            {c.items.map(p => <Card key={p.id} p={p} cats={cats} />)}
          </div>
        ))}
      </div>
      {sentinel}
    </div>
  );
}

// The whole card opens the post on IG in a new tab (a stretched link under the overlay);
// only the topic chip on the dark strip stays clickable on its own.
function Card({ p, cats }: { p: Post; cats: string[] }) {
  const src = useThumb(p);
  const TypeIcon = p.type === 'video' ? Play : p.type === 'carousel' ? Copy : null;
  return (
    <div className="group relative overflow-hidden rounded-lg bg-muted" style={{ aspectRatio: `1 / ${ratio(p)}` }}>
      {src
        ? <img src={src} alt="" className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
        : <p className="absolute inset-0 line-clamp-[9] p-3 text-xs leading-5 text-muted-foreground">{p.caption || p.alt}</p>}
      <a href={`https://www.instagram.com/p/${p.code}/`} target="_blank" rel="noreferrer" title={p.caption.slice(0, 200)}
        aria-label={t('openPost', p.user)} className="absolute inset-0 z-10 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" />
      {TypeIcon && <TypeIcon aria-hidden className="pointer-events-none absolute top-2.5 right-2.5 z-10 size-4 fill-white/90 text-white drop-shadow-md" />}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2.5 pt-10 pb-2.5">
        <Avatar name={p.user} className="size-5 text-[9px] ring-1 ring-white/30" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white">@{p.user}</span>
        <div className="pointer-events-auto"><TopicPicker x={p} cats={cats} overlay /></div>
      </div>
    </div>
  );
}
