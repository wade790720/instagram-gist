import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, ChevronRight, LayoutGrid, List, Search, Sparkles } from 'lucide-react';
import { groupCounts } from '@/core';
import { applyTidy, sortRest } from '@/lib/actions';
import { t } from '@/lib/i18n';
import { allItems, db, emit, save, setView, ui, useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DigestsView } from './components/Digests';
import { ListView } from './components/ListView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { TopicDot } from './components/TopicDot';

const TAB_LABEL = { following: 'tabFollowing', saved: 'tabSaved', digests: 'tabBookmarks', settings: 'tabSettings' } as const;

// Linear's inverted L: sidebar + header frame the content; only the content scrolls.
export function App() {
  useStore();
  const { tab } = ui.view;
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(false);
  // New tab or topic: start at the top.
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [tab, ui.view.cat]);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <Header />
          <div ref={scroller} data-scroller onScroll={e => setTop(e.currentTarget.scrollTop > e.currentTarget.clientHeight)}
            className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            {tab === 'following' || tab === 'saved'
              ? <ListView key={`${tab}|${ui.view.cat}|${ui.view.q}`} tab={tab} />
              : tab === 'digests' ? <DigestsView /> : <SettingsView key="settings" />}
          </div>
          <StatusBar />
          <Button variant="outline" size="icon" aria-label={t('backToTop')} title={t('backToTop')}
            onClick={() => scroller.current?.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}
            className={cn('absolute right-6 bottom-12 rounded-full bg-popover shadow-md transition-[opacity,translate] duration-200',
              top ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0')}>
            <ArrowUp />
          </Button>
        </main>
      </div>
      <AskDialog />
      <TidyDialog />
    </TooltipProvider>
  );
}

function Header() {
  const { tab, cat, q } = ui.view;
  const list = tab === 'following' || tab === 'saved' ? db[tab] : null;
  const untagged = list?.filter(x => !x.cat).length ?? 0;
  const count = list && (cat ? list.filter(x => x.cat === cat).length : list.length);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-6">
      <nav className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
        <button className={cn('shrink-0', cat ? 'text-muted-foreground hover:text-foreground' : 'text-foreground')} onClick={() => setView({ cat: '' })}>{t(TAB_LABEL[tab])}</button>
        {cat && <>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          <TopicDot cat={cat} />
          <span className="truncate">{cat}</span>
        </>}
        {count !== null && <span className="ml-1 text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
      </nav>
      {untagged > 0 && !!db.settings.apiKey && (
        <Button size="sm" variant="outline" className="h-7" disabled={ui.busy} onClick={sortRest}><Sparkles />{t('sortRest', untagged)}</Button>
      )}
      {tab === 'following' && <ViewToggle />}
      {list && (
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={q} onChange={e => setView({ q: e.target.value })} placeholder={t('search')} aria-label={t('search')} className="h-7 pl-8 text-[13px]" />
        </div>
      )}
    </header>
  );
}

// Following only: cards (faces) or rows (names). Kept in settings, so the choice sticks.
function ViewToggle() {
  const v = db.settings.followView;
  const set = (followView: 'grid' | 'list') => { db.settings.followView = followView; save(); emit(); };
  const options = [['grid', LayoutGrid, t('viewGrid')], ['list', List, t('viewList')]] as const;
  return (
    <div role="group" aria-label={t('viewAs')} className="flex h-7 shrink-0 items-center rounded-md border p-0.5">
      {options.map(([id, Icon, label]) => (
        <Button key={id} variant="ghost" size="icon-xs" aria-pressed={v === id} aria-label={label} title={label} onClick={() => set(id)}
          className={cn('size-6 text-muted-foreground', v === id && 'bg-accent text-foreground')}><Icon className="size-3.5" /></Button>
      ))}
    </div>
  );
}

// Status and progress live in one slim bar at the bottom, like an editor's status bar.
function StatusBar() {
  const p = ui.progress;
  return (
    <footer role="status" className="flex h-8 shrink-0 items-center gap-3 border-t px-6 text-xs">
      <span className={cn('min-w-0 flex-1 truncate', ui.err ? 'text-destructive' : 'text-muted-foreground')} title={ui.status}>{ui.status}</span>
      {p !== null && (
        <span className="relative h-1 w-32 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
          {p === 'busy'
            ? <span className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
            : <span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.round(p * 100)}%` }} />}
        </span>
      )}
    </footer>
  );
}

// "Tidy topics" review: every merge is ticked by default, untick to keep two topics apart.
// Definitions are read-only in this first version; topics merged away drop theirs.
function TidyDialog() {
  const plan = ui.tidy;
  const [skip, setSkip] = useState<Set<string>>(new Set());
  useEffect(() => setSkip(new Set()), [plan]);
  const counts = Object.fromEntries(groupCounts(allItems()));
  const close = () => { ui.tidy = null; emit(); };
  const merges = plan?.merges.filter(([from]) => !skip.has(from)) ?? [];
  const gone = new Set(merges.map(([from]) => from));
  const toggle = (from: string) => setSkip(s => { const n = new Set(s); if (!n.delete(from)) n.add(from); return n; });

  return (
    <AlertDialog open={!!plan} onOpenChange={o => { if (!o) close(); }}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">{t('tidy')}</AlertDialogTitle>
          <AlertDialogDescription>{plan?.merges.length ? t('tidyMergeHint') : t('tidyNoMerge')}</AlertDialogDescription>
        </AlertDialogHeader>
        {plan?.merges.map(([from, to]) => (
          <label key={from} className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-primary" checked={!skip.has(from)} onChange={() => toggle(from)} />
            <TopicDot cat={from} /><span>{from}</span><span className="text-xs text-muted-foreground tabular-nums">{counts[from]}</span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
            <TopicDot cat={to} /><span>{to}</span><span className="text-xs text-muted-foreground tabular-nums">{counts[to]}</span>
          </label>
        ))}
        <div className="flex flex-col gap-1 border-t pt-3">
          <span className="text-xs text-muted-foreground">{t('tidyDefs')}</span>
          {Object.entries(plan?.defs ?? {}).filter(([c]) => !gone.has(c)).map(([c, d]) => (
            <p key={c}><span className="font-medium">{c}</span><span className="text-muted-foreground"> · {d}</span></p>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={close}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => plan && applyTidy(merges, plan.defs)}>{t('tidyApply')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// One dialog for every confirm/prompt; actions call ask() and await the answer.
function AskDialog() {
  const a = ui.ask;
  const [text, setText] = useState('');
  useEffect(() => setText(''), [a]);
  const close = (v: string | true | null) => { a?.resolve(v); ui.ask = null; emit(); };
  const ok = () => close(a?.input ? text.trim() || null : true);

  return (
    <AlertDialog open={!!a} onOpenChange={o => { if (!o) close(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">{a?.ok}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-wrap">{a?.msg}</AlertDialogDescription>
        </AlertDialogHeader>
        {a?.input && (
          <Input autoFocus value={text} onChange={e => setText(e.target.value)} aria-label={a.msg}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }} />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(null)}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={ok} className={cn(a?.danger && 'bg-destructive text-white hover:bg-destructive/90')}>{a?.ok}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
