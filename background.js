// One app tab only: two tabs would sync at the same time and overwrite each other's storage.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app.html');
  const [tab] = await chrome.tabs.query({ url });
  if (!tab) return chrome.tabs.create({ url });
  chrome.tabs.update(tab.id, { active: true });
  chrome.windows.update(tab.windowId, { focused: true });
});
