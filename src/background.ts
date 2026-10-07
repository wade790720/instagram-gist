// One app tab only: two tabs would sync at the same time and overwrite each other's storage.
// runtime.getContexts (Chrome 116+) finds our own tabs without the "tabs" permission.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app.html');
  const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  if (!ctx) return chrome.tabs.create({ url });
  chrome.tabs.update(ctx.tabId, { active: true });
  chrome.windows.update(ctx.windowId, { focused: true });
});
