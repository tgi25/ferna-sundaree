# Ferna Equalizer 1.0.0

A Chrome / Edge / Brave extension (Manifest V3) by Ferna Software Solutions: the equalizer of the Ferna Sundaree browser for YouTube and any video or music on the web.

## What it does
* **10 bands** from 31 Hz to 16 kHz, ±12 dB, with a pre-gain and a safety limiter so boosts never clip.
* **28 presets**: Flat, Pop, Rock, Classical, Jazz, Electronic, Hip-hop, Acoustic, Speech, Bass Boost, Treble Boost, Vocal, Reggae, Dub, Synthwave, Bossa Nova, Afrobeats, Bhangra, Ambient, Baila, Metal, Blues, Country, Latin, K-pop, Lo-fi, Indian classical, Gospel.
* **Your presets**: move a slider (Custom), name it, Save preset; rename, delete, export and import them in Settings.
* **Auto-EQ** picks a genre preset for what is playing, from the page (title, description, YouTube's genre) and from the sound (bass/treble balance, spectral centroid and flatness, beats per second, pauses typical of speech), with rules you can read in the code. A new genre must win twice in a row (about 8 s) before the sound changes.
* **Off on a site** with one tick; the preset is shown on the toolbar button; Alt+Shift+Q turns it on or off (keys can be added for Auto-EQ and next preset).

## Install (unpacked)
1. Unzip `ferna-equalizer-1.0.0.zip`. 2. Open `chrome://extensions`, switch on **Developer mode**. 3. **Load unpacked** → the unzipped folder. 4. Pin it from the puzzle-piece menu.

## Limits
* Chrome lets a page's sound be processed only after you have clicked or typed on the page once; a video that starts by itself plays normally until then.
* Players that stream from another site without allowing it (no CORS) cannot be processed; they are left untouched so they keep their sound.
* Browser pages and the Chrome Web Store cannot be changed by extensions.

## Privacy
Sound is processed on your computer with the Web Audio API; nothing is recorded or sent anywhere. No account, no analytics. Permissions: `storage` (your settings and presets), `scripting`, `tabs` and access to web pages (the equalizer runs in the page's players).

MIT licence · © 2026 Ferna Software Solutions
