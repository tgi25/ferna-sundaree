// Sets the toolbar badge from the MV3 service worker (needs the extension API preload).
const setBadge = () => chrome.action.setBadgeText({ text: 'ON' }).then(() => chrome.action.setBadgeBackgroundColor({ color: '#16a34a' })).catch(() => {});
chrome.runtime.onInstalled.addListener(setBadge);
setTimeout(setBadge, 300);
