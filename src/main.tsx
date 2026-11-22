import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { captureErrors } from './lib/error-log';

captureErrors('ig-sorter');

if (import.meta.env.DEV && !globalThis.chrome?.storage) await import('./dev/mock');

const dark = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);
document.documentElement.lang = chrome.i18n.getUILanguage();

const { load } = await import('./lib/actions');
const { App } = await import('./App');
await load();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
