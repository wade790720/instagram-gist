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

const row = 'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50';

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
    <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center gap-2 px-3">
        <span className="grid size-6 place-items-center rounded-md bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-[10px] font-bold text-white">IG</span>
        <span className="flex-1 truncate font-semibold text-foreground">{t('appName')}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-7" onClick={sync} disabled={ui.busy} aria-label={t('sync')}>
              <RefreshCw className={cn('size-4', ui.busy && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sync')}</TooltipContent>
        </Tooltip>
      </div>

      <nav className="flex flex-col gap-px px-2">
        {nav.map(([id, Icon, label, n]) => (
          <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setView({ tab: id, cat: '' })}
            className={cn(row, tab === id ? 'bg-accent text-foreground' : 'hover:bg-accent/60 hover:text-foreground')}>
            <Icon className="size-4 opacity-80" />
            <span className="flex-1">{label}</span>
            {n !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{n}</span>}
          </button>
        ))}
      </nav>

      {list && list.length > 0 && (
        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          <div className="px-4 pb-1 text-xs font-medium text-muted-foreground">{t('topics')}</div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            <button onClick={() => setView({ cat: '' })} className={cn(row, !cat ? 'bg-accent text-foreground' : 'hover:bg-accent/60 hover:text-foreground')}>
              <span className="size-2" />
              <span className="flex-1">{t('all')}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>
            </button>
            {Core.groupCounts(list).map(([c, n]) => <TopicRow key={c} cat={c} n={n} on={cat === c} />)}
          </div>
        </div>
      )}
    </aside>
  );
}

// Edit sits on the topic itself, as in Linear, Gmail and Notion: "⋯" fades in on hover and stays
// on the selected topic; right-click opens the same menu. Edit turns the row into a text field.
function TopicRow({ cat, n, on }: { cat: string; n: number; on: boolean }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const edit = useRef(false); // Edit picked: keep Radix from moving focus back to "⋯" on close
  const shown = on || menu;

  return (
    <div className="group relative" onContextMenu={e => { e.preventDefault(); if (!ui.busy && !editing) setMenu(true); }}>
      {editing ? <TopicInput cat={cat} done={() => setEditing(false)} /> : (
        <button onClick={() => setView({ cat })} className={cn(row, 'pr-8', on ? 'bg-accent text-foreground' : 'hover:bg-accent/60 hover:text-foreground')}>
          <TopicDot cat={cat} />
          <span className="flex-1 truncate">{cat}</span>
          {/* The count steps aside for "⋯" in the same spot, so nothing shifts. */}
          <span className={cn('absolute right-2 text-xs tabular-nums text-muted-foreground transition-opacity duration-150', shown ? 'opacity-0' : 'group-hover:opacity-0')}>{n}</span>
        </button>
      )}
      {!editing && (
        // modal={false}: "Delete" opens a confirm dialog, and a modal menu can leave the page unclickable.
        <DropdownMenu open={menu} onOpenChange={setMenu} modal={false}>
          <DropdownMenuTrigger asChild>
            <button aria-label={t('editCat', cat)} disabled={ui.busy}
              className={cn(
                'absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none',
                'transition-[opacity,scale,background-color] duration-150 ease-out hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:hidden',
                shown ? 'scale-100 opacity-100' : 'scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100',
              )}>
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40" onCloseAutoFocus={e => { if (edit.current) { e.preventDefault(); edit.current = false; } }}>
            <DropdownMenuItem onSelect={() => { edit.current = true; setEditing(true); }}><Pencil />{t('editTopic')}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => deleteTopic(cat)}><Trash2 />{t('deleteCat')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// Enter saves; Esc or clicking away cancels, so a half-typed name never merges two topics.
// The status bar says when the name already exists (= merge), before it happens.
function TopicInput({ cat, done }: { cat: string; done: () => void }) {
  const before = useRef(ui.status);
  const finished = useRef(false);
  const others = Core.groupCounts(allItems()).map(([c]) => c).filter(c => c !== cat);
  const hint = (v: string) => status(others.includes(v.trim()) ? t('mergeHint', v.trim()) : t('enterToSave'));
  const finish = (to?: string) => {
    if (finished.current) return; // unmounting fires blur once more
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
      className="h-7 w-full rounded-md bg-background px-2 text-[13px] text-foreground ring-2 ring-ring outline-none"
    />
  );
}
