# Ferna Tabs (Chrome extension)

Shows a list of your open tabs **where the mouse pointer is**, arranged into workspaces of your own. Click a tab to switch to it, or click **×**
(or middle-click the row) to close it without visiting it. Each tab also has a pin button: click it to pin or unpin the tab. Pinned tabs show a filled pin, have no **×**, and are not
closed by Delete or middle-click either.

The list stays open while you close tabs, so you can close several in a row. If you close the tab you are
currently on, the list reappears in the same place in the tab Firefox switches to.

## Workspaces

A **workspace** is a group of sites — Teaching, Research, Code, and so on. The bar of icons along the
bottom of the list switches between them; the leftmost grid icon is **All tabs**, which shows everything
grouped by workspace.

Inside a workspace the list is divided by rules into three clearly separate parts:

| Part | What it holds |
|---|---|
| The icon bar at the very top | **Common sites** — the same in every workspace, reachable in one click without switching. Up to twenty; ten by default |
| **Pinned in <workspace>** | Sites you pinned to this workspace. They stay listed whether or not they are open; a closed one is greyed and says *Not open* |
| **<workspace> tabs** | The open tabs this workspace claims, and nothing else |

A workspace shows **only its own things**. A tab that belongs to no workspace is not listed inside
one; instead a single line at the bottom says how many are waiting, and clicking it (or **Alt+0**)
switches to **All tabs**, where everything is listed and grouped by workspace. Nothing is ever lost,
and a workspace stays as narrow as you made it.

Switching a workspace changes what the list shows. It never moves, hides or closes anything in Chrome's
own tab strip.

### Moving a tab into a workspace

Every tab row has a **move** button. Click it and a panel lists every workspace, **No workspace**,
and the **common bar**; choose one and the tab goes there. The button is tinted when the tab already
belongs to a workspace, and its tooltip names it, so you can see at a glance what is sorted and what
is not. **Alt+Shift+1**…**9** does the same for the selected row without opening the panel, and
**Alt+Shift+0** takes a tab out of every workspace.

Moving a tab also hands its site to that workspace, so the next tab you open on the same site lands
there too. Moving it back out gives the site up again — unless it is pinned there, which the list
tells you.

By default a newly opened tab belongs to no workspace and is found under **All tabs**. The setting
*New tabs join the workspace you are in* changes that: anything opened while a workspace is in use
joins it immediately. That one remembers just the tab, not the whole site.

### Two different pins

Each row has two buttons that both sound like "pin", and they do different things:

- The **tag** button, on a pinned-site row, unpins that site from the workspace. On ordinary tab rows
  it is replaced by the **move** button described above, which can send the tab anywhere rather than
  only to the workspace you happen to be in.
- The **pin** button is the *browser's* own pin, which moves the tab to the left of the tab strip. It
  has no effect on workspaces, so a tab pinned only that way still belongs to none and is found under
  **All tabs**.

### PDFs and other local files

A pinned site can be a **local file** as well as a web address, which is how a PDF opened from your
disk appears. Pin the file itself, or pin the **folder** it sits in (end the path with `/`) and every
file you open from that folder joins the workspace.

Once pinned, a PDF gets the same treatment as any other pinned site: no close button on its row,
Delete and middle-click leave it alone, and the browser is asked not to unload it. An "open in the
current tab" also steps around it and uses a new tab instead, so a click on the common bar cannot
load a site over a PDF you are reading.

Chrome blocks extensions from `file://` addresses until you allow it: open the extension's entry on
`chrome://extensions`, and turn on **Allow access to file URLs**. Ferna Tabs checks this and says so
in the settings rather than failing quietly. Until it is on, local PDFs are still listed and can be
switched to — only reopening a closed one needs the permission.

### Keeping a tab loaded, and out of harm's way

Chrome unloads background tabs when memory runs short and reloads them when you come back,
losing the scroll position and anything half-typed. Ferna Tabs can ask Chrome to leave the tabs
of your common sites alone (on by default), and of your workspace-pinned sites too. It is a
strong request rather than a guarantee: under real memory pressure Chrome may still unload them.

Those same sites can also be protected from closing — no close button on their rows, Delete and
middle-click leave them alone, and the background script refuses the request even if it arrives by
another route. The small x that takes an icon off the common bar can be
hidden as well, so a mis-click cannot delete a shortcut. All of these are in the settings.

### Pinning a site

Every row has a small **tag** button (it appears when you hover or select the row). It pins that site to
the workspace you are in, or — when **All tabs** is chosen — adds it to the common bar. **Alt+S** does the
same for the selected row, and **Alt+Shift+S** always means the common bar, whichever workspace you are in.
Click the tag again to unpin. It works on a typed address too: type `example.org` and press **Alt+S**.
You can also add and reorder common sites in the settings.

**What an icon remembers.** Adding an open tab stores the *folder* the page was in, not the exact page
and not the bare domain. A tab on `calendar.google.com/calendar/u/0/r/week` is stored as
`calendar.google.com/calendar/u/0/r/`, so the icon still recognises that tab once you move to the day or
month view and switches to it rather than opening a second copy. The same rule is what lets **two
accounts of one site each have their own icon**: `mail.google.com/u/0/` and `mail.google.com/u/1/` are
separate entries that never replace one another. When more than one icon comes from the same site, a
small badge (`0`, `1`, …) shows which is which.

Typing an address in the settings stores it exactly as typed — end it at `/` to mean the whole site.
Clicking an icon for a site that is **not** open loads it in the current tab by default; middle-click
always opens a background tab. A workspace holds sixty pinned pages, and those keep their exact address.

### How a tab lands in a workspace

Each workspace owns the host names of its pinned sites, plus any extra hosts you list in the settings, and
sub-domains count too. So once `arxiv.org` is pinned to Research, every arXiv tab is listed there. Press
**Alt+Shift+1**…**9** to send the selected tab to a workspace by hand; that also hands its host to that
workspace from then on. A host belongs to one workspace at a time. Anything unclaimed shows under
**Unsorted**, so no tab is ever hidden from you.

### Workspace shortcuts

While the list is open:

| Key | What it does |
|---|---|
| **Alt+1** … **Alt+9** | Go to that workspace |
| **Alt+0** | All tabs |
| **Ctrl+Tab** / **Ctrl+Shift+Tab** | Rotate forward / back |
| **Alt+→** / **Alt+←** | Rotate forward / back |
| **Alt+Shift+1** … **Alt+Shift+9** | Move the selected tab into that workspace |
| **Alt+S** | Pin or unpin the selected row's site in this workspace |
| **Alt+Shift+S** | Add or remove the selected row's site on the common bar |

Browser-wide, Chrome allows an extension only four shortcuts with ready-made keys, so Ferna Tabs ships
**Alt+Shift+L** (open the list), **Alt+Shift+.** (next workspace), **Alt+Shift+,** (previous workspace)
and **Alt+Shift+1** (workspace 1). *Workspace 2* … *Workspace 9* and *Show all tabs* are listed on
`chrome://extensions/shortcuts` with no keys; assign whatever you like there. The settings page has a
button that opens it. Pressing a workspace shortcut opens the list at the pointer already showing that
workspace, or, if the list is already open, just switches it.

### Managing workspaces

The **+** at the end of the workspace bar makes one and opens the settings so you can name it. In the
settings you can rename, reorder and delete workspaces, pick an icon (any character or emoji) and a
colour, edit the pinned sites, and list extra host names. Deleting a workspace forgets its pinned sites;
it never touches your tabs or bookmarks.

A workspace icon can be any character or emoji, or a picture from your computer — it is shrunk to 32
pixels and kept on that computer. Both the workspace chips and the common-bar icons have a size setting.

Workspaces are stored in Chrome's synced extension storage, so they follow you to other computers signed
in to the same Chrome profile, and they survive updating the extension. Which workspace is currently in
use is local to each computer, as are uploaded icons.

### Moving to another computer, and backups

*Settings → Backup* exports everything — settings, workspaces, pinned sites, the common bar and uploaded
icons — to one JSON file, and imports it back. Use it for a different browser or profile, or to keep a
copy of a setup you like. A snapshot is also taken automatically whenever the extension updates and can
be restored from the same place, so a bad release can be undone.

### Appearance

*Settings → Appearance* chooses light, dark or following the system, and sets the highlight colour used
for the selected row, the active-tab marker and the pressed buttons. The settings page follows the same
choice, so you can see the effect as you pick it.

## Ways to open the list

| Trigger | Where it appears |
|---|---|
| Keyboard shortcut (default **Alt+Shift+L**) | At the mouse pointer |
| Right-click a page → **Ferna Tabs Here** | Where you right-clicked |
| Toolbar button | Below the button |

In the list: type to filter · ↑/↓ to select · Enter to switch · Delete to close (Shift+Delete while
typing a search) · Esc to clear the search, then to dismiss. Clicking outside the list also dismisses it.
Searching looks through every part of the workspace you are in — pinned sites included.

### Typing an address or a search (like Firefox's address bar)

- **An address** such as `yahoo.com`, `https://example.org/page` or `localhost:8080`: a **Go to …** row appears
  at the top and is selected, so Enter opens it.
- **Any other text**: if it matches open tabs, those are listed first and Enter switches to the selected one;
  a **Search with <your default engine>** row is at the bottom (press ↓ to reach it). If nothing matches,
  the search row is at the top and Enter searches straight away.
- If a search ever fails, the list shows Firefox's own error message at the bottom, and the details are in
  the add-on console (`chrome://extensions` → *Ferna Tabs* → **service worker** → Console).
- By default both open in a new tab; Shift+Enter uses the current tab instead. The setting
  *Open typed addresses and searches in* swaps the two.

### Buttons at the top of the list

- **+** opens a new tab (the same as Ctrl+T) in that window.
- **★** switches to your bookmarks (the **Tab** key does the same). It can start inside a folder you
  choose in the settings, and can open when the pointer simply rests on it.

### Bookmarks in columns

Bookmarks are listed in side-by-side columns, so a large collection needs far less scrolling. A
column fills from top to bottom before the next begins, the way a printed index reads, and anything
past the last visible column is reached by scrolling across — with **→**, the mouse wheel, or a
trackpad swipe.

Two settings control it: how many **columns**, and how many **items per column**. The list keeps the
width you set and divides it between the columns, so it never grows sideways; more columns therefore
mean narrower ones, and the settings page shows the resulting width as you adjust it. Below about
150px a column drops the site icons to leave room for the title, and hovering a row always shows the
full name. Items per column sets the height of the bookmark view.

Set columns to **1** for the single list of earlier versions.

In columns, **←** and **→** move between columns and **↑**/**↓** within one. **Backspace** or the
**Back** row goes up a folder, and **Enter** opens a folder or a bookmark. Click a folder to open it, **Back**
  or **←** to go up, type to search all bookmarks. Click or **Enter** opens a bookmark; middle-click or
  **Shift+Enter** opens it in a background tab and keeps the list open. **Tab** or **Esc** returns to the tabs.
- **⚙** opens the settings.

### Size

The list always has exactly the width and height set in the settings, on every website. Chrome's
per-site zoom (Ctrl +/−), zoom that a site applies with CSS, and the frame of the small fallback window
are all compensated for. The text size is set with *Font size*, and the small **A** / **A** buttons at the bottom right make every row smaller or larger (80%–160%, in 10% steps).
The size is remembered. It can also be set in the settings.

## Changing the shortcut

Chrome does not let an extension set its own shortcut. Open `chrome://extensions/shortcuts`, find
**Ferna Tabs** and choose any combination. The button in the extension's Options page opens that page for you.

## Settings

- Appearance: light / dark / follow the system, and the highlight colour
- Workspaces: add, name, reorder, colour, icon (character, emoji or an uploaded picture), size, pinned sites and host rules
- The common bar: how many icons, how big, where a click opens, and whether the remove button shows
- Protecting common and pinned tabs from closing, and asking Chrome not to unload them
- The bookmark button: a folder to start in, and opening on hover
- Export and import, and restoring an automatic snapshot
- Show or hide the common bar and the workspace bar; optionally also list common sites among the rows
- Show tabs from the current window or from all windows (grouped by window)
- Show or hide the address under each title
- Tab row size (80%–160%)
- Open bookmarks in a new tab or in the current tab
- Show or hide the right-click menu item
- Font size of the list (10–24 px)
- Popup width and height: a fixed on-screen size that does not change with a page's zoom level

## Installing

**For testing:** open `chrome://extensions`, turn on **Developer mode** (top right), click
**Load unpacked** and choose this folder. (A `.zip` must be unzipped first; Chrome loads folders, not zips.)

**For everyone:** upload the `.zip` to the Chrome Web Store Developer Dashboard
(<https://chrome.google.com/webstore/devconsole>). A Google account and a one-off registration fee are
required, and a review takes a few days.

Requires Chrome 128 or later. It also works in other Chromium browsers: Edge, Brave, Opera, Vivaldi.

## Permissions

- **tabs**: read tab titles/addresses, switch, close and pin tabs
- **Access to all websites** (host permissions + **scripting**): draw the list on the page, track the pointer
  position and load favicons from the cache
- **bookmarks**: show your bookmarks in the list (read only; the extension never changes them)
- **search**: run searches with your default search engine
- **contextMenus**: the right-click item · **storage**: your settings

Nothing is collected or sent anywhere. The only network use is loading each open tab's favicon (normally straight from Firefox's cache).

## Icon

Two cats, a black cat and a tabby. The source drawing is `icons/icon-source.svg`.

## Differences from the Firefox add-on

- The shortcut is changed on `chrome://extensions/shortcuts` (Chrome gives extensions no way to set it).
- The search row says "Search the web for …" rather than naming your engine: Chrome does not tell
  extensions which search engine is the default.
- The background script is a Manifest V3 service worker, which Chrome stops when idle. The first press of
  the shortcut after a long pause can therefore be slightly slower than in Firefox.
- Chrome's own pages (New Tab, chrome://, the Web Store, the PDF viewer) do not allow extensions to draw,
  so there the list opens as a small window, as it does on Firefox's own pages.

## Building this from the Firefox sources

Up to and including 1.10.0, `build-chrome.py` regenerated this folder from the Firefox add-on. The
workspace work in 1.11.0 was done here first, so for this release the Chrome folder is the source and the
Firefox add-on is ported back from it. `build-chrome.py` needs updating before it is used again.

## Files

`manifest.json` · `sw.js` (service worker entry) · `compat.js` (Chrome/Firefox API differences) ·
`background.js` (shortcuts, menu, tab data, favicon cache, workspace state, fallback window) ·
`workspaces.js` (the workspace model: storage, host rules, limits — no browser calls beyond its own store) ·
`pointer.js` (pointer tracking in every frame) · `content.js` (draws the list in the page) ·
`ui.js` (the list widget and its CSS) · `list.html/.js` (toolbar popup and fallback window) ·
`options.html/.css/.js` (settings) · `options-ws.js` (the workspace editor) · `common.js` (defaults)

## Why it opens quickly (version 1.1)

- The list is drawn directly into the page inside a closed shadow root. Version 1.0 loaded a separate
  extension page in an iframe every time, which took a noticeable moment.
- Settings, favicons and the tab list are prepared in the background and sent to the page ready to draw.
- Favicons are passed to the page as `data:` URLs, so showing the list triggers no network requests that
  the web page could observe. Keys typed into the list are stopped before page scripts see them.
