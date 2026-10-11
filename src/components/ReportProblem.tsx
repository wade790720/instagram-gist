import { useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildReport, getReporting, setReporting, SUPPORT_EMAIL } from '@/lib/error-log';

// Error reporting UI for settings: the report button and the automatic sending switch (on by default).
// Same file in instagram-gist, jev-model-router and
// brand-digest-extension (change all three), so it carries its own zh/en text.
const zh = navigator.language.toLowerCase().startsWith('zh');
const text = zh ? {
  label: '回報問題', done: `已複製診斷資料，寄到 ${SUPPORT_EMAIL}`, subject: '問題回報', auto: '自動傳送錯誤報告',
} : {
  label: 'Report a problem', done: `Report copied. Send it to ${SUPPORT_EMAIL}`, subject: 'Problem report', auto: 'Send error reports automatically',
};

export function ReportProblem({ size = 'default' }: { size?: 'default' | 'sm' }) {
  const [done, setDone] = useState(false);
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => { getReporting().then((c) => setAuto(c !== 'off')); }, []);
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

