import { useState } from 'react';
import { ArrowsRotateRight, Check, ChevronDown, Ellipsis, Gear, LayoutCellsLarge, ListUl, Magnifier, Pencil, Sparkles, TrashBin } from '@gravity-ui/icons';
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
          <span className="text-sm font-semibold">{t('appShortName')}</span>
        </div>
        <span className="flex-1" />
        {list && (
          <div className="relative w-72 min-w-0 shrink max-md:w-auto max-md:flex-1">
            <Magnifier className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={q} onChange={e => setView({ q: e.target.value })} placeholder={t('search')} aria-label={t('search')} className="!pl-9" />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={t('sync')} onClick={sync} disabled={ui.busy}>
            <ArrowsRotateRight className={cn(ui.busy && 'animate-spin')} />
          </IconButton>
          <IconButton label={t('tabSettings')} onClick={() => setView({ tab: 'settings', cat: '' })} active={tab === 'settings'}>
            <Gear />
          </IconButton>
        </div>
      </div>
      {/* Section tabs sit on the header's bottom edge: an underline reads as navigation, a filled toggle as a filter. */}
      <nav role="tablist" className="-mb-px flex gap-6 px-8 max-md:px-4">
        {tabs.map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setView({ tab: id, cat: '' })}
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
  const count = cat ? list.filter(x => x.cat === cat).length : list.length;

  return (
    <div className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-8 pt-5 max-md:px-4">
      {editing && cat
        ? <div className="w-64"><TopicInput cat={cat} done={() => setEditing(false)} /></div>
        : <TopicSwitcher list={list} />}
      <span className="text-sm tabular-nums text-muted-foreground">{count}</span>
      {cat && !editing && <TopicMenu cat={cat} onEdit={() => setEditing(true)} />}
      <span className="flex-1" />
      {untagged > 0 && onboarded() && (
        <Button variant="outline" size="sm" disabled={ui.busy} onClick={sortRest}><Sparkles />{t('sortRest', untagged)}</Button>
      )}
      {tab === 'following' && <ViewToggle />}
    </div>
  );
}

// A searchable list scales to hundreds of topics, where a row of chips stops working past a dozen.
function TopicSwitcher({ list }: { list: Core.Item[] }) {
  const { cat } = ui.view;
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const all = Core.groupCounts(list);
  const shown = find.trim() ? all.filter(([c]) => c.toLowerCase().includes(find.trim().toLowerCase())) : all;
  const pick = (c: string) => { setView({ cat: c }); setOpen(false); };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={o => { setOpen(o); if (!o) setFind(''); }}>
      <PopoverPrimitive.Trigger aria-label={t('switchTopic')}
        className="-ml-2 flex h-10 min-w-0 items-center gap-2 rounded-lg px-2 text-lg font-semibold tracking-[-0.01em] transition-colors duration-[120ms] hover:bg-row-hover data-[state=open]:bg-row-active">
        {cat && <TopicDot cat={cat} className="size-2.5" />}
        <span className="truncate">{cat || t('allTopics')}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="start" sideOffset={6}
          className="z-50 flex w-72 flex-col rounded-xl bg-popover p-1.5 text-popover-foreground shadow-[var(--pop-shadow)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="relative mb-1">
            <Magnifier className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input autoFocus value={find} onChange={e => setFind(e.target.value)} placeholder={t('findTopic')} aria-label={t('findTopic')}
              onKeyDown={e => { if (e.key === 'Enter' && shown[0]) pick(shown[0][0]); }}
              className="h-9 w-full rounded-md bg-transparent pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="-mx-1.5 mb-1 border-t" />
          <div className="scroll-fade flex max-h-[min(60vh,420px)] flex-col overflow-y-auto overscroll-contain">
            {!find.trim() && <TopicOption label={t('allTopics')} n={list.length} active={!cat} onPick={() => pick('')} />}
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
        <Button variant="ghost" size="icon-sm" aria-label={t('editCat', cat)} disabled={ui.busy} className="text-muted-foreground hover:text-foreground"><Ellipsis /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuItem onSelect={onEdit}><Pencil />{t('editTopic')}</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => deleteTopic(cat)}><TrashBin />{t('deleteCat')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IconButton({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active}
          className={cn('shrink-0 text-text-secondary hover:text-foreground', active && 'bg-row-active text-foreground')}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function ViewToggle() {
  const v = db.settings.followView;
  const set = (followView: 'grid' | 'list') => { db.settings.followView = followView; save(); emit(); };
  const options = [['grid', LayoutCellsLarge, t('viewGrid')], ['list', ListUl, t('viewList')]] as const;
  return (
    <div role="group" aria-label={t('viewAs')} className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-line-strong p-0.5">
      {options.map(([id, Icon, label]) => (
        <Button key={id} variant="ghost" size="icon-sm" aria-pressed={v === id} aria-label={label} title={label} onClick={() => set(id)}
          className={cn('!size-[26px] rounded-md text-muted-foreground hover:text-foreground', v === id && 'bg-row-active text-foreground hover:!bg-row-active')}><Icon className="size-4" /></Button>
      ))}
    </div>
  );
}
