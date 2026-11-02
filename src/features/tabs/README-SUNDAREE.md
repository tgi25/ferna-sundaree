# Ferna Tabs inside Ferna Sundaree

Ferna Sundaree owns its tab strip, so Ferna Tabs is not loaded as an extension. Its rules are
reimplemented natively in `src/main/workspaces.js` (workspaces own their pinned sites' hosts plus
host rules, sub-domains count, a per-tab override wins; the common bar stores folders) and its
list-at-pointer is drawn by the browser's overlay (`src/pages/overlay`). Ferna Tabs export files
import through Settings → Workspaces. `manifest.json` and `README.md` here record the 1.15.0
version the behaviour follows.
