import { useState } from 'react';
import { Combine, ExternalLink, Sparkles, Trash2 } from 'lucide-react';
import type { Lang } from '@/core';
import { clearAll, resortAll, saveSettings, tidyTopics } from '@/lib/actions';
import { t, when } from '@/lib/i18n';
import { db, ui } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReportProblem } from '@/components/ReportProblem';
import { CLUB_URL } from '@/components/ClubLink';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const FORM_KEYS = ['apiKey', 'model', 'summaryModel', 'lang'] as const;

export function SettingsView() {
  const [s, setS] = useState(() => ({ ...db.settings }));
  const set = (k: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value });
  const dirty = FORM_KEYS.some(k => s[k] !== db.settings[k]);
  const save = () => { const done = saveSettings(s); setS({ ...db.settings }); return done; };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Panel title={t('sectionAi')} help={t('sectionAiHelp')} footer={<>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">{dirty ? t('unsaved') : t('allSaved')}</span>
        <Button variant="outline" disabled={!dirty} onClick={() => setS({ ...db.settings })}>{t('cancel')}</Button>
        <Button disabled={!dirty} onClick={save}>{t('save')}</Button>
      </>}>
        <Row field title={t('apiKey')} help={t('apiKeyHelp')}>
          <Input type="password" value={s.apiKey} onChange={set('apiKey')} placeholder="AIza…" autoComplete="off" />
        </Row>
        <Row field title={t('model')} help={t('modelHelp')}><Input value={s.model} onChange={set('model')} /></Row>
        <Row field title={t('summaryModel')} help={t('summaryModelHelp')}><Input value={s.summaryModel} onChange={set('summaryModel')} /></Row>
        <Row field title={t('aiLang')} help={t('aiLangHelp')}>
          <Select value={s.lang} onValueChange={v => setS({ ...s, lang: v as Lang })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="zh">繁體中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Panel>

      <Panel title={t('sectionData')} help={t('lastSync', when(db.lastSync.saved), when(db.lastSync.following))}>
        <Row title={t('tidy')} help={t('tidyHelp')}>
          <Button variant="outline" disabled={ui.busy || !db.settings.apiKey} onClick={tidyTopics}><Combine />{t('tidy')}</Button>
        </Row>
        <Row title={t('recategorize')} help={t('recategorizeHelp')}>
          <Button variant="outline" disabled={ui.busy} onClick={resortAll}><Sparkles />{t('recategorize')}</Button>
        </Row>
      </Panel>

      <Panel title={t('sectionSupport')} help={t('sectionSupportHelp')}>
        <Row title={t('errorReport')} help={t('errorReportHelp')}>
          <div className="flex flex-row-reverse flex-wrap items-center gap-x-4 gap-y-2"><ReportProblem /></div>
        </Row>
        <Row title={t('clubTitle')} help={t('clubLine')}>
          <Button variant="outline" asChild><a href={CLUB_URL} target="_blank" rel="noreferrer">{t('clubButton')}<ExternalLink /></a></Button>
        </Row>
      </Panel>

      <Panel title={t('sectionDanger')} help={t('sectionDangerHelp')}>
        <Row title={t('clearData')} help={t('clearDataHelp')}>
          <Button variant="outline" disabled={ui.busy} onClick={clearAll} className="border-destructive/30! bg-transparent! text-destructive! hover:bg-destructive/10!"><Trash2 />{t('clearData')}</Button>
        </Row>
      </Panel>
    </div>
  );
}

function Panel({ title, help, footer, children }: { title: string; help: string; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line-strong bg-muted/60 p-1">
      <header className="px-[17px] pt-2 pb-2.5">
        <h2 className="font-medium">{title}</h2>
        <p className="mt-0.5 text-xs text-text-secondary">{help}</p>
      </header>
      <div className="rounded-md border bg-card dark:bg-background">{children}</div>
      {footer && <footer className="flex items-center gap-2 px-[17px] py-2">{footer}</footer>}
    </section>
  );
}

function Row({ title, help, field, children }: { title: string; help: string; field?: boolean; children: React.ReactNode }) {
  const Tag = field ? 'label' : 'div';
  return (
    <Tag className="flex items-center gap-6 border-b px-4 py-3 last:border-b-0 max-sm:flex-col max-sm:items-stretch max-sm:gap-2">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-text-secondary">{help}</span>
      </span>
      <div className={cn('shrink-0', field ? 'sm:w-72' : 'flex justify-end')}>{children}</div>
    </Tag>
  );
}
