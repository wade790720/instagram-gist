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

// Keyed by tab + topic + search in App, so paging (useProgressive) starts over on every change.
export function ListView({ tab }: { tab: 'following' | 'saved' }) {
  const { cat, q } = ui.view;
  const items = db[tab];
  if (!items.length) return (
    <Empty text={t('empty')}>
      <Button onClick={sync} disabled={ui.busy}><RefreshCw />{t('sync')}</Button>
    </Empty>
  );
  const shown = (items as (User | Post)[]).filter(x => (!cat || x.cat === cat) && (!q || Core.matches(x, q)));
  // Topics from both lists, so an account can move into a topic that so far only has posts.
  const cats = Core.groupCounts(allItems()).map(([c]) => c);

  // Shown once, above the first sorted results; closing it hides it for good.
  const club = db.clubHint && <ClubLink className="border-b px-6 py-3" onClose={hideClubHint} />;

  if (tab === 'saved') return (
    <>
      {club}
      {cat && <div className="border-b px-6 py-4"><TopicDigests cat={cat} /></div>}
      <SavedGrid posts={shown as Post[]} cats={cats} />
    </>
  );
  return <>{club}{db.settings.followView === 'list' ? <UserRows users={shown as User[]} cats={cats} /> : <UserGrid users={shown as User[]} cats={cats} />}</>;
}

function UserRows({ users, cats }: { users: User[]; cats: string[] }) {
  const { n, sentinel } = useProgressive(users.length, 60);
  return (
    <>
      <ul>
        {users.slice(0, n).map(u => (
          <li key={u.id} className="group flex items-center gap-3 border-b border-border/60 px-6 py-2.5 transition-colors hover:bg-accent/40">
            <Avatar name={u.username} />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <a href={`https://www.instagram.com/${u.username}/`} target="_blank" rel="noreferrer" className="truncate font-medium text-foreground hover:underline">@{u.username}</a>
              {u.verified && <BadgeCheck aria-label={t('verified')} className="size-4 shrink-0 fill-sky-500 text-white" />}
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

// Cards, not rows: a face or logo is found faster than a handle. All cards are the same height
// (no bio yet), so a plain grid, not the saved tab's masonry. The avatar is IG's 150 px image,
// so 64 px is about as large as it stays sharp.
function UserGrid({ users, cats }: { users: User[]; cats: string[] }) {
  const { n, sentinel } = useProgressive(users.length, 60);
  return (
    <div className="px-6 py-5">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
        {users.slice(0, n).map(u => (
          <li key={u.id} className="group relative flex flex-col items-center gap-1 rounded-lg border bg-card px-3 pt-5 pb-3 text-center transition-colors hover:bg-accent/40">
            <Avatar name={u.username} className="mb-2 size-16 text-xl" />
            <span className="flex w-full min-w-0 items-center justify-center gap-1 font-medium text-foreground">
              <span className="truncate">@{u.username}</span>
              {u.verified && <BadgeCheck aria-label={t('verified')} className="size-4 shrink-0 fill-sky-500 text-white" />}
            </span>
            <span className="w-full truncate text-xs text-muted-foreground">{u.name || ' '}</span>
            {/* The whole card opens the profile; the topic picker sits above the link. */}
            <a href={`https://www.instagram.com/${u.username}/`} target="_blank" rel="noreferrer" aria-label={`@${u.username}`}
              className="absolute inset-0 z-10 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" />
            <div className="relative z-20 mt-2 w-full"><TopicPicker x={u} cats={cats} className="mx-auto w-fit max-w-full" /></div>
          </li>
        ))}
      </ul>
      {sentinel}
    </div>
  );
}
