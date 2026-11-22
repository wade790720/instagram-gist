import { useSyncExternalStore } from 'react';
import type { Lang, Post, Summaries, User } from '@/core';

export interface Settings {
  apiKey: string; model: string; summaryModel: string; lang: Lang;
  followView: 'grid' | 'list';
}
export interface DB {
  following: User[];
  saved: Post[];
  summaries: Summaries;
  settings: Settings;
  lastSync: { saved?: number; following?: number };
  defs: Record<string, string>;
  clubHint?: boolean;
  onboarded?: boolean;
  shortFollowing?: number;
}
export type Tab = 'following' | 'saved' | 'digests' | 'settings';
export interface Ask { msg: string; ok: string; input?: boolean; danger?: boolean; resolve: (v: string | true | null) => void }

// Free tier, 2026-09: 3.5-flash-lite ~500 calls/day (sorting needs many), 3.8-flash ~20/day
// (better writing; enough for digests).
export const DEFAULTS: Omit<Settings, 'lang'> = {
  apiKey: '',
  model: 'gemini-3.5-flash-lite',
  summaryModel: 'gemini-3.8-flash',
  followView: 'grid',
};
export const uiLang = (): Lang => (chrome.i18n.getUILanguage().startsWith('zh') ? 'zh' : 'en');

// ponytail: one mutable store plus a version counter, same model as the old app.js (mutate, then
// emit). Components re-render on every emit; the lists are small enough that this never shows.
export const db: DB = { following: [], saved: [], summaries: {}, settings: { ...DEFAULTS, lang: 'en' }, lastSync: {}, defs: {} };
export const avatars: Record<string, string> = {};
export const ui = {
  view: { tab: 'saved' as Tab, cat: '', q: '' },
  busy: false,
  status: '',
  err: false,
  progress: null as null | 'busy' | number,
  opened: new Set<string>(),
  ask: null as Ask | null,
  tidy: null as null | { merges: [string, string][]; defs: Record<string, string> },
  thumbs: 0,
};

let version = 0;
const subs = new Set<() => void>();
export const emit = () => { version++; subs.forEach(f => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useStore = () => useSyncExternalStore(subscribe, () => version);

export const DB_KEYS = ['following', 'saved', 'summaries', 'settings', 'lastSync', 'defs', 'clubHint', 'onboarded', 'shortFollowing'] as const satisfies readonly (keyof DB)[];
export const save = () => chrome.storage.local.set({ ...db });
export const status = (msg: string, err = false) => { Object.assign(ui, { status: msg, err }); emit(); };
export const setView = (v: Partial<typeof ui.view>) => { Object.assign(ui.view, v); emit(); };
export const allItems = () => [...db.following, ...db.saved];

export const ask = (a: Omit<Ask, 'resolve'>) =>
  new Promise<string | true | null>(resolve => { ui.ask = { ...a, resolve }; emit(); });
