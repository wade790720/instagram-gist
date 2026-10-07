import { useSyncExternalStore } from 'react';
import type { Lang, Post, Summaries, User } from '@/core';

export interface Settings { apiKey: string; model: string; summaryModel: string; lang: Lang }
export interface DB {
  following: User[];
  saved: Post[];
  summaries: Summaries;
  settings: Settings;
  lastSync: { saved?: number; following?: number };
  /** A suspiciously short following count, refused once (see sync). */
  shortFollowing?: number;
}
export type Tab = 'following' | 'saved' | 'digests' | 'settings';
export interface Ask { msg: string; ok: string; input?: boolean; danger?: boolean; resolve: (v: string | true | null) => void }

// Free tier, 2026-09: 3.5-flash-lite ~500 calls/day (sorting needs many), 3.8-flash ~20/day
// (better writing; enough for digests).
export const DEFAULTS: Settings = {
  apiKey: '',
  model: 'gemini-3.5-flash-lite',
  summaryModel: 'gemini-3.8-flash',
  lang: chrome.i18n.getUILanguage().startsWith('zh') ? 'zh' : 'en',
};

// ponytail: one mutable store plus a version counter, same model as the old app.js (mutate, then
// emit). Components re-render on every emit; the lists are small enough that this never shows.
export const db: DB = { following: [], saved: [], summaries: {}, settings: { ...DEFAULTS }, lastSync: {} };
/** username -> data URL. Own storage key, outside db, so save() does not rewrite ~5 MB each time. */
export const avatars: Record<string, string> = {};
export const ui = {
  view: { tab: 'saved' as Tab, cat: '', q: '' },
  busy: false,
  status: '',
  err: false,
  /** null = hidden, 'busy' = moving bar with no value, else a fraction 0..1. */
  progress: null as null | 'busy' | number,
  /** Digests the user has opened, by "<topic>#<id>". */
  opened: new Set<string>(),
  ask: null as Ask | null,
  /** Bumped after covers are downloaded, so mounted cards look in the cache again. */
  thumbs: 0,
};

let version = 0;
const subs = new Set<() => void>();
export const emit = () => { version++; subs.forEach(f => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useStore = () => useSyncExternalStore(subscribe, () => version);

export const save = () => chrome.storage.local.set({ ...db });
export const status = (msg: string, err = false) => { Object.assign(ui, { status: msg, err }); emit(); };
export const setView = (v: Partial<typeof ui.view>) => { Object.assign(ui.view, v); emit(); };
export const allItems = () => [...db.following, ...db.saved];

/** Confirm (resolves true) or prompt (input: resolves the trimmed text). null when cancelled. */
export const ask = (a: Omit<Ask, 'resolve'>) =>
  new Promise<string | true | null>(resolve => { ui.ask = { ...a, resolve }; emit(); });
