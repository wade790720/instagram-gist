import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp } from '@gravity-ui/icons';
import { groupCounts } from '@/core';
import { applyTidy } from '@/lib/actions';
import { t } from '@/lib/i18n';
import { refreshModels } from '@/lib/gemini';
import { allItems, db, emit, ui, useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DigestsView } from './components/Digests';
import { ListView } from './components/ListView';
import { SettingsView } from './components/SettingsView';
import { ContextBar, TopBar } from './components/TopBar';
import { TopicDot } from './components/TopicDot';
import { onboarded, Welcome } from './components/Welcome';

export function App() {
  useStore();
  const { tab } = ui.view;
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(false);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [tab, ui.view.cat]);
  useEffect(() => { void refreshModels(); }, [db.settings.apiKey]);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen flex-col overflow-hidden">
        <TopBar />
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {onboarded() && <ContextBar key={`${ui.view.tab}|${ui.view.cat}`} />}
          <div ref={scroller} data-scroller onScroll={e => setTop(e.currentTarget.scrollTop > e.currentTarget.clientHeight)}
            className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            {tab === 'following' || tab === 'saved'
              ? (onboarded() ? <ListView key={`${tab}|${ui.view.cat}|${ui.view.q}`} tab={tab} /> : <Welcome />)
              : tab === 'digests' ? <DigestsView /> : <SettingsView key="settings" />}
          </div>
          <StatusBar />
          <Button variant="outline" size="icon" aria-label={t('backToTop')} title={t('backToTop')}
            onClick={() => scroller.current?.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}
            className={cn('absolute right-8 bottom-14 rounded-full max-md:right-4 bg-popover shadow-md transition-[opacity,translate] duration-200',
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

function StatusBar() {
  const p = ui.progress;
  return (
    <footer role="status" className="flex min-h-9 shrink-0 items-center gap-3 border-t px-8 py-1.5 text-xs max-md:px-4">
      <span className={cn('min-w-0 flex-1', ui.err ? 'text-destructive' : 'text-muted-foreground')}>{ui.status}</span>
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
      <AlertDialogContent className="flex max-h-[85dvh] flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-semibold">{t('tidy')}</AlertDialogTitle>
          <AlertDialogDescription>{plan?.merges.length ? t('tidyMergeHint') : t('tidyNoMerge')}</AlertDialogDescription>
        </AlertDialogHeader>
        {/* Only the list scrolls, so Apply and Cancel stay in view however long the plan is. */}
        <div className="scroll-fade -mx-6 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-6">
        {plan?.merges.map(([from, to]) => (
          <label key={from} className="flex flex-wrap items-center gap-2">
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
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={close}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => plan && applyTidy(merges, plan.defs)}>{t('tidyApply')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AskDialog() {
  const a = ui.ask;
  const [text, setText] = useState('');
  useEffect(() => setText(''), [a]);
  const close = (accepted: boolean) => {
    if (a?.kind === 'confirm') a.resolve(accepted);
    else a?.resolve(accepted ? text.trim() || null : null);
    ui.ask = null;
    emit();
  };
  const ok = () => close(true);

  return (
    <AlertDialog open={!!a} onOpenChange={o => { if (!o) close(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-semibold">{a?.title ?? a?.ok}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-wrap">{a?.msg}</AlertDialogDescription>
        </AlertDialogHeader>
        {a?.kind === 'text' && (
          <Input autoFocus value={text} onChange={e => setText(e.target.value)} aria-label={a.msg}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }} />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={ok} variant={a?.kind === 'confirm' && a.danger ? 'destructive' : 'default'}>{a?.ok}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
