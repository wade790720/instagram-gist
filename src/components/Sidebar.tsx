import { useRef, useState } from 'react';
import { Bookmark, MoreHorizontal, Pencil, RefreshCw, Settings, Sparkles, Trash2, Users } from 'lucide-react';
import * as Core from '@/core';
import { deleteTopic, renameTopic, sync } from '@/lib/actions';
import { t } from '@/lib/i18n';
import { allItems, db, setView, status, ui, type Tab } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TopicDot } from './TopicDot';

const row = 'flex h-9 w-full shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm font-medium transition-[background-color,box-shadow,color,scale] duration-[120ms] ease-[var(--ease-ui)] active:scale-[.98]';
const on = 'bg-row-active text-foreground';
const off = 'text-text-secondary hover:bg-row-hover hover:text-foreground';

export function Sidebar() {
  const { tab, cat } = ui.view;
  const digests = Object.values(db.summaries).reduce((n, l) => n + l.length, 0);
  const nav: [Tab, typeof Users, string, number?][] = [
    ['following', Users, t('tabFollowing'), db.following.length],
    ['saved', Bookmark, t('tabSaved'), db.saved.length],
    ['digests', Sparkles, t('tabBookmarks'), digests],
    ['settings', Settings, t('tabSettings')],
  ];
  const list = tab === 'following' || tab === 'saved' ? db[tab] : null;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground max-md:max-h-[40dvh] max-md:w-full max-md:border-r-0 max-md:border-b">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <img src="/icons/icon-48.png" alt="" className="size-6 rounded-md" />
        <span className="flex-1 truncate text-sm font-semibold text-foreground">{t('appShortName')}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={sync} disabled={ui.busy} aria-label={t('sync')}>
              <RefreshCw className={cn('size-4', ui.busy && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sync')}</TooltipContent>
        </Tooltip>
      </div>
      <nav className="flex flex-col gap-0.5 px-3 pt-3">
        {nav.map(([id, Icon, label, n]) => (
          <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setView({ tab: id, cat: '' })}
            className={cn(row, tab === id ? on : off)}>
            <Icon className="size-4" strokeWidth={1.75} />
            <span className="flex-1">{label}</span>
            {n !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{n}</span>}
          </button>
        ))}
      </nav>

      {list && list.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-5 pt-5 pb-1 text-xs text-muted-foreground">{t('topics')}</div>
          <div className="scroll-fade flex flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 pt-2 pb-4">
            <button onClick={() => setView({ cat: '' })} className={cn(row, !cat ? on : off)}>
              <span className="size-2" />
              <span className="flex-1">{t('all')}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>
            </button>
            {Core.groupCounts(list).map(([c, n]) => <TopicRow key={c} cat={c} n={n} active={cat === c} />)}
          </div>
        </div>
      )}
    </aside>
  );
}

function TopicRow({ cat, n, active }: { cat: string; n: number; active: boolean }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const skipFocusReturn = useRef(false);
  const shown = active || menu;

  return (
    <div className="group relative" onContextMenu={e => { e.preventDefault(); if (!ui.busy && !editing) setMenu(true); }}>
      {editing ? <TopicInput cat={cat} done={() => setEditing(false)} /> : (
        <button onClick={() => setView({ cat })} className={cn(row, 'pr-9', active ? on : off)}>
          <TopicDot cat={cat} />
          <span className="flex-1 truncate">{cat}</span>
          <span className={cn('absolute right-3 text-xs tabular-nums text-muted-foreground transition-opacity duration-150', shown ? 'opacity-0' : 'group-hover:opacity-0')}>{n}</span>
        </button>
      )}
      {!editing && (
        // modal={false}: "Delete" opens a confirm dialog, and a modal menu can leave the page unclickable.
        <DropdownMenu open={menu} onOpenChange={setMenu} modal={false}>
          <DropdownMenuTrigger asChild>
            <button aria-label={t('editCat', cat)} disabled={ui.busy}
              className={cn(
                'absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground',
                'transition-[opacity,background-color,scale] duration-150 ease-out hover:bg-foreground/10 hover:text-foreground active:scale-90 focus-visible:opacity-100 disabled:hidden',
                shown ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}>
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40" onCloseAutoFocus={e => { if (skipFocusReturn.current) { e.preventDefault(); skipFocusReturn.current = false; } }}>
            <DropdownMenuItem onSelect={() => { skipFocusReturn.current = true; setEditing(true); }}><Pencil />{t('editTopic')}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => deleteTopic(cat)}><Trash2 />{t('deleteCat')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function TopicInput({ cat, done }: { cat: string; done: () => void }) {
  const before = useRef(ui.status);
  const finished = useRef(false);
  const others = Core.groupCounts(allItems()).map(([c]) => c).filter(c => c !== cat);
  const hint = (v: string) => status(others.includes(v.trim()) ? t('mergeHint', v.trim()) : t('enterToSave'));
  const finish = (to?: string) => {
    if (finished.current) return;
    finished.current = true;
    status(before.current);
    done();
    if (to !== undefined) renameTopic(cat, to.trim());
  };
  return (
    <input
      autoFocus defaultValue={cat} aria-label={t('editCat', cat)}
      onFocus={e => { e.currentTarget.select(); hint(e.currentTarget.value); }}
      onChange={e => hint(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(e.currentTarget.value); }
        if (e.key === 'Escape') { e.preventDefault(); finish(); }
      }}
      onBlur={() => finish()}
      className="h-9 w-full rounded-md bg-card px-2.5 text-sm text-foreground ring-2 ring-ring outline-none"
    />
  );
}
