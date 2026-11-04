# Ferna Sundaree

A security-hardened browser for Windows 10/11 and Linux with **Ferna Tabs**, **Ferna PDF Reader** and
**Ferna Screenshots** built in. Built on Electron 45 (Chromium 156). Version 0.6.9.

## What it does

| Requirement | How |
| --- | --- |
| Hide/unhide the tab bar | `Ctrl+Shift+H`; while hidden, rest the pointer on the window edge to see it |
| Hide/unhide the bookmarks bar | `Ctrl+Shift+B` |
| Tab bar horizontal or vertical | Top, left or right (`Ctrl+Shift+,` cycles); vertical bar resizes and collapses to icons (`Ctrl+Shift+\`) |
| Tabs arranged as in Ferna Tabs | Workspaces, common bar (folder-aware, account badges) and pinned sites drive the tab strip; `Alt+Shift+.` / `,` rotate workspaces. Workspaces show as icons (emoji, letters or an uploaded picture; names optional). The filter button on the workspaces bar (`Alt+Shift+P`) shows only workspaces, favourites (common bar) and pinned tabs. Each tab has ☆ (add to common bar, `Alt+Shift+S`) and pin (pin in the current workspace, or in All tabs when “All” is selected, `Alt+S`) at its left and × at its right; also in the tab and page right-click menus. Drag a tab onto the common bar or the pinned area to add it there. PDFs (web or local) can be pinned and put on the common bar (tab menu, right-click in the reader, or the buttons); Settings → Workspaces pins an address, a file or a whole folder (`C:\Notes\`), and files opened from a pinned folder join that workspace |
| Current tab stands out | The current tab has a mark in the workspace or accent colour (top edge, or left edge for vertical tabs), a bold title and, on dark or black bars, a lighter background; colours are adjusted so the mark reaches 3:1 contrast on every theme |
| Site icons kept | Each site's icon is kept on the PC (encrypted with the profile, as history is), so sleeping tabs, pinned sites and common-bar pages keep their icon in colour when not loaded and after a restart; private windows keep none; cleared with history |
| Recently used tab | `Ctrl+Tab` goes back to the tab you used before; keep holding `Ctrl` and press `Tab` again to go further back (`Ctrl+PageDown`/`PageUp` keep strip order) |
| See every open page | Tab Overview `Ctrl+Shift+A` (live thumbnails, grouped by workspace); Ferna Tabs list at the pointer `Alt+Shift+L`; command palette `Ctrl+K` |
| Ferna PDF Reader | Opens every PDF (any address); Save overwrites local files directly — the browser plays the save helper |
| Ferna Screenshots | `Alt+Shift+V` visible, `F` entire page (one capture, no stitching), `R` region across the whole page, `E` element; opens in the Screenshots editor |
| Chrome extensions and themes | “Add to Chrome” works on chromewebstore.google.com; install .crx (signature verified) or .zip; load unpacked folders; toolbar buttons, popups, badges, pin from the puzzle menu; Chrome themes recolour the bars and new tab page. Permissions are shown before every install |
| No Windows title bar | Minimise / maximise / close sit on the tab bar (tabs on top) or the toolbar (vertical tabs: one bar, as in Brave); `Ctrl+Shift+H` hides them with the tab bar |
| Zoom (as Zoom Page WE) | Full or text-only zoom, per site or per tab, zoom levels or fixed steps, AutoFit, minimum font size, line spacing; panel `Alt+Z`, `Ctrl+Alt+9` type, `Ctrl+Alt+8` AutoFit, `Ctrl+Alt+7` font reset |
| Standard Windows package | `FernaSundaree-x.y.z-x64.msi` (Windows Installer: Program Files, Start menu, Apps & features, browser registration, in-place upgrades), plus Setup exe, portable exe and MSIX for the Store |
| Picture-in-Picture | As Google's PiP extension: `Alt+P`, the toolbar button or right-click a video pops the largest video into Chromium's floating, always-on-top window with its own controls; works on players that set disablePictureInPicture and in embedded frames |
| Text selection menu | As SelectON: select text and a small bar offers Copy, Search (your search engine, new tab) and, for an address, Open. Isolated from the page; Settings → Features |
| Bookmarks popup | As Ease Bookmarks: toolbar button / `Ctrl+Shift+Y`, and inside the Ferna Tabs list (`Alt+B`). Folders with breadcrumb, search with folder path, open (new tab / this tab / background), add this page, new folder, rename, delete with undo, drag to reorder or into folders. Bookmarks now have real folders; imports keep them. A default folder (Settings → General, or right-click a bar folder) receives new bookmarks and is where the popup opens, as in Ferna Tabs |
| Equalizer + Auto-EQ | 10 bands (31 Hz–16 kHz), presets (Pop, Rock, Classical, Jazz, Electronic, Hip-hop, Acoustic, Speech, Bass/Treble Boost, Vocal), manual sliders, limiter. Auto-EQ blends page metadata with live spectral features (band shares, centroid, flatness, onset rate, low-energy-frame ratio) in a rule-based classifier with hysteresis; `Alt+Q` |
| Ad blocking | EasyList + uBlock Origin lists: network blocking, cosmetic hiding (CSS inserted by the browser), optional uBlock scriptlets (off by default since 0.6.5 — some broke Facebook and YouTube; when on they run once as each page starts; your own `+js` rules always apply); stale lists refresh 90 s after start-up so the first pages are not slowed; YouTube: ad schedule pruned from player data at document start, ad slots hidden, leftover ads muted and skipped; a video the player stops by itself in its first seconds (first load, a clicked video, Next/Previous) is started again through the player's own button; only a pause you make on the video (click on it or its play button, Space, K, media key) is kept; "ad-showing" without ad controls never skips the real video; pop-ups opened without a click in the last 5 s are blocked (listed under the shield) |
| Safe browsing | Red "Deceptive site ahead" / "Dangerous site ahead" warning before phishing (PhishTank, OpenPhish via the Phishing URL Blocklist) and malware (abuse.ch URLhaus) sites; downloads and page resources from them blocked. Lists fetched every 12 h, checked on this PC — no address is sent anywhere. "Visit anyway" lasts until restart |
| My filters, element picker | Your own uBlock/ABP rules (exceptions win over the lists), extra list subscriptions by URL; right-click → "Hide this element…" or the shield button picks an element, Wider/Narrower, and saves `site##selector` |
| Automatic updates | Checks GitHub and the Ferna update mirror every 6 h (the newest signed release wins); installs only an update whose manifest is signed with Ferna's own Ed25519 key (public key built in) and whose installer matches the signed SHA-256; no downgrades. MSI → msiexec, Setup → silent update, Portable → new exe saved to Downloads. No paid certificate needed |
| Privacy | Third-party cookies blocked by Chromium itself (headers and document.cookie in frames), tracking tags stripped from links, Global Privacy Control, fingerprinting noise (canvas, audio, WebGL, hardware buckets), WebRTC limited to the public interface |
| Anti-phishing | Look-alike address warning ("Did you mean paypal.com?") for imitations of popular sites, Sri Lankan banks and your bookmarks; password-field warning on unencrypted or first-visit pages |
| Hardening | Microsoft Defender scan of finished downloads; extensions paused when an update asks for more access; optional enhanced security mode (no JIT); strict ZIP reader for all extension packages; ASAR integrity check in release builds; dependency audit and Dependabot in CI |
| Address bar | Copy and clear buttons in the address box; right-click for Undo, Cut, Copy, Paste, Paste and go, Select all (the same menu in every text box of the browser's own pages); a PDF tab shows the PDF's own address |
| Ferna Tabs search fallback | Tabs first, then bookmarks; an address offers "Go to", other text "Search with <engine>" (top when nothing matched) — Enter new tab, Shift+Enter this tab |
| Bookmark manager | Multi-select across folders (checkboxes, Shift-range, `Ctrl+A`, select all shown), delete with a count confirmation and Undo, bulk move / tags / read status / link check / export (JSON or HTML); broken-link finder with "Delete all broken"; duplicates merged in bulk (tags kept); filters by tag, site, date added and read status; imports HTML from any browser, Chrome/Edge/Brave `Bookmarks` JSON, Firefox `.json` backups and Ferna JSON; automatic JSON backups (daily by default) with merge or full restore; Reading list |
| Split view | Two tabs side by side (`Alt+Shift+D`, tab menu, right-click the split button to pick); drag the divider; click a half to make it active |
| Link preview | `Shift`+click a link (or right-click → Preview link): the page floats over the current one; keep it as a tab, in split view or a new window |
| Sleeping tabs, task manager | Unused tabs unload after a set time (never audio, PiP or "Keep loaded" tabs); `Shift+Esc` shows memory and CPU per tab with Sleep / End process / Close |
| Media controls | `Alt+M` lists everything playing in every window: play/pause, ±10 s, mute, PiP, go to tab. A playing video moves to PiP when you switch tabs and back when you return |
| Passwords and autofill | Encrypted vault (DPAPI); save/update bubble on sign-in; list under the field fills on a real click; strong password suggestions; checkup for weak, reused and leaked passwords (k-anonymity range check, optional); warning when a saved password is typed into a never-visited site; addresses and cards (no CVV; Windows Hello before filling a card); CSV import from Chrome, Edge, Firefox, Safari, Bitwarden, LastPass, 1Password; passkeys through Windows Hello |
| AI assistant | Side panel (`Alt+A`): Ollama or LM Studio on this PC (private), or your own Anthropic/OpenAI key; reads the page, other tabs (`@`), selections; skills (`/summarize`, `/quiz`, `/sinhala` …, editable); summarise, explain, translate from the right-click and selection menus |
| Reading and translation | Reading mode `F9` (Mozilla Readability; size, font, width, light/sepia/dark), read aloud `Ctrl+Shift+U` with Windows voices and paragraph highlight; translate page `Alt+Shift+T` or selection with Google Translate or privately with your AI; spell-check languages |
| Identities | Workspaces with separate logins (own cookie jar, badge in the address bar); profiles (`--profile=<name>`, own shortcut); private window with Tor (uses Tor Browser or the Tor service running on the PC) |
| Sync without an account | One AES-256-GCM file (scrypt key from your passphrase) in a folder OneDrive / Google Drive / Dropbox already syncs; three-way merge of bookmarks, workspaces, settings, optionally passwords and history |
| Web apps | Menu → Install this site as an app: own window, icon, taskbar button and Start-menu entry |
| For organisations | Group Policy under `Software\Policies\FernaSundaree` (ADMX in `build/policy/`): settings locked and greyed out, features turned off |
| Parental controls | Parent password; blocks adult sites (optionally gambling, social media, your own list) on every page and resource, in every window and profile; SafeSearch forced on Google, Bing, DuckDuckGo, Yahoo, Brave Search, Startpage and YouTube Restricted Mode; private/Tor windows, developer tools and extensions need the password; "Ask a parent" on the block page |
| Secure exam mode | Instructor sets the exam address, allowed sites, time limit, copy/paste, spell check and an invigilator password (or saves a `.fernaexam` file with only its hash). Full-screen, always-on-top, cannot be closed or captured; no tabs, address bar, menu, new windows, devtools or downloads; other sites blocked; leaving the window is undone and logged; ends by time or password (`Ctrl+Alt+Shift+E`); log saved |
| Context-aware themes | Workspace colours tint the bars and accent; adaptive colour from the site you are on; dark mode on a schedule; all off in exam mode |
| Equalizer genres and presets | 28 presets incl. Reggae, Dub, Synthwave, Bossa Nova, Afrobeats, Bhangra, Ambient, Baila, Metal, Blues, Country, Latin, K-pop, Lo-fi, Indian classical, Gospel (all in Auto-EQ); save, use and delete your own named presets |
| High-contrast toolbar | Icon and text colours chosen against the actual bar colour to keep ≥ 4.5 : 1 (WCAG AA) with any theme; solid highlight and glow for buttons that are on; outlined hover and focus |
| Also | Bookmarks (import/export), history, downloads, private windows, find, zoom per site, print, session restore, focus mode, tracker/ad/malware blocking, HTTPS-first, secure DNS, re-assignable shortcuts |

## Security model (short)

- Every web page runs in Chromium's OS sandbox with site isolation; no Node.js and no Ferna IPC. The
  extension libraries add a preload to web-session frames that only acts on `chrome-extension://` pages
  and chromewebstore.google.com; ordinary pages see no bridge (tested). The YouTube preload exposes
  nothing and acts only on YouTube. Page tools (selection menu, equalizer, YouTube watcher) run in
  isolated worlds with no channel back to the browser.
- Extensions are installed only after the user confirms their permissions; .crx signatures are verified;
  private windows run without extensions.
- The browser UI and Ferna pages live on a private `ferna://` scheme in a separate session; a page
  can never be navigated into a view that has Ferna's preload (the view is swapped instead).
- One IPC channel; each command lists which Ferna page may call it and the type of every argument.
- Deny-by-default permissions, HTTPS-first with an interstitial, DNS over HTTPS, network-level
  blocking (EasyList, EasyPrivacy, URLhaus), risky-download warnings and Mark of the Web.
- Bookmarks, history and session encrypted with Windows DPAPI; private windows write nothing.
- Electron fuses: RunAsNode, NODE_OPTIONS and inspector flags off; cookie encryption on; app
  loads only from its ASAR.

"Military grade" is not a certification. Known gaps versus Chrome: Chromium fixes reach Electron a
few days later (ship patch builds within 7 days), no Google Safe Browsing (local phishing/malware lists instead),
Widevine DRM only in the separate Streaming edition (castLabs Electron, one version behind; built by
`.github/workflows/streaming-edition.yml` once a free castLabs EVS account is added), ASAR integrity validation only in CI
release builds, builds are not Authenticode-signed until the free SignPath Foundation signing is set up (secrets
`SIGNPATH_API_TOKEN`, `SIGNPATH_ORGANIZATION_ID`; Windows shows "unknown publisher" until then), no phone apps, no live
captions or casting (Chromium features Electron does not include), and no independent security audit. See the design
specification for the full threat model.

## Linux

Packages for x64 (Intel/AMD) and ARM64, built from the same code as the Windows version. Tested on
Ubuntu 24.04; any distribution with glibc 2.28 or later and a recent desktop (GNOME, KDE Plasma,
Xfce, Cinnamon) should work, on X11 or Wayland.

| Package | Install | Updates |
|---|---|---|
| `.deb` (Ubuntu, Debian, Mint, Pop!_OS) — **recommended** | `sudo apt install ./FernaSundaree-0.6.1-x64.deb` | Downloaded, verified, then `pkexec dpkg -i` (asks for your password) |
| `.rpm` (Fedora, RHEL, openSUSE) | `sudo dnf install ./FernaSundaree-0.6.1-x64.rpm` | Same, with `pkexec rpm -U` |
| `.AppImage` (any distribution, no install) | `chmod +x FernaSundaree-0.6.1-x64.AppImage` and run it | The verified new AppImage replaces the file, then restarts |
| `.tar.gz` | Unpack anywhere, run `ferna-sundaree` | Saved to Downloads for you to unpack |

Use the `-arm64` files on ARM computers (Raspberry Pi 4/5 with a 64-bit OS, Snapdragon laptops). Updates
are signed with the same Ferna key as on Windows and refused if the signature or checksum is wrong.

**Sandbox and AppImage on Ubuntu 23.10+.** Ubuntu restricts unprivileged user namespaces, which Chromium's
sandbox uses. The `.deb` installs an AppArmor profile so the sandbox works; an AppImage cannot, and would have
to run without the sandbox. Ferna Sundaree never turns the sandbox off by itself, so on Ubuntu use the `.deb`.
(The `.deb` and `.rpm` also set up `chrome-sandbox` for older kernels.)

What differs from Windows:

| Windows | Linux |
|---|---|
| Profile, history and vault encryption with DPAPI | Your login keyring (GNOME Keyring or KWallet, via libsecret). With no keyring, the browser says the vault is not encrypted. |
| Windows Hello before showing a password | Your account password through polkit (`pkexec`) |
| Passkeys in Windows Hello | USB/NFC security keys and phones (QR code). Recent systemd (244+) lets you use USB keys out of the box; on older systems install the udev rules (`sudo apt install libu2f-udev`) |
| Microsoft Defender scans downloads | ClamAV, if installed: `sudo apt install clamav clamav-daemon` (uses `clamdscan`, else `clamscan`) |
| Group Policy (ADMX) | JSON files in `/etc/ferna-sundaree/policies/managed/`, owned by root and not writable by others; see `resources/policy/README.txt` |
| Start-menu shortcuts for profiles and site apps | `.desktop` launchers in `~/.local/share/applications` and on the desktop |
| Settings → Default apps | Settings → Make default runs `xdg-settings` and `xdg-mime` (browser, links and PDFs) |
| Exam mode hides the window from screenshots | Not possible on Linux; disable capture apps on exam computers. Kiosk, always-on-top, refocus and the password still apply. |
| Read aloud with Windows voices | speech-dispatcher voices (`sudo apt install speech-dispatcher espeak-ng`) |

## Build

```
npm ci
npm test            # unit tests
npm run test:e2e    # end-to-end under Xvfb (Linux), screenshots in test/e2e/out
npm start           # run from source
npm run dist        # on Windows: Setup exe, MSI (WiX) and portable exe in dist/
npm run dist:msix   # on Windows: MSIX package for the Microsoft Store
npm run dist:msi-linux  # on Linux: MSI from dist/win-unpacked with msitools (wixl)
npx electron-builder --linux --x64 --arm64 --publish never && node tools/linux-names.js
                    # on Linux: AppImage, .deb, .rpm (needs rpmbuild: sudo apt install rpm), .tar.gz
node tools/make-crx.js <folder> <out.crx> [key.pem]   # pack and sign an extension
```

Update signing (once): `node tools/update-key.js` creates `update-signing-key.pem` (keep it secret and backed
up; never commit it) and writes the public key into `src/main/update-key.js`. Put the whole PEM text into the
GitHub secret `UPDATE_SIGNING_KEY`. The release workflow then runs `node tools/sign-update.js`, which writes
`update.json` + `update.json.sig`; installed copies accept only updates signed with that key.

Weekly Chromium security updates: `.github/workflows/chromium-patches.yml` checks every Thursday for a new
Electron patch, pins it, bumps the patch version, runs every test, builds, signs and publishes (after your one-click
approval, or automatically), and copies the release to an optional S3/R2 update mirror. Set-up:
[docs/AUTOMATIC-SECURITY-UPDATES.md](docs/AUTOMATIC-SECURITY-UPDATES.md).

Release: push a tag `vX.Y.Z`; the workflow tests on Ubuntu (sandbox on), builds the Windows installers on
`windows-latest` and the Linux packages on `ubuntu-latest` (each smoke-tested), then one job signs a single
`update.json` covering every file and attaches everything with `SHA256SUMS.txt` to the release.

## Layout

```
src/main/       main process: windows, tabs, workspaces, IPC gate, network policy, capture, storage
src/preload/    the single preload used by Ferna pages only
src/pages/      browser UI, overlay (Tab Overview, list at pointer, palette, region picker), internal pages
src/features/   pdf-reader/ (Ferna PDF Reader 1.6.0 + bridge), screenshots/ (Ferna Screenshots 1.0.0 + bridge), tabs/
build/          icon, installer registration (Default apps)
test/           unit and end-to-end tests, fixtures
```

Profile data: `%LOCALAPPDATA%\FernaSundaree\Profiles\Default` (override with `FERNA_SUNDAREE_DATA`).

MIT licence · Ferna Software Solutions
