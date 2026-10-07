import { useState } from 'react';
import { ChevronRight, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import * as Core from '@/core';
import type { Digest } from '@/core';
import { deleteDigest, summarize, undoDigest } from '@/lib/actions';
import { t } from '@/lib/i18n';
import { db, emit, ui } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { TopicDot } from './TopicDot';

const postUrl = (code: string) => `https://www.instagram.com/p/${code}/`;

// [n] in the digest links back to the n-th source post. Model output is rendered as text, never HTML.
function DigestText({ d }: { d: Digest }) {
  return (
    <div className="whitespace-pre-wrap leading-7">
      {d.text.split(/(\[\d+\])/).map((part, k) => {
        const n = part.match(/^\[(\d+)\]$/)?.[1];
        const p = n ? db.saved.find(x => x.id === d.sourceIds[Number(n) - 1]) : undefined;
        return p
          ? <a key={k} href={postUrl(p.code)} target="_blank" className="rounded px-0.5 text-[11px] font-medium text-primary tabular-nums hover:bg-primary/10">{part}</a>
          : part;
      })}
    </div>
  );
}

/** One topic's digests, or a "Make digest" card when it has none yet. */
export function TopicDigests({ cat }: { cat: string }) {
  const list = db.summaries[cat] || [];
  if (!list.length) return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-3">
      <Sparkles className="size-4 text-muted-foreground" />
      <span className="flex-1 text-muted-foreground">{t('noDigestYet')}</span>
      <Button size="sm" onClick={() => summarize(cat)} disabled={ui.busy}><Sparkles />{t('makeSummary')}</Button>
    </div>
  );
  return <div className="flex flex-col gap-2">{list.map((d, i) => <DigestCard key={d.id} cat={cat} i={i} d={d} />)}</div>;
}

function DigestCard({ cat, i, d }: { cat: string; i: number; d: Digest }) {
  const key = cat + '#' + d.id;
  const [note, setNote] = useState('');
  const fresh = Core.newSources(d, db.saved.filter(x => x.cat === cat));
  const send = (asNew: boolean) => { if (note.trim()) { summarize(cat, i, note, asNew); setNote(''); } };

  return (
    <Collapsible open={ui.opened.has(key)} onOpenChange={o => { ui.opened[o ? 'add' : 'delete'](key); emit(); }}
      className="group/d rounded-lg border bg-card">
      <CollapsibleTrigger className="flex h-11 w-full items-center gap-2 rounded-lg px-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronRight className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]/d:rotate-90" />
        <span className="flex-1 truncate font-medium">{d.title ? `${cat} · ${d.title}` : t('digestTitle', cat, d.sourceIds.length)}</span>
        {fresh > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">+{fresh}</span>}
        <span className="text-xs text-muted-foreground tabular-nums">{t('sources', d.sourceIds.length)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="border-t px-4 pt-3 pb-4">
          <DigestText d={d} />
          {!!d.notes?.length && <p className="mt-3 text-xs text-muted-foreground">{t('notesApplied', d.notes.join('；'))}</p>}
          {/* Enter = rewrite this digest. "Save as new" keeps this one and adds another built from it. */}
          <form className="mt-4 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); send(false); }}>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder={t('refinePlaceholder')} aria-label={t('refine')} className="h-8 min-w-60 flex-1" />
            <Button type="submit" size="sm" variant="secondary" disabled={ui.busy || !note.trim()}><Sparkles />{t('refine')}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={ui.busy || !note.trim()} onClick={() => send(true)}>{t('saveAsNew')}</Button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-1 border-t pt-3">
            {fresh
              ? <Button size="sm" variant="secondary" disabled={ui.busy} onClick={() => summarize(cat, i)}><Sparkles />{t('updateSummary', fresh)}</Button>
              : <span className="px-1 text-xs text-muted-foreground">{t('upToDate')}</span>}
            <span className="flex-1" />
            {d.prev && <Button size="sm" variant="ghost" disabled={ui.busy} onClick={() => undoDigest(cat, i)}><RotateCcw />{t('undo')}</Button>}
            <Button size="sm" variant="ghost" disabled={ui.busy} onClick={() => deleteDigest(cat, i)} className="text-destructive hover:text-destructive"><Trash2 />{t('deleteDigest')}</Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The 摘要 page: every digest, grouped by topic. */
export function DigestsView() {
  const topics = Object.keys(db.summaries);
  if (!topics.length) return <Empty text={t('noBookmarks')} />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-6">
      {topics.map(cat => (
        <section key={cat} className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground"><TopicDot cat={cat} />{cat}</h2>
          <TopicDigests cat={cat} />
        </section>
      ))}
    </div>
  );
}

export const Empty = ({ text, children, className }: { text: string; children?: React.ReactNode; className?: string }) => (
  <div className={cn('flex h-full min-h-60 flex-col items-center justify-center gap-4 p-8 text-center text-muted-foreground', className)}>
    <p className="max-w-sm">{text}</p>
    {children}
  </div>
);
