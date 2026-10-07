import { useState } from 'react';
import { Sparkles, Trash2 } from 'lucide-react';
import type { Lang } from '@/core';
import { clearAll, resortAll, saveSettings } from '@/lib/actions';
import { t, when } from '@/lib/i18n';
import { db, ui } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Local form state, so a background sync re-render never wipes a half-typed API key.
export function SettingsView() {
  const [s, setS] = useState(() => ({ ...db.settings }));
  const set = (k: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value });

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-10 px-6 py-8">
      <section className="flex flex-col gap-5">
        <h2 className="text-base font-semibold">Gemini</h2>
        <Field label={t('apiKey')} help={t('apiKeyHelp')}>
          <Input type="password" value={s.apiKey} onChange={set('apiKey')} placeholder="AIza…" autoComplete="off" />
        </Field>
        <Field label={t('model')}><Input value={s.model} onChange={set('model')} /></Field>
        <Field label={t('summaryModel')}><Input value={s.summaryModel} onChange={set('summaryModel')} /></Field>
        <Field label={t('aiLang')}>
          <Select value={s.lang} onValueChange={v => setS({ ...s, lang: v as Lang })}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="zh">繁體中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div><Button onClick={() => saveSettings(s)}>{t('save')}</Button></div>
      </section>

      <section className="flex flex-col gap-3 border-t pt-8">
        <h2 className="text-base font-semibold">{t('sectionData')}</h2>
        <p className="text-muted-foreground">{t('lastSync', when(db.lastSync.saved), when(db.lastSync.following))}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={ui.busy} onClick={resortAll}><Sparkles />{t('recategorize')}</Button>
          <Button variant="ghost" disabled={ui.busy} onClick={clearAll} className="text-destructive hover:text-destructive"><Trash2 />{t('clearData')}</Button>
        </div>
      </section>
    </div>
  );
}

const Field = ({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1.5">
    <span className="font-medium">{label}</span>
    {children}
    {help && <span className="text-xs text-muted-foreground">{help}</span>}
  </label>
);
