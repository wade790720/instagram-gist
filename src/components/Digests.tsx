import { useState } from 'react';
import { ArrowRotateLeft, ChevronRight, Sparkles, TrashBin } from '@gravity-ui/icons';
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

// [n] source numbers become small chips that open the post; a number with no post stays plain text.
function WithSources({ text, d }: { text: string; d: Digest }) {
  return text.split(/(\[\d+\])/).map((part, k) => {
    const n = part.match(/^\[(\d+)\]$/)?.[1];
    const p = n ? db.saved.find(x => x.id === d.sourceIds[Number(n) - 1]) : undefined;
    return p
      ? <a key={k} href={postUrl(p.code)} target="_blank" rel="noreferrer" aria-label={t('openSource', part, p.user)}
          className="mx-px inline-flex h-[1.45em] min-w-[1.45em] items-center justify-center rounded-md bg-primary/10 px-1 align-[0.1em] text-[0.7em] leading-none font-medium text-primary-text tabular-nums transition-[background-color,scale] duration-150 hover:bg-primary/20 active:scale-90">{n}</a>
      : part;
  });
}

function DigestText({ d }: { d: Digest }) {
  return (
    <div className="flex max-w-[42em] flex-col text-base leading-[1.85] text-foreground/90">
      {Core.digestLines(d.text).map((l, k) => (
        <p key={k} className={cn('relative', l.bullet && 'pl-5', l.depth ? 'mt-1 ml-5 text-sm leading-[1.8] text-text-secondary' : k > 0 && 'mt-3.5')}>
          {l.bullet && <span aria-hidden className={cn('absolute left-1 top-[0.72em] size-1.5 rounded-full', l.depth ? 'border-[1.5px] border-current opacity-60' : 'bg-primary-text')} />}
          {l.lead && <strong className="font-semibold text-foreground">{l.lead}{db.settings.lang === 'zh' ? '：' : ': '}</strong>}
          <WithSources text={l.body} d={d} />
        </p>
      ))}
    </div>
  );
}

export function TopicDigests({ cat }: { cat: string }) {
  const list = db.summaries[cat] || [];
  if (!list.length) return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-3">
      <Sparkles className="size-4 text-muted-foreground" />
      <span className="flex-1 text-muted-foreground">{t('noDigestYet')}</span>
      <Button size="sm" onClick={() => createDigest(cat)} aria-disabled={ui.busy}><Sparkles />{t('makeSummary')}</Button>
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
      className="group/d tile rounded-xl">
      <CollapsibleTrigger className="flex min-h-13 w-full items-center gap-2.5 rounded-xl px-4 text-left transition-colors duration-[120ms] ease-[var(--ease-ui)] hover:bg-row-hover group-data-[state=open]/d:rounded-b-none">
        <ChevronRight className="size-4 text-muted-foreground group-data-[state=open]/d:rotate-90" />
        <span className="min-w-0 flex-1 py-3 font-medium">{d.title ? `${cat} · ${d.title}` : t('digestTitle', cat, d.sourceIds.length)}</span>
        {fresh > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary-text tabular-nums">+{fresh}</span>}
        <span className="text-xs text-muted-foreground tabular-nums">{t('sources', d.sourceIds.length)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t px-6 pt-5 pb-5">
          <DigestText d={d} />
          {!!d.notes?.length && <p className="mt-5 text-xs text-muted-foreground">{t('notesApplied', d.notes.join('；'))}</p>}
          <form className="mt-6 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); send(reviseDigest); }}>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder={t('refinePlaceholder')} aria-label={t('refine')} className="min-w-0 flex-1 basis-60" />
            <Button type="submit" variant="secondary" disabled={ui.busy || !note.trim()}><Sparkles />{t('refine')}</Button>
            <Button type="button" variant="ghost" disabled={ui.busy || !note.trim()} onClick={() => send(branchDigest)}>{t('saveAsNew')}</Button>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-1 border-t pt-4">
            {fresh
              ? <Button size="sm" variant="secondary" disabled={ui.busy} onClick={() => reviseDigest(cat, i)}><Sparkles />{t('updateSummary', fresh)}</Button>
              : <span className="px-1 text-xs text-muted-foreground">{t('upToDate')}</span>}
            <span className="flex-1" />
            {d.prev && <Button size="sm" variant="ghost" disabled={ui.busy} onClick={() => undoDigest(cat, i)}><ArrowRotateLeft />{t('undo')}</Button>}
            <Button size="sm" variant="ghost" disabled={ui.busy} onClick={() => deleteDigest(cat, i)} className="text-destructive hover:text-destructive"><TrashBin />{t('deleteDigest')}</Button>
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
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 py-8 max-md:px-4">
      {topics.map(cat => (
        <section key={cat} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 px-2 text-base font-semibold tracking-[-0.01em] text-foreground"><TopicDot cat={cat} />{cat}</h2>
          <TopicDigests cat={cat} />
        </section>
      ))}
      <a href={CLASSROOM_URL} target="_blank" rel="noreferrer" className="px-2 text-sm text-muted-foreground underline decoration-from-font underline-offset-4 transition-colors hover:text-foreground">{t('nextStep')}</a>
    </div>
  );
}

export const Empty = ({ text, children, className }: { text: string; children?: React.ReactNode; className?: string }) => (
  <div className={cn('flex h-full min-h-60 flex-col items-center justify-center gap-4 p-8 text-center text-muted-foreground', className)}>
    <p className="max-w-sm">{text}</p>
    {children}
  </div>
);
