import { useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ASK_EVENT, buildReport, getReporting, needsAsk, setReporting, SUPPORT_EMAIL } from '@/lib/error-log';

// Error reporting UI: the settings controls (report button + automatic sending switch) and the
// one-time question shown after the first error. Same file in instagram-gist, jev-model-router and
// brand-digest-extension (change all three), so it carries its own zh/en text.
const zh = navigator.language.toLowerCase().startsWith('zh');
const text = zh ? {
  label: '回報問題', done: `已複製診斷資料，寄到 ${SUPPORT_EMAIL}`, subject: '問題回報', auto: '自動傳送錯誤報告',
  askTitle: '剛剛發生了一個錯誤', askBody: '要自動把錯誤報告傳給開發者嗎？只包含錯誤類型和工具版本，不含你的資料。之後可以在設定裡更改。',
  yes: '傳送', no: '不要',
} : {
  label: 'Report a problem', done: `Report copied. Send it to ${SUPPORT_EMAIL}`, subject: 'Problem report', auto: 'Send error reports automatically',
  askTitle: 'Something went wrong', askBody: 'Send error reports to the developer automatically? They contain only the error type and tool version, none of your data. You can change this in settings.',
  yes: 'Send', no: 'Don’t send',
};

export function ReportProblem({ size = 'default' }: { size?: 'default' | 'sm' }) {
  const [done, setDone] = useState(false);
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => { getReporting().then((c) => setAuto(c === 'on')); }, []);
  const report = async () => {
    const body = await buildReport();
    await navigator.clipboard.writeText(body).catch(() => {});
    // ponytail: mailto bodies over ~2000 characters get cut by some mail apps; the clipboard has the full report.
    const mail = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${document.title} ${text.subject}`)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
    Object.assign(document.createElement('a'), { href: mail }).click();
    setDone(true);
    setTimeout(() => setDone(false), 8000);
  };
  return (
    <>
      <Button type="button" variant="outline" size={size} onClick={report} aria-live="polite">
        <LifeBuoy />{done ? text.done : text.label}
      </Button>
      {auto !== null && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="size-4 accent-primary" checked={auto}
            onChange={(e) => { setAuto(e.target.checked); void setReporting(e.target.checked); }} />
          {text.auto}
        </label>
      )}
    </>
  );
}

/** Mount once per page, next to the app: asks after the first error, once. */
export function ErrorReportingPrompt() {
  const [open, setOpen] = useState(needsAsk);
  useEffect(() => {
    const show = () => setOpen(true);
    addEventListener(ASK_EVENT, show);
    return () => removeEventListener(ASK_EVENT, show);
  }, []);
  if (!open) return null;
  const answer = (on: boolean) => { setOpen(false); void setReporting(on); };
  return (
    <div role="dialog" aria-labelledby="error-ask-title" aria-describedby="error-ask-body"
      className="fixed right-4 bottom-4 left-4 z-50 space-y-3 sm:right-auto sm:w-80 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg">
      <p id="error-ask-title" className="font-semibold">{text.askTitle}</p>
      <p id="error-ask-body" className="text-sm text-muted-foreground">{text.askBody}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => answer(false)}>{text.no}</Button>
        <Button type="button" size="sm" onClick={() => answer(true)}>{text.yes}</Button>
      </div>
    </div>
  );
}
