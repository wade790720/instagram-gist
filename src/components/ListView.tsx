import { useState } from 'react';
import { ArrowsRotateRight, CircleCheckFill, HeartCrack, HeartFill } from '@gravity-ui/icons';
import * as Core from '@/core';
import type { Post, User } from '@/core';
import { hideClubHint, sync } from '@/lib/actions';
import { t, when } from '@/lib/i18n';
import { allItems, db, setView, ui } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ClubLink } from './ClubLink';
import { Empty, TopicDigests } from './Digests';
import { Avatar, TopicPicker, useProgressive } from './ItemParts';
import { SavedGrid } from './SavedGrid';

export function ListView({ tab }: { tab: 'following' | 'saved' }) {
  const { cat, q } = ui.view;
  const [onlyNoBack, setOnlyNoBack] = useState(false);
  const items = db[tab];
  if (!items.length) return (
    <Empty text={t('empty')}>
      <Button onClick={sync} aria-disabled={ui.busy}><ArrowsRotateRight />{t('sync')}</Button>
    </Empty>
  );
  const shown = (items as (User | Post)[]).filter(x => (!cat || x.cat === cat) && (!q || Core.matches(x, q)));
  const cats = Core.groupCounts(allItems()).map(([c]) => c);
  if (!shown.length && q) return (
    <Empty text={t('noMatch', q)}>
      <Button variant="outline" onClick={() => setView({ q: '' })}>{t('clearSearch')}</Button>
    </Empty>
  );

  const club = db.clubHint && <ClubLink className="tile mx-8 mt-2 rounded-xl px-4 py-3 max-md:mx-4" onClose={hideClubHint} />;

  if (tab === 'saved') return (
    <>
      {club}
      {cat && <div className="px-8 pt-2 max-md:px-4"><TopicDigests cat={cat} /></div>}
      <SavedGrid posts={shown as Post[]} cats={cats} />
    </>
  );
  const friends = tab === 'following' && cat === Core.friendsLabel(db.settings.lang);
  const noBack = friends ? (shown as User[]).filter(u => !u.mutual) : [];
  return (
    <>
      {club}
      {friends && (
        // shortcut: sync reads at most 1000 followers, so past that some mutual friends show as not following back.
        <div className="mx-8 mt-2 flex flex-wrap items-center gap-3 text-sm text-text-secondary max-md:mx-4">
          <span className="min-w-0 flex-1">{t('friendsNoBack', shown.length, noBack.length, when(db.lastSync.following))}</span>
          {noBack.length > 0 && (
            // A plain button: the shared Button styles would override the caution tint.
            <button type="button" aria-pressed={onlyNoBack} onClick={() => setOnlyNoBack(!onlyNoBack)}
              className={cn('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[calc(var(--radius)-2px)] border px-3.5 text-sm font-medium transition-[background-color,color,scale] duration-[120ms] ease-[var(--ease-ui)] active:scale-[.98]',
                onlyNoBack
                  ? 'border-transparent bg-[var(--tone-caution-text)] text-card'
                  : 'border-[color-mix(in_oklab,var(--tone-caution)_45%,transparent)] bg-[color-mix(in_oklab,var(--tone-caution)_14%,var(--card))] text-[var(--tone-caution-text)] hover:bg-[color-mix(in_oklab,var(--tone-caution)_24%,var(--card))]')}>
              {onlyNoBack ? <HeartFill className="size-4" aria-hidden /> : <HeartCrack className="size-4" aria-hidden />}{onlyNoBack ? t('showAllFriends') : t('onlyNoBack', noBack.length)}
            </button>
          )}
        </div>
      )}
      <UserGrid users={onlyNoBack ? noBack : (shown as User[])} cats={cats} compact={db.settings.followView === 'compact'} friendsLabel={Core.friendsLabel(db.settings.lang)} />
    </>
  );
}

// Same card in both sizes. Compact drops the display name, which search and the tooltip still reach.
function UserGrid({ users, cats, compact, friendsLabel }: { users: User[]; cats: string[]; compact: boolean; friendsLabel: string }) {
  const { n, sentinel } = useProgressive(users.length, compact ? 120 : 60);
  return (
    <div className="px-8 pt-2 pb-6 max-md:px-4">
      <ul className={cn('grid', compact ? 'grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-3' : 'grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-4')}>
        {users.slice(0, n).map(u => (
          <li key={u.id} className={cn('group tile relative flex flex-col items-center text-center transition-[box-shadow,scale] duration-[120ms] ease-[var(--ease-ui)] hover:shadow-[var(--shadow-border-hover)] active:scale-[.98]',
            compact ? 'gap-0.5 rounded-lg px-2 pt-3 pb-2' : 'gap-1 rounded-xl px-4 pt-6 pb-3')}>
            <Avatar name={u.username} className={compact ? 'mb-1.5 size-11 text-base' : 'mb-3 size-16 text-xl'} />
            <span className={cn('flex w-full min-w-0 items-center justify-center gap-1 font-medium text-foreground', compact && 'text-xs')}>
              <span className="truncate">@{u.username}</span>
              {u.verified && <CircleCheckFill aria-label={t('verified')} className={cn('shrink-0 text-sky-600', compact ? 'size-3.5' : 'size-4')} />}
            </span>
            {!compact && <span className="w-full truncate text-xs text-muted-foreground">{u.name || ' '}</span>}
            {u.cat === friendsLabel && !u.mutual && <span className="rounded-full bg-row-hover px-2 text-[11px] leading-5 text-muted-foreground">{t('notFollowingBack')}</span>}
            <a href={`https://www.instagram.com/${u.username}/`} target="_blank" rel="noreferrer" aria-label={`@${u.username}`} title={u.name ? `@${u.username} · ${u.name}` : `@${u.username}`}
              className={cn('absolute inset-0 z-10', compact ? 'rounded-lg' : 'rounded-xl')} />
            <div className={cn('relative z-20 w-full', compact ? 'mt-1.5' : 'mt-3')}><TopicPicker x={u} cats={cats} className="mx-auto" /></div>
          </li>
        ))}
      </ul>
      {sentinel}
    </div>
  );
}
