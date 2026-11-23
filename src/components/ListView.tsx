import { ArrowsRotateRight, CircleCheckFill } from '@gravity-ui/icons';
import * as Core from '@/core';
import type { Post, User } from '@/core';
import { hideClubHint, sync } from '@/lib/actions';
import { t } from '@/lib/i18n';
import { allItems, db, setView, ui } from '@/lib/store';
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
  return <>{club}{db.settings.followView === 'list' ? <UserRows users={shown as User[]} cats={cats} /> : <UserGrid users={shown as User[]} cats={cats} />}</>;
}

function UserRows({ users, cats }: { users: User[]; cats: string[] }) {
  const { n, sentinel } = useProgressive(users.length, 60);
  return (
    <>
      <ul className="tile mx-8 mt-2 mb-6 rounded-xl p-1 max-md:mx-4">
        {users.slice(0, n).map(u => (
          <li key={u.id} className="group relative flex min-h-14 items-center gap-3 rounded-md px-3 py-2 transition-colors duration-[120ms] ease-[var(--ease-ui)] hover:bg-row-hover">
            <Avatar name={u.username} className="size-9" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-1">
                <a href={`https://www.instagram.com/${u.username}/`} target="_blank" rel="noreferrer" className="truncate font-medium text-foreground after:absolute after:inset-0 after:rounded-md">@{u.username}</a>
                {u.verified && <CircleCheckFill aria-label={t('verified')} className="size-4 shrink-0 text-sky-600" />}
              </span>
              {u.name && <span className="truncate text-xs text-muted-foreground">{u.name}</span>}
            </div>
            <div className="relative z-10"><TopicPicker x={u} cats={cats} /></div>
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
    <div className="px-8 pt-2 pb-6 max-md:px-4">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-4">
        {users.slice(0, n).map(u => (
          <li key={u.id} className="group tile relative flex flex-col items-center gap-1 rounded-xl px-4 pt-6 pb-3 text-center transition-[box-shadow,scale] duration-[120ms] ease-[var(--ease-ui)] hover:shadow-[var(--shadow-border-hover)] active:scale-[.98]">
            <Avatar name={u.username} className="mb-3 size-16 text-xl" />
            <span className="flex w-full min-w-0 items-center justify-center gap-1 font-medium text-foreground">
              <span className="truncate">@{u.username}</span>
              {u.verified && <CircleCheckFill aria-label={t('verified')} className="size-4 shrink-0 text-sky-600" />}
            </span>
            <span className="w-full truncate text-xs text-muted-foreground">{u.name || ' '}</span>
            <a href={`https://www.instagram.com/${u.username}/`} target="_blank" rel="noreferrer" aria-label={`@${u.username}`}
              className="absolute inset-0 z-10 rounded-xl" />
            <div className="relative z-20 mt-3 w-full"><TopicPicker x={u} cats={cats} className="mx-auto" /></div>
          </li>
        ))}
      </ul>
      {sentinel}
    </div>
  );
}
