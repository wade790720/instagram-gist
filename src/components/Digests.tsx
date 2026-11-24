import { useState } from 'react';
import { ArrowRotateLeft, Bulb, ChevronRight, Compass, ListCheck, Sparkles, TrashBin, TriangleExclamation } from '@gravity-ui/icons';
import * as Core from '@/core';
import type { Digest } from '@/core';
import { branchDigest, createDigest, deleteDigest, editDigest, reviseDigest, undoDigest } from '@/lib/actions';
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

const TONE_ICON: Record<Core.DigestTone, typeof Bulb> = { key: Bulb, method: Compass, action: ListCheck, caution: TriangleExclamation };

function DigestText({ d }: { d: Digest }) {
  return (
    <div className="flex max-w-[42em] flex-col text-base leading-[1.85] text-foreground/90">
      {Core.digestLines(d.text).map((l, k) => {
        const Icon = l.tone && !l.depth ? TONE_ICON[l.tone] : null;
        return (
          <p key={k} data-tone={l.tone ?? 'method'} className={cn('digest-line relative', l.bullet && !Icon && 'pl-5', l.depth ? 'mt-1 ml-5 text-sm leading-[1.8] text-text-secondary' : k > 0 && 'mt-4')}>
            {l.bullet && !Icon && <span aria-hidden className={cn('absolute left-1 top-[0.72em] size-1.5 rounded-full', l.depth ? 'border-[1.5px] border-[var(--tone)]' : 'bg-[var(--tone)]')} />}
            {Icon && <span className="digest-tag"><Icon aria-hidden className="size-3" />{Core.toneLabel(l.tone!, db.settings.lang)}</span>}
            {l.lead && <strong className="font-semibold text-[var(--tone-text)]">{l.lead}{db.settings.lang === 'zh' ? '：' : ': '}</strong>}
            <WithSources text={l.body} d={d} />
          </p>
        );
      })}
    </div>
  );
}

function Point({ p, d }: { p: Core.NotePoint; d: Digest }) {
  const single = p.sources.length === 1 && (p.kind === 'case' || p.kind === 'data');
  return (
    <>
      <WithSources text={Core.citedText(p)} d={d} />
      {p.sources.length >= 3 && <span className="note-count">{t('noteMany', p.sources.length)}</span>}
      {single && <span className="note-count">{t('noteSingle')}</span>}
    </>
  );
}

function NoteBlock({ tone, Icon, title, children }: { tone: Core.DigestTone; Icon: typeof Bulb; title: string; children: React.ReactNode }) {
  return (
    <section data-tone={tone} className="digest-line note-block">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--tone-text)]"><Icon aria-hidden className="size-3.5" />{title}</h4>
      {children}
    </section>
  );
}

const SKIP_LABEL: Record<Core.SkipWhy, string> = { teaser: 'skipTeaser', promo: 'skipPromo', offtopic: 'skipOfftopic', risky: 'skipRisky' };

function EditedNoteView({ d, note }: { d: Digest; note: Core.EditedNote }) {
  return (
    <article className="flex max-w-[42em] flex-col gap-7 text-base leading-[1.8] text-foreground/90">
      <header>
        <p className="mb-1 text-xs font-medium text-[var(--tone-key-text)]">{t('noteThesis')}</p>
        <p className="text-lg leading-[1.55] font-semibold text-foreground">{note.thesis}</p>
      </header>
      {note.chapters.map((c, k) => (
        <section key={k}>
          <h3 className="flex gap-2.5 font-semibold text-foreground"><span aria-hidden className="text-[var(--tone-method-text)] tabular-nums">{k + 1}</span>{c.claim}</h3>
          <ul className="mt-2 flex flex-col gap-1.5 ps-[1.15rem]">
            {c.points.map((p, j) => <li key={j} className="note-point"><Point p={p} d={d} />{p.steps && <ol className="mt-1 mb-1 flex list-decimal flex-col gap-0.5 ps-5 text-sm text-text-secondary">{p.steps.map((s, m) => <li key={m}>{s}</li>)}</ol>}</li>)}
          </ul>
        </section>
      ))}
      {note.tensions.length > 0 && (
        <NoteBlock tone="caution" Icon={TriangleExclamation} title={t('noteTensions')}>
          <div className="flex flex-col gap-3 text-sm">
            {note.tensions.map((x, k) => <div key={k} className="grid gap-1 sm:grid-cols-2 sm:gap-4"><p><Point p={x.a} d={d} /></p><p><Point p={x.b} d={d} /></p></div>)}
          </div>
        </NoteBlock>
      )}
      {note.actions.length > 0 && (
        <NoteBlock tone="action" Icon={ListCheck} title={t('noteActions')}>
          <ul className="flex flex-col gap-1 ps-[1.15rem] text-sm">{note.actions.map((a, k) => <li key={k} className="note-point">{a}</li>)}</ul>
        </NoteBlock>
      )}
      {note.resources.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">{t('noteResources')}</h4>
          <ul className="flex flex-col gap-1 text-sm text-text-secondary">
            {note.resources.map((r, k) => {
              const past = Core.isPast(r.text, new Date().toISOString().slice(0, 10));
              return <li key={k} className={cn(past && 'text-muted-foreground')}><WithSources text={Core.citedText(r)} d={d} />{past && <span className="note-count">{t('noteExpired')}</span>}</li>;
            })}
          </ul>
        </section>
      )}
      {!!note.rest?.length && (
        <details className="text-sm text-text-secondary">
          <summary className="text-xs font-medium text-muted-foreground hover:text-foreground">{t('noteRest', note.rest.length)}</summary>
          <ul className="mt-2 flex flex-col gap-1 ps-[1.15rem]">{note.rest.map((p, k) => <li key={k} className="note-point"><Point p={p} d={d} /></li>)}</ul>
        </details>
      )}
      {Object.values(note.skipped ?? {}).some(ns => ns.length) && (
        <details className="text-sm text-text-secondary">
          <summary className="text-xs font-medium text-muted-foreground hover:text-foreground">{t('noteSkipped', Object.values(note.skipped!).flat().length)}</summary>
          <dl className="mt-2 flex flex-col gap-2">
            {(['teaser', 'promo', 'offtopic', 'risky'] as const).map(why => !!note.skipped![why]?.length && (
              <div key={why}>
                <dt className="text-xs text-muted-foreground">{t(SKIP_LABEL[why])}</dt>
                <dd><WithSources text={note.skipped![why]!.map(n => `[${n}]`).join('')} d={d} /></dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {note.thin > 0 && <p className="text-xs text-muted-foreground">{t('noteThin', note.thin)}</p>}
    </article>
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
          {d.edited ? <EditedNoteView d={d} note={d.edited} /> : <DigestText d={d} />}
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
            {!d.edited && <Button size="sm" variant="secondary" disabled={ui.busy} onClick={() => editDigest(cat, i)}><Sparkles />{t('makeNote')}</Button>}
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
