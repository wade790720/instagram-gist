import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// `npm run dev` opens app.html as a plain page, where chrome.* does not exist: fake it with
// sample data so the UI can be worked on without loading the extension. Not in the build.
if (import.meta.env.DEV && !globalThis.chrome?.storage) await import('./dev/mock');

// Theme follows the system, live.
const dark = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);
document.documentElement.lang = chrome.i18n.getUILanguage();

// Imported after the mock: store.ts reads chrome.i18n at load.
const { load } = await import('./lib/actions');
const { App } = await import('./App');
await load();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
