# Ferna Zoom 1.0.2

A Chrome / Edge / Brave extension (Manifest V3) by Ferna Software Solutions: the zoom of the Ferna Sundaree browser, in the style of Zoom Page WE.

## What it does
* **Full zoom or text-only zoom.** Full zoom enlarges everything, like the browser's zoom. Text zoom enlarges only the words; pictures and the page layout keep their size, and text that loads later is zoomed too. Back at 100 % the page is exactly as before.
* **Remembered per site** (every tab of a site) or **per tab**; sub-sites together or apart.
* **Zoom levels or fixed steps**, small steps with Shift, the mouse wheel over the pop-up.
* **AutoFit**: zooms a page so its content fills the window width (narrow sites up, over-wide ones down); optionally for every site you have not zoomed yourself.
* **Minimum font size**: small print is lifted to a size you can read, the rest stays.
* The level on the toolbar button; Ctrl + wheel and Ctrl +/− are followed and remembered.
* Keys: Alt+Shift+↑ / ↓ zoom in / out, Alt+Shift+0 reset, Alt+Shift+A AutoFit; in the pop-up + − 0, T (full/text), A (AutoFit). Ctrl+click Reset makes the current zoom the default.

## Install (unpacked)
1. Unzip `ferna-zoom-1.0.2.zip`. 2. Open `chrome://extensions`, switch on **Developer mode**. 3. **Load unpacked** → the unzipped folder. 4. Pin it from the puzzle-piece menu. For local files switch on **Allow access to file URLs**.

## Limits
Browser pages (`chrome://…`), the Chrome Web Store and the built-in PDF viewer cannot be changed by extensions. In per-tab mode and in incognito windows, full zoom is a CSS zoom (the browser's own zoom is shared by all tabs of a site).

## Privacy
No account, no network requests, no analytics. Your sites' zoom is kept in the browser's extension storage. Permissions: `tabs` (the zoom of each tab), `storage`, `scripting` and access to web pages (text zoom, minimum font size and AutoFit run in the page).

MIT licence · © 2026 Ferna Software Solutions

## Changes in 1.0.2
- Text zoom now works in web apps such as Gmail: it follows style sheets that load after the content, elements whose class or style the page changes, text inside shadow DOM, and frames that the page writes itself.
- Google Docs and Google Sheets draw their text as pictures, which text zoom cannot change; there, text zoom now zooms the whole page to the chosen text level (a note in the pop-up says so; can be turned off in the settings).

## Changes in 1.0.1
- Fixed: in Brave (and other browsers that report extra zoom events), changing the zoom level could make the page flicker without stopping. Ferna Zoom now changes only what is not already right, applies changes to a tab one at a time, and no longer mistakes its own zoom changes for yours.
