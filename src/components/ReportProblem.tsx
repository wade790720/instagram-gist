import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildReport, SUPPORT_EMAIL } from '@/lib/error-log';

// "Report a problem": copies the diagnostic report and opens an email to support with it.
// Same file in ig-sorter, jev-model-router and brand-digest-extension (change all three).
const zh = navigator.language.toLowerCase().startsWith('zh');
const text = zh
  ? { label: '回報問題', done: `已複製診斷資料，寄到 ${SUPPORT_EMAIL}`, subject: '問題回報' }
  : { label: 'Report a problem', done: `Report copied. Send it to ${SUPPORT_EMAIL}`, subject: 'Problem report' };

export function ReportProblem({ size = 'default' }: { size?: 'default' | 'sm' }) {
  const [done, setDone] = useState(false);
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
    <Button type="button" variant="outline" size={size} onClick={report} aria-live="polite">
      <LifeBuoy />{done ? text.done : text.label}
    </Button>
  );
}
