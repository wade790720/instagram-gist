import { BadgeCheck, RefreshCw } from 'lucide-react';
import * as Core from '@/core';
import type { Post, User } from '@/core';
import { hideClubHint, sync } from '@/lib/actions';
import { t } from '@/lib/i18n';
import { allItems, db, ui } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { ClubLink } from './ClubLink';
import { Empty, TopicDigests } from './Digests';
import { Avatar, TopicPicker, useProgressive } from './ItemParts';
import { SavedGrid } from './SavedGrid';

export function ListView({ tab }: { tab: 'following' | 'saved' }) {
  const { cat, q } = ui.view;
  const items = db[tab];
  if (!items.length) return (
    <Empty text={t('empty')}>
      <Button onClick={sync} disabled={ui.busy}><RefreshCw />{t('sync')}</Button>
    </Empty>
  );
  const shown = (items as (User | Post)[]).filter(x => (!cat || x.cat === cat) && (!q || Core.matches(x, q)));
  const cats = Core.groupCounts(allItems()).map(([c]) => c);

  const club = db.clubHint && <ClubLink className="tile mx-8 mb-4 rounded-2xl px-5 py-4" onClose={hideClubHint} />;

  if (tab === 'saved') return (
    <>
      {club}
      {cat && <div className="px-8 pt-2 pb-6"><TopicDigests cat={cat} /></div>}
      <SavedGrid posts={shown as Post[]} cats={cats} />
    </>
  );
  return <>{club}{db.settings.followView === 'list' ? <UserRows users={shown as User[]} cats={cats} /> : <UserGrid users={shown as User[]} cats={cats} />}</>;
}

function UserRows({ users, cats }: { users: User[]; cats: string[] }) {
  const { n, sentinel } = useProgressive(users.length, 60);
  return (
    <>
      <ul className="tile mx-8 mb-8 overflow-hidden rounded-2xl">
        {users.slice(0, n).map(u => (
          <li key={u.id} className="group flex min-h-14 items-center gap-4 border-b border-border/60 px-5 py-2.5 transition-colors last:border-b-0 hover:bg-foreground/[0.03]">
            <Avatar name={u.username} className="size-9" />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <a href={`https://www.instagram.com/${u.username}/`} target="_blank" rel="noreferrer" className="truncate font-medium text-foreground hover:underline">@{u.username}</a>
              {u.verified && <BadgeCheck aria-label={t('verified')} className="size-4 shrink-0 fill-sky-600 text-white" />}
              {u.name && <span className="truncate text-muted-foreground">{u.name}</span>}
            </div>
            <TopicPicker x={u} cats={cats} />
          </li>
        ))}
      </ul>
      {sentinel}
    </>
  );
}

function UserGrid({ users, cats }: { users: User[]; cats: string[] }) {
  const { n, sentinel } = useProgressive(users.length, 60);
  return (
    <div className="px-8 pt-2 pb-8">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-4">
        {users.slice(0, n).map(u => (
          <li key={u.id} className="group tile relative flex flex-col items-center gap-1 rounded-2xl px-4 pt-7 pb-4 text-center transition-[translate,box-shadow] duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:shadow-[var(--tile-shadow-hover)]">
            <Avatar name={u.username} className="mb-3 size-20 text-2xl" />
            <span className="flex w-full min-w-0 items-center justify-center gap-1 font-medium text-foreground">
              <span className="truncate">@{u.username}</span>
              {u.verified && <BadgeCheck aria-label={t('verified')} className="size-4 shrink-0 fill-sky-600 text-white" />}
            </span>
            <span className="w-full truncate text-xs text-muted-foreground">{u.name || ' '}</span>
            <a href={`https://www.instagram.com/${u.username}/`} target="_blank" rel="noreferrer" aria-label={`@${u.username}`}
              className="absolute inset-0 z-10 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" />
            <div className="relative z-20 mt-3 w-full"><TopicPicker x={u} cats={cats} className="mx-auto w-fit max-w-full" /></div>
          </li>
        ))}
      </ul>
      {sentinel}
    </div>
  );
}
