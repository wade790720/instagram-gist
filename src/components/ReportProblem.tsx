import { useEffect, useState } from 'react';
import { LifeRing } from '@gravity-ui/icons';
import { Button } from '@/components/ui/button';
import { getReporting, sendReport, setReporting } from '@/lib/error-log';

// Error reporting UI for settings: the report button and the automatic sending switch (on by default).
// Same file in instagram-gist, jev-model-router and
// brand-digest-extension (change all three), so it carries its own zh/en text.
// instagram-gist is ahead: the button sends the log instead of emailing it. Bring the other two up to it.
// lang: the app's own language setting, if it has one; without it, the browser language decides.
const TEXT = {
  zh: { label: '回報問題', sent: '已送出，謝謝回報', failed: '沒送出，請檢查網路後再試', auto: '自動傳送錯誤報告' },
  en: { label: 'Report a problem', sent: 'Sent. Thank you', failed: 'Not sent. Check the connection and try again', auto: 'Send error reports automatically' },
};
const browserLang = () => (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');

export function ReportProblem({ size = 'default', lang }: { size?: 'default' | 'sm'; lang?: 'zh' | 'en' }) {
  const text = TEXT[lang ?? browserLang()];
  const [result, setResult] = useState<'sent' | 'failed' | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => { getReporting().then((c) => setAuto(c !== 'off')); }, []);
  const report = async () => {
    setResult((await sendReport()) ? 'sent' : 'failed');
    setTimeout(() => setResult(null), 8000);
  };
  return (
    <>
      <Button type="button" variant="outline" size={size} onClick={report} aria-live="polite">
        <LifeRing />{result ? text[result] : text.label}
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

