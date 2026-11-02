# Ferna Screenshots 1.0.0

A Chrome / Edge / Brave extension (Manifest V3) by Ferna Software Solutions for taking screenshots of web pages and saving them on your computer.

## What it does

| Capture | How it works |
|---|---|
| **Visible area** (Alt+Shift+V) | What is on screen now, without the scrollbar. |
| **Entire page** (Alt+Shift+F) | Scrolls the page screen by screen and stitches the pieces into one picture. Sticky headers are put back in their normal place and floating buttons (chat bubbles, “back to top”) appear only once. Pages that scroll an inner panel (web mail, dashboards) are detected. |
| **Select region** (Alt+Shift+R) | Drag a rectangle. The selection is held in page coordinates, so you can scroll with the wheel or drag to the window edge to auto-scroll, then resize it with its handles — the region can be many screens tall or wide. Only the selected part is captured. |
| **Select element** (Alt+Shift+E) | Hover to highlight a card, table, chart or post; ↑/↓ walk to the parent/child; click to capture all of it, even the parts off-screen. |

All four are in the toolbar popup, the right-click menu and keyboard shortcuts. A 3/5/10-second delay is available for visible and entire-page captures (for open menus or hover effects).

### Page stamp
Every screenshot can carry a stamp with the **page title, the address (URL), and the date and time with the UTC offset** — optional extras are the capture type and page size, a note (e.g. a case number), and a “Captured with Ferna Screenshots” line.

* **Best corner (automatic)** measures the four corners of the picture and places the stamp where it covers the least detail; or choose a fixed corner.
* **Strip below / above the picture** adds the stamp on its own band so it covers nothing.
* Dark or light style, adjustable size, local / ISO 8601 / UTC time.
* In PDFs the address in the stamp is a clickable link.

### Editor
Opens after each capture (or choose “Save immediately”). Crop, rectangle (outline or filled), ellipse, arrow, line, pen, highlighter, text, numbered steps, and blur/pixelate for passwords and personal details. Select, move, recolour, resize and delete marks; unlimited undo/redo; zoom (Ctrl+wheel), pan (Space+drag). Very tall captures stay fast because only the visible part of the canvas is drawn.

### Saving
* **PNG, JPG or PDF** (A4 pages, or one page per screenshot) to `Downloads/Ferna Screenshots/` with a name such as `example.com_2026-10-31_06-34-12.png`. Folder and name pattern are configurable; tick “Ask where to save each file” to choose any folder.
* **Copy** the picture to the clipboard to paste into chat, e-mail or documents.
* **History** keeps the last 40 screenshots (configurable) with their edits, in the browser’s own storage.

## Install (unpacked)
1. Unzip `ferna-screenshots-1.0.0.zip`.
2. Open `chrome://extensions` (Edge: `edge://extensions`), switch on **Developer mode**.
3. **Load unpacked** → choose the unzipped `ferna-screenshots` folder.
4. Pin the extension from the puzzle-piece menu. Check shortcuts at `chrome://extensions/shortcuts` — if another extension already uses a key, Chrome leaves it blank and you can set your own there.

For local files (`file://`) switch on **Allow access to file URLs** in the extension’s details.

## Limits
* Browser pages (`chrome://…`), the Chrome Web Store and the built-in PDF viewer do not allow extensions to scroll them; there only the visible area can be captured.
* Chrome allows two screen grabs per second, so a long page takes about half a second per screen.
* Browsers limit an image to about 32,000 px on a side; longer captures are scaled down to fit, and the longest page is capped at 30,000 CSS px by default (Settings).
* Content inside cross-origin iframes is captured as seen, but the iframe’s own inner scrolling is not stitched.

## Privacy
No account, no network requests, no analytics. Screenshots are kept in the browser’s IndexedDB (History) and written to your Downloads folder. Permissions: `activeTab` (only the tab you capture, only when you ask), `scripting` (scroll and select on that tab), `downloads`, `storage`, `contextMenus`, `notifications` (error messages), `unlimitedStorage` (history of large captures), `clipboardWrite` (Copy).

MIT licence · © 2026 Ferna Software Solutions
