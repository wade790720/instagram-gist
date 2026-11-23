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
interface AskBase { msg: string; ok: string; title?: string }
export type Ask =
  | (AskBase & { kind: 'confirm'; danger?: boolean; resolve: (yes: boolean) => void })
  | (AskBase & { kind: 'text'; resolve: (text: string | null) => void });

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
  thumbsVersion: 0,
};

let version = 0;
const subs = new Set<() => void>();
export const emit = () => { version++; subs.forEach(f => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useStore = () => useSyncExternalStore(subscribe, () => version);

// The build fails when DB gains a field this record lacks; DB_KEYS is derived from it.
const STORED: Record<keyof DB, true> = {
  following: true, saved: true, summaries: true, settings: true, lastSync: true,
  defs: true, clubHint: true, onboarded: true, shortFollowing: true,
};
export const DB_KEYS = Object.keys(STORED) as (keyof DB)[];

/** Mirrors db into storage: present keys are written, deleted ones removed. Other modules' keys are never touched. */
export async function save() {
  await chrome.storage.local.set({ ...db });
  const gone = DB_KEYS.filter(k => !(k in db));
  if (gone.length) await chrome.storage.local.remove(gone);
}
export const status = (msg: string, err = false) => { Object.assign(ui, { status: msg, err }); emit(); };
export const setView = (v: Partial<typeof ui.view>) => { Object.assign(ui.view, v); emit(); };
export const allItems = () => [...db.following, ...db.saved];

// Not confirm/prompt: a missed import would still compile and open the browser's own dialog.
export const askConfirm = (a: AskBase & { danger?: boolean }) =>
  new Promise<boolean>(resolve => { ui.ask = { ...a, kind: 'confirm', resolve }; emit(); });
export const askText = (a: AskBase) =>
  new Promise<string | null>(resolve => { ui.ask = { ...a, kind: 'text', resolve }; emit(); });
