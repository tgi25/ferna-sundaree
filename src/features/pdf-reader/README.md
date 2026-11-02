# Ferna PDF Reader (Chrome extension)

A PDF reader for Chrome with per-page fit-to-width, page rotation, fast annotation and Xodo-style stylus inking.
Built on Mozilla pdf.js (rendering) and pdf-lib (saving annotations and encryption).

## Upgrading from 1.0 / 1.1
Version 1.2 has a fixed extension ID (needed by the save helper). Remove the old Ferna PDF Reader in
`brave://extensions` (or `chrome://extensions`), then **Load unpacked** again, and re-enable
**Allow access to file URLs**. Settings return to their defaults once.

## Install (unpacked, for testing)

1. Unzip this folder somewhere permanent (Chrome loads it from there).
2. Open `chrome://extensions`, switch on **Developer mode** (top-right).
3. Click **Load unpacked** and choose the `ferna-pdf-reader` folder (the one containing `manifest.json`).
4. For PDFs on your own disk: on the extension's **Details** page, switch on **Allow access to file URLs**.
5. Pin the extension (puzzle-piece icon → pin) for quick access.

PDF links you open in Chrome now open in Ferna. Right-click the toolbar icon to switch automatic opening off,
or to open a PDF file from your computer. Right-click any link → **Open link in Ferna PDF Reader**.

## Features

### 1. Pages always fit the window width
* Default zoom is **Fit width, per page**: each page (portrait *or* landscape, any size) is scaled individually
  to the width of the reading area, and re-fitted automatically whenever the window, sidebar or rotation changes.

### 2. Zoom
* Fit width (W), Fit page (P), 100 % (Ctrl+1), preset percentages, or type any percentage in the zoom box.
* Ctrl + mouse wheel / touchpad pinch / touchscreen pinch, zooming around the pointer. Ctrl + / Ctrl − / Ctrl 0.

### 3. Rotation
* Toolbar buttons rotate the **current page** left/right (R / Shift+R).
* Hover a page → small rotate buttons appear in its top-right corner.
* Right-click (or long-press) a page → page menu: rotate right/left/180°, reset, rotate all pages, fit, add note.
* Rotations are undoable and are saved into the PDF.

### 4. Annotation
* **Annotate** button (or A) opens the tool palette: Select, Hand, Highlight, Underline, Strike-out, Squiggly,
  Pen, Marker, Eraser, Text box, Sticky note, Rectangle, Ellipse, Line, Arrow — with colour, thickness, opacity,
  font size and fill.
* **The palette hides itself as soon as you pick a tool**, so the page is clear. A small pill at the bottom shows
  the active tool and colour: tap it to bring the palette back, ✓ or Esc to finish.
* **Quick popup on text selection**: select text and a small bar appears — five highlight colours, underline,
  strike-out, squiggly, highlight + comment, copy.
* Markup tools also work on scanned pages: drag a rectangle where there is no text.
* Click an annotation to recolour, resize, comment on, change type (for text markups) or delete it; drag to move it.
  Double-click a text box to edit. Del deletes, Ctrl+Z / Ctrl+Y undo/redo.
* Sidebar (F4): page thumbnails, outline, and a list of all annotations.

### Rectangular (area) highlight — new in 1.1
* **Area HL** tool in the palette (key 7): drag a rectangle anywhere — over text, images, figures or scanned
  pages — to highlight that area, like PDFGear. Saved as a standard Highlight annotation.

### Horizontal lock — new in 1.1
* The **horizontal lock** button (or L) stops the pages moving sideways when zoomed in: touchpad, Shift+wheel,
  touch and the Hand tool then only scroll up and down. Zooming still works. The setting is remembered.

### Smooth text selection — new in 1.4
* Ferna's own selection (Xodo-like): the caret goes to the nearest character even between lines or words, so the
  selection never jumps; it grows **word by word** once it leaves the first word (Alt = single characters);
  double-click = word, triple-click = line, Shift+click extends, auto-scroll at the window edge.
* Glyph-by-glyph text (LaTeX kerning, Word/LibreOffice Sinhala) is merged into words and lines; exact word positions
  are read from the rendered page, so the selection lines up with the printed words. Drawn as one band per line;
  highlights made from it get the same clean shape.
* **Sinhala repair:** visual-order vowel signs (ෙක → කෙ), joiners, unmapped glyphs (rakaransaya), and the real text
  hidden in `/ActualText` (LibreOffice, Word) — used by selection, copy, Find, the AI and Auto-Bookmark.
* Settings: *Smooth text selection*, *Select whole words when dragging*.

### Reference popups — new in 1.3
* Clicking a cross-reference link (figure, table, equation, citation, section) opens a floating card showing that
  spot of the target page — you stay where you are. Card buttons: smaller/larger, Go to page, close (Esc).
  The card can be dragged and resized. Ctrl+click a link to jump directly; a Back button (Alt+←) returns.
* Works in PDFs without links too: click a plain "Figure 3", "Table 2", "Eq. (4)", "Algorithm 1" or "Section 2.1"
  in the text and Ferna finds the caption / equation number and shows it.

### Auto-Bookmark — new in 1.3, rebuilt in 1.4
* Toolbar bookmark button (or Sidebar → Outline → Auto-Bookmark). **1.4:** reads a printed table of contents first
  (titles, levels from numbering/indentation, printed → physical page mapping incl. roman numbers, exact heading
  positions, plus front/back matter left out of the contents); otherwise uses the layout (numbering, Chapter/Appendix
  and Sinhala chapter words such as පරිච්ඡේදය / තෙවන පරිච්ඡේදය, English and Sinhala section names, font sizes),
  rejecting numbered lists, captions, title pages; slide decks get one bookmark per new slide title. English and
  Sinhala. The optional AI review keeps titles in their own language. Review in the editor (rename, Tab/Shift+Tab to change level, delete, add),
  Apply, then Save to write real PDF bookmarks (shown by every PDF reader).

### AI assistant — new in 1.3
* The AI button opens a side panel with **Summary** (brief or detailed; whole document, current page or a page
  range), **Ask** (chat about the document; answers cite pages — click to jump; select text → Ask AI) and
  **Quiz** (5–20 MCQ / short-answer questions with difficulty tags, answers and explanations; copy or save .md).
* Runs **on this device**: an embedded language model (WebLLM, WebGPU) — default Qwen 2.5 1.5B (≈1 GB, downloaded once,
  then offline). Other choices: Llama 3.2 1B/3B, Qwen 2.5 3B, Phi 3.5 mini. Alternatives in AI settings: Chrome's
  built-in Gemini Nano, or a local Ollama / LM Studio server for larger models.
* Nothing is sent to the internet (except the one-time model download, or your own server if you choose one).
* **Sinhala (1.4):** answer-language box (Auto / English / සිංහල); Sinhala prompts, quiz and quick questions;
  cross-language questions (English question on a Sinhala PDF and vice versa); Sinhala-aware word search and token
  budgets. Sinhala-capable models: Qwen 3 1.7B / 4B, Gemma 2 2B on-device; e.g. `gemma3:12b` via Ollama.

### 5. Stylus (Xodo mode)
* With the stylus button in the toolbar switched on (default), **a pen/stylus writes ink at any time** — no need to
  select the Pen tool. Mouse and finger keep scrolling and selecting text as usual.
* The pen's **eraser end** (or eraser button) erases whole strokes.
* Palm rejection: touches are ignored while the pen is down or hovering.
* Smooth ink: every coalesced pen sample is used, drawn with quadratic curves on a low-latency (desynchronised)
  canvas, plus predicted points to cut perceived lag. Strokes are lightly simplified and saved as smooth curves.
* The stylus uses the Pen tool's colour and thickness (shown in the palette as "Stylus" while in Select mode).

### Saving — updated in 1.2: no Save windows
* **Save (Ctrl+S) overwrites the document's own file directly — no File Explorer window.**
  * PDFs opened from your disk (double-clicked, file:// links): saved straight over the original file through the
    small **Ferna save helper** (install once — see below).
  * PDFs opened with Ferna's Open button or dropped onto the window: overwritten directly (no helper needed).
  * Web PDFs: the first Save puts a copy in your **Downloads** folder (e.g. `paper.pdf`, or `paper (1).pdf` if that
    name exists); later Saves overwrite that copy. No window appears unless the browser setting "Ask where to save
    each file before downloading" is on.
* **Save As (Ctrl+Shift+S)** — separate toolbar button — asks for a new name/location; the document then
  continues as that new file.
* Annotations are standard PDF annotations with appearance streams (Acrobat, Chrome, Edge, Xodo, etc.).
* Ctrl+P prints the document with annotations. The last page and zoom are remembered per document.

### Installing the save helper (Windows, once)
Browsers never let an extension write to files on disk by itself; a tiny "native messaging" helper does it on the
extension's behalf. It is a PowerShell script (built into Windows 10/11), needs no administrator rights, and
only accepts requests from Ferna PDF Reader.
1. Open the extension folder → `save-helper`.
2. Double-click **Install-Save-Helper.bat**. (If Windows SmartScreen appears: More info → Run anyway.)
3. Restart the browser. Settings (⋮ → Settings) shows "Direct-save helper: Installed ✓".

It registers itself for Chrome, Brave, Edge and Chromium under your user account and copies itself to
`%LOCALAPPDATA%\FernaPDF\save-helper`. Safety: it only overwrites files that already exist and end in `.pdf`,
writes to a temporary file first and then swaps it in, so a failed save never damages the original.
Remove it with **Uninstall-Save-Helper.bat**.

### Password protection — new in 1.1
* The **lock** button in the toolbar adds, changes or removes a password; the file is saved immediately.
* Encryption: **AES-256** (PDF 2.0 / ISO 32000-2 revision 6 — Acrobat X and later, Chrome, Edge, Firefox,
  Xodo, Foxit, macOS Preview) or **AES-128** for older readers (Acrobat 7+).
* Password-protected PDFs (AES-256, AES-128 or RC4) open after you enter the password, can be annotated, and
  stay protected with the same password when saved. Restrictions set by a document's author (e.g. no printing)
  are kept.
* There is no way to recover a forgotten password.

## Known limitations
* Sinhala in old non-Unicode fonts (FM Abhaya etc.) cannot be read as text; XeLaTeX Sinhala PDFs may keep a few misplaced word spaces.
* AI features need a graphics card with WebGPU (most computers from the last 5 years) and 1–4 GB of free graphics memory, or a local AI server. Small on-device models can make mistakes — check answers against the cited pages.
* Direct saving of PDFs opened from disk needs the save helper (Windows). Without it, use Save As.
* Ink has uniform thickness (pressure is not used), which is what the PDF Ink annotation format stores.
* Text boxes use Helvetica; characters outside Latin-1 are shown on screen but replaced with "?" in the saved PDF.
* PDFs larger than 60 MB open normally, but annotations already inside them are not made editable.
* Chrome's built-in viewer is used for PDFs embedded inside web pages (only full-tab PDFs are redirected).

## Files
* `manifest.json`, `background.js` — extension setup and PDF redirection
* `viewer/` — the reader (`js/viewer.js` layout & rendering, `js/tools.js` input & tools, `js/ink.js` live ink,
  `js/annots.js` annotation geometry, `js/pdfio.js` load/import/save, `js/app.js` UI wiring)
* `viewer/js/ai/` — language-model engine, summaries, Q&A, quiz; `viewer/js/refpopup.js`, `viewer/js/bookmarks.js`, `viewer/js/doctext.js`
* `viewer/js/textsel.js` (text preparation, ink alignment, selection engine), `viewer/js/sinhala.js`, `viewer/js/actualtext.js`
* `lib/` — pdf.js 5.4.296 (Apache-2.0), @cantoo/pdf-lib 2.11.1 (MIT; pdf-lib fork with encryption support), WebLLM 0.2.85 (Apache-2.0)
