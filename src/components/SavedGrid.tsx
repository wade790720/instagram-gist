import { useLayoutEffect, useRef, useState } from 'react';
import { Copy, PlayFill } from '@gravity-ui/icons';
import type { Post } from '@/core';
import { t } from '@/lib/i18n';
import { useThumb } from '@/lib/thumbs';
import { cn } from '@/lib/utils';
import { Avatar, TopicPicker, useProgressive } from './ItemParts';

const MIN_COL_WIDTH = 240;
const GAP = 16;
const ratio = (p: Post) => Math.min(1.5, Math.max(0.75, p.w && p.h ? p.h / p.w : 1.25));

export function SavedGrid({ posts, cats }: { posts: Post[]; cats: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setCols(Math.max(2, Math.floor((e.contentRect.width + GAP) / (MIN_COL_WIDTH + GAP)))));
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
    <div ref={ref} className="px-8 py-6">
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

function Card({ p, cats }: { p: Post; cats: string[] }) {
  const src = useThumb(p);
  const TypeIcon = p.type === 'video' ? PlayFill : p.type === 'carousel' ? Copy : null;
  return (
    <div className="group tile relative overflow-hidden rounded-xl bg-muted transition-[box-shadow,scale] duration-[120ms] ease-[var(--ease-ui)] hover:shadow-[var(--shadow-border-hover)] active:scale-[.98]" style={{ aspectRatio: `1 / ${ratio(p)}` }}>
      {src
        ? <img src={src} alt="" className="absolute inset-0 size-full rounded-[inherit] object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" />
        : <p className="absolute inset-0 line-clamp-[9] p-4 pr-10 text-sm leading-6 text-muted-foreground">{p.caption || p.alt}</p>}
      <a href={`https://www.instagram.com/p/${p.code}/`} target="_blank" rel="noreferrer" title={p.caption.slice(0, 200)}
        aria-label={t('openPost', p.user)} className="absolute inset-0 z-10 rounded-xl focus-visible:outline-offset-[-2px]" />
      {TypeIcon && <TypeIcon aria-hidden className={cn('pointer-events-none absolute top-3 right-3 z-10 size-4 text-white drop-shadow-md', TypeIcon === PlayFill && 'translate-x-px')} />}
      <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 px-3 pb-3', src ? 'bg-gradient-to-t from-black/85 via-black/50 to-transparent pt-12' : 'bg-gradient-to-t from-card from-60% to-transparent pt-8')}>
        <Avatar name={p.user} className={cn('size-6 text-[10px]', src && 'ring-1 ring-white/30')} />
        <span className={cn('min-w-0 flex-1 truncate text-xs font-medium', src ? 'text-white' : 'text-foreground')}>@{p.user}</span>
        <div className="pointer-events-auto"><TopicPicker x={p} cats={cats} overlay={!!src} /></div>
      </div>
    </div>
  );
}
