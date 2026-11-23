import { useState } from 'react';
import { ChevronRight, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import * as Core from '@/core';
import type { Digest } from '@/core';
import { branchDigest, createDigest, deleteDigest, reviseDigest, undoDigest } from '@/lib/actions';
import { t } from '@/lib/i18n';
import { db, emit, ui } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { TopicDot } from './TopicDot';
import { CLASSROOM_URL } from './ClubLink';

const postUrl = (code: string) => `https://www.instagram.com/p/${code}/`;

function DigestText({ d }: { d: Digest }) {
  return (
    <div className="max-w-[68ch] whitespace-pre-wrap leading-[1.8]">
      {d.text.split(/(\[\d+\])/).map((part, k) => {
        const n = part.match(/^\[(\d+)\]$/)?.[1];
        const p = n ? db.saved.find(x => x.id === d.sourceIds[Number(n) - 1]) : undefined;
        return p
          ? <a key={k} href={postUrl(p.code)} target="_blank" rel="noreferrer" aria-label={t('openSource', part, p.user)} className="rounded px-0.5 text-xs font-medium text-primary-text tabular-nums hover:bg-primary/10">{part}</a>
          : part;
      })}
    </div>
  );
}

export function TopicDigests({ cat }: { cat: string }) {
  const list = db.summaries[cat] || [];
  if (!list.length) return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed border-foreground/15 px-5 py-4">
      <Sparkles className="size-4 text-muted-foreground" />
      <span className="flex-1 text-muted-foreground">{t('noDigestYet')}</span>
      <Button size="sm" onClick={() => createDigest(cat)} disabled={ui.busy}><Sparkles />{t('makeSummary')}</Button>
    </div>
  );
  return <div className="flex flex-col gap-3">{list.map((d, i) => <DigestCard key={d.id} cat={cat} i={i} d={d} />)}</div>;
}

function DigestCard({ cat, i, d }: { cat: string; i: number; d: Digest }) {
  const key = cat + '#' + d.id;
  const [note, setNote] = useState('');
  const fresh = Core.newSources(d, db.saved.filter(x => x.cat === cat));
  const send = (write: (cat: string, i: number, note: string) => Promise<void>) => { if (note.trim()) { write(cat, i, note); setNote(''); } };

  return (
    <Collapsible open={ui.opened.has(key)} onOpenChange={o => { ui.opened[o ? 'add' : 'delete'](key); emit(); }}
      className="group/d tile rounded-2xl">
      <CollapsibleTrigger className="flex h-14 w-full items-center gap-3 rounded-2xl px-5 text-left outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]/d:rotate-90" />
        <span className="flex-1 truncate font-medium">{d.title ? `${cat} · ${d.title}` : t('digestTitle', cat, d.sourceIds.length)}</span>
        {fresh > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary-text">+{fresh}</span>}
        <span className="text-xs text-muted-foreground tabular-nums">{t('sources', d.sourceIds.length)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="border-t px-6 pt-5 pb-5">
          <DigestText d={d} />
          {!!d.notes?.length && <p className="mt-3 text-xs text-muted-foreground">{t('notesApplied', d.notes.join('；'))}</p>}
          <form className="mt-4 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); send(reviseDigest); }}>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder={t('refinePlaceholder')} aria-label={t('refine')} className="min-w-60 flex-1" />
            <Button type="submit" variant="secondary" disabled={ui.busy || !note.trim()}><Sparkles />{t('refine')}</Button>
            <Button type="button" variant="ghost" disabled={ui.busy || !note.trim()} onClick={() => send(branchDigest)}>{t('saveAsNew')}</Button>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-1 border-t pt-4">
            {fresh
              ? <Button size="sm" variant="secondary" disabled={ui.busy} onClick={() => reviseDigest(cat, i)}><Sparkles />{t('updateSummary', fresh)}</Button>
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

export function DigestsView() {
  const topics = Object.keys(db.summaries);
  if (!topics.length) return <Empty text={t('noBookmarks')} />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-8 pt-2 pb-10">
      {topics.map(cat => (
        <section key={cat} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground"><TopicDot cat={cat} />{cat}</h2>
          <TopicDigests cat={cat} />
        </section>
      ))}
      <a href={CLASSROOM_URL} target="_blank" rel="noreferrer" className="px-1 text-sm text-muted-foreground underline">{t('nextStep')}</a>
    </div>
  );
}

export const Empty = ({ text, children, className }: { text: string; children?: React.ReactNode; className?: string }) => (
  <div className={cn('flex h-full min-h-60 flex-col items-center justify-center gap-4 p-8 text-center text-muted-foreground', className)}>
    <p className="max-w-sm">{text}</p>
    {children}
  </div>
);
