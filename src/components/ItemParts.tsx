import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import type { Item } from '@/core';
import { moveItem } from '@/lib/actions';
import { t } from '@/lib/i18n';
import { avatars } from '@/lib/store';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TopicDot } from './TopicDot';

// Stored data URL (see fetchAvatars); initial letter until it is downloaded.
export function Avatar({ name, className }: { name: string; className?: string }) {
  const src = avatars[name];
  return src
    ? <img src={src} alt="" className={cn('size-7 shrink-0 rounded-full object-cover', className)} />
    : <span aria-hidden className={cn('grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground uppercase', className)}>{name.slice(0, 1)}</span>;
}

// Move one item to another topic, or a new one (asks for the name).
// A plain button until first use: hundreds of mounted Radix menus made tab switches lag.
// modal={false}: a modal menu that opens a dialog ("New topic…") can leave the page unclickable.
export function TopicPicker({ x, cats, overlay }: { x: Item; cats: string[]; overlay?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const cls = cn(
    'group/p flex shrink-0 items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
    overlay
      ? 'h-6 max-w-32 rounded-full bg-white/15 px-2 text-[11px] text-white backdrop-blur-sm hover:bg-white/25 data-[state=open]:bg-white/25'
      : 'h-7 w-36 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
  );
  const label = <>
    <TopicDot cat={x.cat} />
    <span className="min-w-0 flex-1 truncate text-left">{x.cat || t('unsorted')}</span>
    {!overlay && <ChevronDown className="size-3.5 opacity-0 transition-opacity group-hover:opacity-50 group-data-[state=open]/p:opacity-50" />}
  </>;

  if (!mounted) return (
    <button type="button" className={cls} aria-label={t('moveTo')} aria-haspopup="menu" onClick={() => { setMounted(true); setOpen(true); }}>{label}</button>
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cls} aria-label={t('moveTo')}>{label}</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-48 overflow-y-auto">
        {cats.map(c => (
          <DropdownMenuItem key={c} onSelect={() => moveItem(x, c)}>
            <TopicDot cat={c} />
            <span className="min-w-0 flex-1 truncate">{c}</span>
            {c === x.cat && <Check className="text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => moveItem(x, null)}><Plus />{t('newCat').replace(/^＋\s*/, '')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Render a long list a page at a time: `n` items now, `step` more each time the returned sentinel
 * comes within 800 px of the bottom of the scroll area. Remount (change the key) to start over.
 */
export function useProgressive(total: number, step: number) {
  const [n, setN] = useState(step);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Re-created after each growth: a sentinel that is still in range fires again at once.
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setN(v => v + step); },
      { root: el.closest('[data-scroller]'), rootMargin: '0px 0px 800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [n, step]);
  return { n, sentinel: n < total ? <div ref={ref} aria-hidden className="h-px" /> : null };
}
