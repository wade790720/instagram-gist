import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import type { Item } from '@/core';
import { moveItem } from '@/lib/actions';
import { t } from '@/lib/i18n';
import { avatars } from '@/lib/store';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TopicDot } from './TopicDot';

export function Avatar({ name, className }: { name: string; className?: string }) {
  const src = avatars[name];
  return src
    ? <img src={src} alt="" className={cn('size-7 shrink-0 rounded-full object-cover', className)} />
    : <span aria-hidden className={cn('grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground uppercase', className)}>{name.slice(0, 1)}</span>;
}

// modal={false}: a modal menu that opens a dialog ("New topic…") can leave the page unclickable.
export function TopicPicker({ x, cats, overlay, className }: { x: Item; cats: string[]; overlay?: boolean; className?: string }) {
  // 'cold' is a plain button: mounting the Radix menu up front made 600 cards render 6x slower (727 vs 117 ms, dev build).
  const [menu, setMenu] = useState<'cold' | 'open' | 'closed'>('cold');
  const cls = cn(
    'group/p flex shrink-0 items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring',
    overlay
      ? 'h-6 max-w-32 rounded-full bg-white/15 px-2 text-xs text-white backdrop-blur-sm hover:bg-white/25 data-[state=open]:bg-white/25'
      : 'h-7 w-36 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
    className,
  );
  const label = <>
    <TopicDot cat={x.cat} />
    <span className="min-w-0 flex-1 truncate text-left">{x.cat || t('unsorted')}</span>
    {!overlay && <ChevronDown className="size-3.5 opacity-0 transition-opacity group-hover:opacity-50 group-data-[state=open]/p:opacity-50" />}
  </>;

  // Once mounted, Radix toggles on pointer down; an onClick of our own would reopen the menu it just closed.
  const trigger = <button type="button" className={cls} aria-label={t('moveTo')} aria-haspopup="menu" onClick={menu === 'cold' ? () => setMenu('open') : undefined}>{label}</button>;
  if (menu === 'cold') return trigger;
  return (
    <DropdownMenu open={menu === 'open'} onOpenChange={o => setMenu(o ? 'open' : 'closed')} modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-48 overflow-y-auto overscroll-contain">
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
