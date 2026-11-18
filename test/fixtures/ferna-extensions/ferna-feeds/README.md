# Ferna Feeds 1.0.1

A Chrome / Edge / Brave extension (Manifest V3) by Ferna Software Solutions: the news and research reader of the Ferna Sundaree browser, in the browser's side panel or a tab.

## What it does
* **Follow** RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed — type a site address and the feed is found; a site without a feed can be followed too (new links on the page become items). When the page you are on announces a feed, the feeds panel offers **Follow**; right-click a page or a link → *Follow this … in Ferna Feeds*. Starter packs: Sri Lankan news in English and Sinhala (Ada Derana, EconomyNext, Daily News, The Island, Sunday Observer, Dinamina, BBC Sinhala), world news, arXiv and research, tech and AI.
* **Streams**: Local (Sri Lanka), Global, Research & Academia, Tech & AI, Saved, your own channels (by keywords or feeds), and each feed on its own with its unread count.
* **One card per story**: reports of the same event from several sites become one card with “Also reported by …”.
* **Summaries** of 2–3 sentences, topic tags, and **For you** order from your interests, what you read and your +word / −word / /regex/ rules; low-relevance items can be hidden.
* **Reader view** (Mozilla Readability), **Save** for offline reading, **History** of what you read, **mark read as you scroll** (or when you point, or only when opened), mark older items read.
* **Today's digest** with its own text size and zoom, and a notification when it is ready.
* **Display**: text size, fonts (including a Sinhala-friendly one), reading width, cards / compact / headlines, pictures; open items in the reader, the reader in a tab, or the original page in a new or background tab. Keyboard: J/K, O, V, B, S, M, X, Shift+A, R, /, ? .
* **Export and import** your feeds with all settings, or OPML for other readers.
* The unread count on the toolbar button; feeds are checked in the background (every 30 minutes by default, politely: one request per site at a time, conditional requests).

## Install (unpacked)
1. Unzip `ferna-feeds-1.0.1.zip`. 2. Open `chrome://extensions`, switch on **Developer mode**. 3. **Load unpacked** → the unzipped folder. 4. Pin it; click it to open the side panel (Alt+Shift+N). Manage opens on first run so you can pick feeds.

## Privacy
No account, no analytics, no server of ours. The extension connects only to the feeds and pages you follow (and the article pages you open in the reader), without cookies. Your feeds, items and settings are kept in this browser profile (IndexedDB and extension storage). Permissions: access to web sites (to fetch the feeds you follow and to see which feeds a page announces), `storage`, `unlimitedStorage` (saved articles), `alarms` (background checks), `notifications` (the digest), `sidePanel`, `contextMenus`, `tabs`, `scripting`.

AI summaries and AI takeaways are part of the Ferna Sundaree browser (with your own AI model); the extension makes its summaries on your computer.

Includes Mozilla Readability (Apache License 2.0). MIT licence · © 2026 Ferna Software Solutions

## Changes in 1.0.1
- An item you open stays in the list, dimmed as read, instead of vanishing; read items leave when you change the view or refresh. Display → "Hide read items" can make them leave at once, or stay until Feeds is opened again.
- No more flicker: the list is updated card by card instead of being redrawn, and switching browser tabs no longer reloads it. New items that arrive while you are scrolled down wait behind a "new items" button.
- Every item can be reached: the list grows page by page as you scroll (no 300-story limit), the bar shows "N unread · M stories", and a grouped card shows how many of its reports are unread.
- Display → "Group reports of one story": across streams, within a stream, or not at all. Opening a story no longer marks its reports in other streams read unless you turn that on.
- Undo after marking read (scrolling, Mark all read, older than…); "Recently opened" above the list; U turns Unread only on and off.
