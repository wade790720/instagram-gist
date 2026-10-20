import { useState, type ReactNode } from 'react';
import { Check, ExternalLink, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { saveSettings, sortRest, sync } from '@/lib/actions';
import { checkKey } from '@/lib/gemini';
import { t } from '@/lib/i18n';
import { allItems, db, ui } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type State = 'done' | 'now' | 'later';

/** First run is over once there is a key and at least one sorted item. Until then the lists show Welcome. */
export const onboarded = () => !!db.settings.apiKey && allItems().some(x => x.cat);

// Same three-step look as Creator Digest: done is ticked, the current step is open, later ones are faded.
function Step({ n, title, state, children }: { n: number; title: string; state: State; children?: ReactNode }) {
  return (
    <li className={cn('flex gap-4', state === 'later' && 'opacity-50')}>
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        state === 'done' ? 'bg-primary text-primary-foreground' : 'border-2 border-primary text-primary-text')}>
        {state === 'done' ? <Check className="size-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-3 pt-1">
        <p className="font-medium">{title}</p>
        {state === 'now' && children}
      </div>
    </li>
  );
}

// Key -> sync -> first topics. Each step reads the store, so it ticks itself as sync and sorting progress.
export function Welcome() {
  const [key, setKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState('');
  const hasKey = !!db.settings.apiKey;
  const hasData = allItems().length > 0;
  const untagged = allItems().filter(x => !x.cat).length;
  const state = (done: boolean, ready: boolean): State => (done ? 'done' : ready ? 'now' : 'later');

  async function saveKey() {
    const k = key.trim();
    if (!k) return setErr(t('keyEmpty'));
    setChecking(true);
    setErr('');
    const problem = await checkKey(k);
    setChecking(false);
    if (problem) return setErr(problem);
    await saveSettings({ ...db.settings, apiKey: k });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t('welcomeTitle')}</h1>
        <p className="text-muted-foreground">{t('welcomeLead')}</p>
      </header>

      <div className="rounded-xl border bg-card p-6">
        <ol className="space-y-6">
          <Step n={1} title={t('s1Title')} state={state(hasKey, true)}>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                {t('s1Open')}{' '}
                <a className="inline-flex items-center gap-1 text-foreground underline underline-offset-4" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                  aistudio.google.com/apikey <ExternalLink className="size-3" />
                </a>
              </li>
              <li>{t('s1Create')}</li>
              <li>{t('s1Paste')}</li>
            </ol>
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" placeholder="AIza…" aria-label={t('apiKey')} value={key}
                onChange={e => setKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveKey(); }} />
              <Button onClick={saveKey} disabled={checking}>
                {checking ? <><Loader2 className="animate-spin" />{t('s1Checking')}</> : t('s1Save')}
              </Button>
            </div>
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            <p className="text-xs text-muted-foreground">{t('s1Note')}</p>
          </Step>

          <Step n={2} title={t('s2Title')} state={state(hasData, hasKey)}>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>{t('s2Login')}</li>
              <li>{t('s2Sync')}</li>
            </ol>
            <p className="text-xs text-muted-foreground">{t('s2Time')}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={sync} disabled={ui.busy}>
                {ui.busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}{t('sync')}
              </Button>
              <Button variant="outline" asChild>
                <a href="https://www.instagram.com/" target="_blank" rel="noreferrer">{t('s2Open')}<ExternalLink /></a>
              </Button>
            </div>
            {ui.err && ui.status && <p role="alert" className="text-sm text-destructive">{ui.status}</p>}
          </Step>

          <Step n={3} title={t('s3Title')} state={state(false, hasKey && hasData)}>
            {ui.busy
              ? <p className="text-sm text-muted-foreground">{t('s3Busy')}</p>
              : untagged > 0 && <Button onClick={sortRest}><Sparkles />{t('sortRest', untagged)}</Button>}
            {!ui.busy && ui.err && ui.status && <p role="alert" className="text-sm text-destructive">{ui.status}</p>}
          </Step>
        </ol>
      </div>
    </div>
  );
}
