import { useEffect, useState, type ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { check, COMMUNITY_URL, type Status } from '@/lib/membership';

// Shows the tool only to Skool community members. Same file in ig-sorter and
// brand-digest-extension (change both), so it carries its own zh/en text instead of each app's i18n.
const zh = navigator.language.toLowerCase().startsWith('zh');
const text = zh ? {
  checking: '確認會員身分中…',
  'signed-out': ['請先登入 Skool', '這個工具只開放給百寶袋俱樂部的會員。請在 Skool 登入，再回到這個分頁。', '登入 Skool'],
  'not-member': ['需要加入百寶袋俱樂部', '目前登入的 Skool 帳號不是會員。加入後回到這個分頁就能使用。', '加入百寶袋俱樂部'],
  unknown: ['暫時無法確認會員身分', '連不上 Skool，或 Skool 的頁面改版了。請稍後再試。', '打開 Skool'],
  retry: '重新檢查',
} : {
  checking: 'Checking your membership…',
  'signed-out': ['Sign in to Skool first', 'This tool is for Wonder Pocket Club members. Sign in on Skool, then come back to this tab.', 'Sign in to Skool'],
  'not-member': ['Join Wonder Pocket Club', 'The Skool account you are signed in with is not a member. Join, then come back to this tab.', 'Join Wonder Pocket Club'],
  unknown: ['Can’t confirm your membership', 'Skool is unreachable, or its page changed. Try again later.', 'Open Skool'],
  retry: 'Check again',
};

export function MembershipGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const run = (force = false) => { setStatus(null); check(force).then(setStatus); };
  useEffect(() => { check().then(setStatus); }, []);
  // Coming back from the Skool tab after signing in or joining: check again right away.
  useEffect(() => {
    if (!status || status === 'member') return;
    const onShow = () => document.visibilityState === 'visible' && run(true);
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [status]);

  if (status === 'member') return children;
  const [title, body, action] = status ? text[status] : [text.checking];
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6" role={status ? 'alert' : 'status'}>
        <span className="grid size-8 place-items-center rounded-md brand-mark" aria-hidden="true"><LockKeyhole className="size-4" /></span>
        <h1 className="text-base font-semibold">{title}</h1>
        {body && <p className="text-sm text-muted-foreground">{body}</p>}
        {status && (
          <div className="flex flex-wrap gap-2">
            <Button asChild><a href={COMMUNITY_URL} target="_blank" rel="noreferrer">{action}</a></Button>
            <Button variant="outline" onClick={() => run(true)}>{text.retry}</Button>
          </div>
        )}
      </div>
    </main>
  );
}
