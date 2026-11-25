import { useState } from 'react';
import { ArrowUpRightFromSquare, BroomMotion, Sparkles, TrashBin } from '@gravity-ui/icons';
import { modelOptions, type Lang, type ModelTier } from '@/core';
import { clearAll, resortAll, saveSettings, tidyTopics } from '@/lib/actions';
import { t, when } from '@/lib/i18n';
import { DEFAULTS, db, ui } from '@/lib/store';
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
  const models = modelOptions(ui.models, [s.model, s.summaryModel, DEFAULTS.model, DEFAULTS.summaryModel]);
  const pick = (k: 'model' | 'summaryModel') => (
    <Select value={s[k]} onValueChange={v => setS({ ...s, [k]: v })}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {models.map(m => (
          <SelectItem key={m.name} value={m.name}>
            {m.name}
            {m.tier && <Pill>{t(TIER_LABEL[m.tier])}</Pill>}
            {m.name === DEFAULTS[k] && <Pill strong>{t('recommended')}</Pill>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-8 py-8 max-md:px-4">
      <Panel title={t('sectionAi')} help={t('sectionAiHelp')} footer={<>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">{dirty ? t('unsaved') : t('allSaved')}</span>
        <Button variant="outline" disabled={!dirty} onClick={() => setS({ ...db.settings })}>{t('cancel')}</Button>
        <Button disabled={!dirty} onClick={save}>{t('save')}</Button>
      </>}>
        <Row field title={t('apiKey')} help={t('apiKeyHelp')}>
          <Input type="password" value={s.apiKey} onChange={set('apiKey')} placeholder="AIza…" autoComplete="off" />
        </Row>
        <Row field title={t('model')} help={t('modelHelp')}>{pick('model')}</Row>
        <Row field title={t('summaryModel')} help={t('summaryModelHelp')}>{pick('summaryModel')}</Row>
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
          <Button variant="outline" disabled={ui.busy || !db.settings.apiKey} onClick={tidyTopics}><BroomMotion />{t('tidy')}</Button>
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
          <Button variant="outline" asChild data-icon="end"><a href={CLUB_URL} target="_blank" rel="noreferrer">{t('clubButton')}<ArrowUpRightFromSquare /></a></Button>
        </Row>
      </Panel>

      <Panel title={t('sectionDanger')} help={t('sectionDangerHelp')}>
        <Row title={t('clearData')} help={t('clearDataHelp')}>
          <Button variant="outline" disabled={ui.busy} onClick={clearAll} className="border-destructive/30! bg-transparent! text-destructive! hover:bg-destructive/10!"><TrashBin />{t('clearData')}</Button>
        </Row>
      </Panel>
    </div>
  );
}

const TIER_LABEL: Record<ModelTier, string> = { quality: 'tierQuality', balanced: 'tierBalanced', quota: 'tierQuota' };

function Pill({ strong, children }: { strong?: boolean; children: React.ReactNode }) {
  // The trigger echoes the item's text; the field is too narrow for tags there.
  return <span className={cn('rounded-[0.375rem] px-1.5 text-xs leading-5 in-data-[slot=select-trigger]:hidden', strong ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{children}</span>;
}

function Panel({ title, help, footer, children }: { title: string; help: string; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <header className="mb-2.5 px-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>
      </header>
      <div className="tile overflow-hidden rounded-xl">
        {children}
        {footer && <footer className="flex items-center gap-2 border-t bg-muted/50 px-4 py-2.5">{footer}</footer>}
      </div>
    </section>
  );
}

function Row({ title, help, field, children }: { title: string; help: string; field?: boolean; children: React.ReactNode }) {
  const Tag = field ? 'label' : 'div';
  return (
    <Tag className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-3 last:border-b-0 max-sm:flex-col max-sm:items-stretch">
      {/* The label keeps room to read; a control too wide for the row wraps below it instead of squeezing it. */}
      <span className="min-w-56 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-text-secondary">{help}</span>
      </span>
      <div className={cn('ms-auto shrink-0', field ? 'sm:w-72' : 'flex justify-end')}>{children}</div>
    </Tag>
  );
}
