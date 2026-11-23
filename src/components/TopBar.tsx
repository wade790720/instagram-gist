import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowsRotateRight, Check, ChevronDown, Ellipsis, Gear, LayoutCells, LayoutCellsLarge, Magnifier, Pencil, Sparkles, TrashBin } from '@gravity-ui/icons';
import { Popover as PopoverPrimitive } from 'radix-ui';
import * as Core from '@/core';
import { deleteTopic, sortRest, sync } from '@/lib/actions';
import { t } from '@/lib/i18n';
import { db, emit, save, setView, ui, type Tab } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TopicInput } from './Sidebar';
import { TopicDot } from './TopicDot';
import { onboarded } from './Welcome';

// Level 1: app-wide chrome (brand, search, sync, settings) above the section tabs. Topic filtering lives one level down, in ContextBar.
export function TopBar() {
  const { tab, q } = ui.view;
  const digests = Object.values(db.summaries).reduce((n, l) => n + l.length, 0);
  const tabs: [Tab, string, number][] = [
    ['saved', t('tabSaved'), db.saved.length],
    ['following', t('tabFollowing'), db.following.length],
    ['digests', t('tabBookmarks'), digests],
  ];
  const list = tab === 'following' || tab === 'saved';

  return (
    <header className="shrink-0 border-b bg-background">
      <div className="flex h-14 items-center gap-4 px-8 max-md:gap-2 max-md:px-4">
        <div className="flex shrink-0 items-center gap-2.5">
          <img src="/icons/icon-48.png" alt="" className="size-6 rounded-md" />
          <span className="text-sm font-semibold max-sm:sr-only">{t('appShortName')}</span>
        </div>
        <span className="flex-1" />
        {list && (
          <div className="relative w-72 min-w-0 shrink max-md:w-auto max-md:flex-1">
            <Magnifier className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={q} onChange={e => setView({ q: e.target.value })} placeholder={t('search')} aria-label={t('search')} className="!pl-9" />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={t('sync')} onClick={sync} busy={ui.busy}>
            <ArrowsRotateRight className={cn(ui.busy && 'animate-spin')} />
          </IconButton>
          <IconButton label={t('tabSettings')} onClick={() => setView({ tab: 'settings', cat: '' })} active={tab === 'settings'}>
            <Gear />
          </IconButton>
        </div>
      </div>
      {/* Section tabs sit on the header's bottom edge: an underline reads as navigation, a filled toggle as a filter. */}
      <nav aria-label={t('sections')} className="-mb-px flex gap-6 px-8 max-md:px-4">
        {tabs.map(([id, label, n]) => (
          <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setView({ tab: id, cat: '' })}
            className={cn('relative flex h-10 items-center gap-1.5 text-sm font-medium transition-colors duration-[120ms]',
              'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors after:duration-[120ms]',
              tab === id ? 'text-foreground after:bg-foreground' : 'text-text-secondary after:bg-transparent hover:text-foreground')}>
            {label}<span className="text-xs tabular-nums text-muted-foreground">{n}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}

// Level 2: which slice of the list you are looking at, its size, and what you can do to it.
export function ContextBar() {
  const { tab, cat } = ui.view;
  const [editing, setEditing] = useState(false);
  const list = tab === 'following' || tab === 'saved' ? db[tab] : null;
  if (!list?.length) return null;
  const untagged = list.filter(x => !x.cat).length;

  return (
    <div className="flex shrink-0 items-center gap-2 px-8 pt-5 pb-4 max-md:px-4">
      {editing && cat
        ? <div className="w-64"><TopicInput cat={cat} done={() => setEditing(false)} /></div>
        : <TopicChips list={list} />}
      {cat && !editing && <TopicMenu cat={cat} onEdit={() => setEditing(true)} />}
      {editing && <span className="flex-1" />}
      {untagged > 0 && onboarded() && (
        <Button variant="outline" aria-disabled={ui.busy} onClick={sortRest}><Sparkles />{t('sortRest', untagged)}</Button>
      )}
      {tab === 'following' && <ViewToggle />}
    </div>
  );
}

const GAP = 8;
// Same height and corner as Button (index.css), so the filter row lines up with every other control.
const chip = 'flex h-9 shrink-0 items-center gap-1.5 rounded-[calc(var(--radius)-2px)] border px-3 text-sm font-medium whitespace-nowrap shadow-[var(--shadow-xs)] max-sm:px-2.5 transition-[background-color,border-color,color] duration-[120ms] ease-[var(--ease-ui)]';
const chipOn = 'border-[var(--chip-on-line)] bg-[var(--chip-on)] text-foreground';
const chipOff = 'border-line-strong bg-card text-foreground hover:bg-row-hover data-[state=open]:bg-row-active';

// Priority+: every topic that fits is one click away; the rest, and search, sit behind "More".
function TopicChips({ list }: { list: Core.Item[] }) {
  const { cat } = ui.view;
  const all = Core.groupCounts(list);
  const row = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(all.length);
  const [tight, setTight] = useState(false);
  // A selected topic that would be cut off moves to the front, so the row always shows where you are.
  const sel = all.findIndex(([c]) => c === cat);
  const ordered = sel >= fit ? [all[sel], ...all.filter((_, j) => j !== sel)] : all;
  const order = ordered.map(([c]) => c).join('\n');

  useLayoutEffect(() => {
    const el = row.current!;
    const measure = () => {
      // Hidden chips stay mounted (absolutely placed) so every width is known up front.
      const w = (q: string) => el.querySelector<HTMLElement>(q)?.offsetWidth ?? 0;
      const widths = [...el.querySelectorAll<HTMLElement>('[data-topic]')].map(c => c.offsetWidth);
      const more = w('[data-more]') || 80;
      let used = w('[data-all]'), n = 0;
      for (; n < widths.length; n++) {
        const need = used + GAP + widths[n] + (n + 1 < widths.length ? GAP + more : 0);
        if (need > el.clientWidth) break;
        used += GAP + widths[n];
      }
      // The selected topic is pinned first and always shown. It shrinks only when nothing else fits;
      // a shrinkable chip reports its squeezed width here, which would let more chips in and squeeze it again.
      setFit(cat ? Math.max(n, 1) : n);
      setTight(!!cat && n === 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [order, cat]);

  const more = ordered.length - fit;
  return (
    <div ref={row} className="relative flex min-w-0 flex-1 items-center overflow-hidden py-px" style={{ gap: GAP }}>
      <button data-all onClick={() => setView({ cat: '' })} aria-current={!cat || undefined} className={cn(chip, !cat ? chipOn : chipOff)}>
        {t('all')}<span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>
      </button>
      {ordered.map(([c, n], j) => (
        <button key={c} data-topic onClick={() => setView({ cat: c })} aria-current={cat === c || undefined}
          {...(j >= fit && { inert: true, 'aria-hidden': true })}
          className={cn(chip, cat === c ? cn(chipOn, tight && 'min-w-0 shrink') : chipOff, j >= fit && 'invisible absolute top-0 left-0')}>
          <TopicDot cat={c} /><span className="truncate">{c}</span><span className="text-xs tabular-nums text-muted-foreground">{n}</span>
        </button>
      ))}
      {more > 0 && <TopicSwitcher list={list} more={more} />}
    </div>
  );
}

// The full list with search, for topics the row has no room for. Scales to hundreds of topics.
function TopicSwitcher({ list, more }: { list: Core.Item[]; more: number }) {
  const { cat } = ui.view;
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const all = Core.groupCounts(list);
  const shown = find.trim() ? all.filter(([c]) => c.toLowerCase().includes(find.trim().toLowerCase())) : all;
  const pick = (c: string) => { setView({ cat: c }); setOpen(false); };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={o => { setOpen(o); if (!o) setFind(''); }}>
      <PopoverPrimitive.Trigger data-more aria-label={t('moreTopics', more)} className={cn(chip, chipOff, 'gap-1 pe-2.5')}>
        {/* Narrow screens show "+3" so the selected topic keeps its full name. */}
        <span className="max-sm:hidden">{t('moreTopics', more)}</span><span className="sm:hidden">+{more}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="end" sideOffset={6}
          className="z-50 flex w-72 flex-col rounded-xl border border-transparent bg-popover p-1.5 text-popover-foreground shadow-[var(--pop-shadow)]">
          <div className="relative mb-1">
            <Magnifier className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input autoFocus value={find} onChange={e => setFind(e.target.value)} placeholder={t('findTopic')} aria-label={t('findTopic')}
              onKeyDown={e => { if (e.key === 'Enter' && shown[0]) pick(shown[0][0]); }}
              className="h-9 w-full rounded-md bg-transparent pr-2 pl-8 text-sm placeholder:text-muted-foreground focus-visible:outline-offset-0" />
          </div>
          <div className="-mx-1.5 mb-1 border-t" />
          <div className="scroll-fade flex max-h-[min(60vh,420px)] flex-col overflow-y-auto overscroll-contain">
            {shown.map(([c, n]) => <TopicOption key={c} cat={c} label={c} n={n} active={cat === c} onPick={() => pick(c)} />)}
            {!shown.length && <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">{t('noTopicMatch')}</p>}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function TopicOption({ cat, label, n, active, onPick }: { cat?: string; label: string; n: number; active: boolean; onPick: () => void }) {
  return (
    <button onClick={onPick} aria-current={active || undefined}
      className={cn('flex h-9 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors duration-[120ms] hover:bg-row-hover focus-visible:bg-row-hover', active && 'font-medium')}>
      {cat ? <TopicDot cat={cat} /> : <span className="size-2" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
      <Check className={cn('size-4 shrink-0', !active && 'invisible')} />
    </button>
  );
}

function TopicMenu({ cat, onEdit }: { cat: string; onEdit: () => void }) {
  return (
    // modal={false}: "Delete" opens a confirm dialog, and a modal menu can leave the page unclickable.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('topicActions', cat)} disabled={ui.busy} className="text-muted-foreground hover:text-foreground"><Ellipsis /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuItem onSelect={onEdit}><Pencil />{t('editTopic')}</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => deleteTopic(cat)}><TrashBin />{t('deleteCat')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IconButton({ label, onClick, busy, active, children }: { label: string; onClick: () => void; busy?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={onClick} aria-disabled={busy || undefined} aria-label={label} aria-pressed={active}
          className={cn('shrink-0 text-text-secondary hover:text-foreground', active && 'bg-row-active text-foreground')}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function ViewToggle() {
  const v = db.settings.followView;
  const set = (followView: 'grid' | 'compact') => { db.settings.followView = followView; save(); emit(); };
  const options = [['grid', LayoutCellsLarge, t('viewGrid')], ['compact', LayoutCells, t('viewCompact')]] as const;
  return (
    <div role="group" aria-label={t('viewAs')} className="flex h-9 shrink-0 items-center gap-0.5 rounded-[calc(var(--radius)-2px)] border border-line-strong bg-card p-0.5 shadow-[var(--shadow-xs)]">
      {options.map(([id, Icon, label]) => (
        <Button key={id} variant="ghost" size="icon-sm" aria-pressed={v === id} aria-label={label} title={label} onClick={() => set(id)}
          className={cn('!size-[30px] rounded-[5px] text-muted-foreground hover:text-foreground', v === id && 'bg-row-active text-foreground hover:!bg-row-active')}><Icon className="size-4" /></Button>
      ))}
    </div>
  );
}
