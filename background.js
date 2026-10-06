// One app tab only: two tabs would sync at the same time and overwrite each other's storage.
// runtime.getContexts (Chrome 116+) finds our own tabs without the "tabs" permission.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app.html');
  const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  if (!ctx) return chrome.tabs.create({ url });
  chrome.tabs.update(ctx.tabId, { active: true });
  chrome.windows.update(ctx.windowId, { focused: true });
});

// —— 送到 brand-digest：把這位博主頁面上「已經載入」的貼文連結交給本機的 brand-digest 萃取 ——
// 只讀畫面上已有的連結，不對 IG 多發任何請求；IG 看到的就是你在滑她的頁面。
// brand-digest 再用「不登入」的單則模式逐則下載，所以也不會用到你的帳號。
const BD = 'http://localhost:8765';
const msg = (k, ...subs) => chrome.i18n.getMessage(k, subs);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'send-bd', title: msg('menuSendBD'), contexts: ['page', 'link', 'image', 'video'],
    documentUrlPatterns: ['https://www.instagram.com/*'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'send-bd' || !tab?.id) return;
  const toast = text => chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showToast, args: [text] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPostLinks });
  if (result.error) return toast(msg('bdNotProfile'));
  if (!result.codes.length) return toast(msg('bdNone'));
  const urls = result.codes.map(c => `https://www.instagram.com/p/${c}/`);
  let r;
  try {
    r = await fetch(BD + '/run', { method: 'POST', body: JSON.stringify({ urls }) });
  } catch {
    return toast(msg('bdOffline'));
  }
  if (r.status === 409) return toast(msg('bdBusy'));
  if (!r.ok) return toast(msg('bdError', (await r.json().catch(() => ({}))).error || 'HTTP ' + r.status));
  toast(msg('bdSent', String(urls.length), result.creator));
  openBrandDigest();
});

// 已開著 brand-digest 就重新整理並切過去（頁面載入時會接上進行中的任務），沒開就開一個
async function openBrandDigest() {
  const [t] = await chrome.tabs.query({ url: BD + '/*' });
  if (!t) return chrome.tabs.create({ url: BD });
  chrome.tabs.reload(t.id);
  chrome.tabs.update(t.id, { active: true });
  chrome.windows.update(t.windowId, { focused: true });
}

// 在 IG 頁面裡執行：只接受博主主頁或 Reels 分頁（標記分頁是別人的貼文，不收）
function collectPostLinks() {
  const m = location.pathname.match(/^\/([A-Za-z0-9._]+)\/(?:reels\/)?$/);
  const reserved = ['explore', 'reels', 'p', 'reel', 'direct', 'accounts', 'stories'];
  if (!m || reserved.includes(m[1])) return { error: 'notProfile' };
  const codes = new Set();
  for (const a of document.querySelectorAll('main a[href]')) {
    const h = a.getAttribute('href').match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
    if (h) codes.add(h[1]);
  }
  return { creator: m[1], codes: [...codes] };
}

// 在 IG 頁面裡執行：右下角提示 6 秒
function showToast(text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483647;max-width:360px;padding:14px 18px;'
    + 'border-radius:12px;background:#322F35;color:#F5EFF7;font:14px/1.5 system-ui,sans-serif;'
    + 'box-shadow:0 4px 16px rgba(0,0,0,.35)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
