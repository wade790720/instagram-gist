import { RefreshCw } from 'lucide-react';
import * as Core from '@/core';
import type { Post, User } from '@/core';
import { sync } from '@/lib/actions';
import { t } from '@/lib/i18n';
import { allItems, db, ui } from '@/lib/store';
import { Button } from '@/components/ui/button';
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

  if (tab === 'saved') return (
    <>
      {cat && <div className="border-b px-6 py-4"><TopicDigests cat={cat} /></div>}
      <SavedGrid posts={shown as Post[]} cats={cats} />
    </>
  );
  return <UserRows users={shown as User[]} cats={cats} />;
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
