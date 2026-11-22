// runtime.getContexts (Chrome 116+) finds our own tabs without the "tabs" permission.
async function openAppTab() {
  const url = chrome.runtime.getURL('app.html');
  const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  if (!ctx) return chrome.tabs.create({ url });
  chrome.tabs.update(ctx.tabId, { active: true });
  chrome.windows.update(ctx.windowId, { focused: true });
}

chrome.action.onClicked.addListener(openAppTab);
chrome.runtime.onInstalled.addListener(({ reason }) => { if (reason === 'install') openAppTab(); });
