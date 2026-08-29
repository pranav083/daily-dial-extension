# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version here always matches `manifest.json`.

## [Unreleased]

## [1.7.2] — 2026-08-29

### Changed

- **Switched Google Drive backup's sign-in from `chrome.identity.getAuthToken()`
  to `chrome.identity.launchWebAuthFlow()`.** The former kept failing with a
  bare `400 invalid_request` / "Custom URI scheme is not supported on Chrome
  apps" error — confirmed not a configuration mistake (extension ID matched
  the OAuth client's Application ID exactly, scope was registered, Drive API
  was enabled) but a rough edge of that mechanism under Google Cloud
  Console's current OAuth client setup. `launchWebAuthFlow` talks to
  Google's plain OAuth endpoint directly through a standard "Web
  application"-type client with `https://<extension-id>.chromiumapp.org/` as
  an authorized redirect URI, sidestepping the extension-specific client
  type entirely. `manifest.json` no longer has an `oauth2` key; the client
  id now lives in `drive.js` instead, and token caching moved from Chrome's
  internal cache to an in-memory one in `drive.js`, cleared on every
  restart. Every exported function `dial.js` calls kept the same name and
  signature, so nothing outside `drive.js` changed. Updated
  `docs/GOOGLE_DRIVE_SETUP.md` to match. Verified with a mocked
  `launchWebAuthFlow` + `fetch`: backup, cached-token reuse on a second
  backup, restore, and disconnect all behave correctly.

## [1.7.1] — 2026-08-29

### Fixed

- Wired in a real Google OAuth Client ID for Drive backup, in its own
  dedicated Google Cloud project (kept separate from other, unrelated
  projects so the consent screen correctly identifies itself as "Daily
  Dial" rather than borrowing another app's branding). The consent screen
  is registered under Testing status, so — until a future OAuth
  verification pass — Drive backup only works for Google accounts
  explicitly added as test users, not the general public who may have
  already installed the extension. Everyone else's "Back up to Google
  Drive" click fails the same way it did with the placeholder client id, no
  worse.

## [1.7.0] — 2026-08-29

### Added

- **Optional Google Drive backup** (Settings → Data): sign in with Google to
  back up to, and restore from, a private folder in your own Drive
  (`appDataFolder` — invisible in your regular Drive, unreachable by any
  other app). Off by default; nothing about the extension's other behavior
  changes unless you connect it. Restoring reuses the exact same
  merge/replace confirmation as a local file import. A separate "Delete
  Drive backup" action permanently removes the file itself, since
  disconnecting only revokes access and doesn't touch it. New `identity`
  permission, exercised only once you connect an account; still zero host
  permissions, since the Drive API calls are plain authenticated `fetch()`
  requests. See `docs/GOOGLE_DRIVE_SETUP.md` for the one manual step this
  needs (creating your own OAuth Client ID) and [PRIVACY.md](PRIVACY.md) for
  exactly what this does and doesn't send anywhere.

### Changed

- Rewrote PRIVACY.md, SECURITY.md, README.md, and the Chrome Web Store
  submission doc to accurately describe the new optional Drive backup
  feature — this is the first version where the "no network access" claim
  needed a stated exception rather than being unconditionally true.

### Fixed

- **`npm run package` (and the release workflow) produced a broken zip.**
  Both hardcoded a file list that predated the History feature and never
  picked up `history.js` or `historyLib.js` — every packaged build since
  then was missing modules `dial.js` actually imports, and would have
  failed to load entirely if uploaded to the Web Store or downloaded from a
  GitHub release. Added the missing files plus this version's new
  `drive.js`, and pointed the release workflow at `npm run package` instead
  of maintaining its own separate, driftable copy of the list. Verified by
  building the zip, extracting it, and loading it in a real browser: no
  failed requests, no exceptions.

## [1.6.0] — 2026-08-28

### Added

- **Share as image**: a "Share as image" button next to Copy yesterday
  renders the current day — dial, score, top category, and streak — as a
  1000×560 PNG and saves it. Nothing is uploaded anywhere; the image is
  built and rasterized entirely on-device, the same way CSV/JSON export
  already work, so you can attach it to a message, email, or post however
  you like. Always renders the fixed dark-theme palette, regardless of your
  own theme setting, so a shared image looks the same for everyone who
  receives it.

## [1.5.0] — 2026-08-28

### Added

- **Category aliases**: each category can now have a handful of personal
  alias words, set under it in Settings → Categories (e.g. "leetcode",
  "resume", "mock interview" all linked to Applications). The typed-entry
  box matches on these the same way it already matches a category's own
  name — exact match wins, an ambiguous partial still asks you to be more
  specific — so you can type however you actually think about your day
  while it still paints in that category's one weighted colour. Included
  in JSON backups.

## [1.4.0] — 2026-08-28

### Added

- **Waking hours**, in Settings → Appearance: the "still unlogged" line in
  the day's insight now only counts untracked time inside this window, so a
  normal night's sleep no longer reads as a logging gap. Defaults to
  7:00–23:00; set either end to change it.
- **A toolbar badge** showing today's score (e.g. "+42", "-15") right on the
  extension icon, coloured to match the same good/warning/critical bucket
  the dial's own score badge uses — no new permission, since badge APIs are
  part of `action`, which the extension already declares. Refreshes on
  every change to today's data and every 30 minutes (to catch the midnight
  rollover), and clears once a fresh day starts.
- **A quick dial-layout switcher** right on the Day view, above the dial —
  the same three layouts as Settings → Appearance → Dial layout, one click
  away instead of four. Both controls stay in sync with each other.
- **Weekly goals**, alongside the existing daily ones: Settings → Goals now
  has a second per-category target for a week's total rather than each
  individual day, for things that don't happen daily (e.g. "5h of
  Applications per week"). Shown in a new "This week's goals" panel next to
  "Today's goals".

### Fixed

- The day's insight could count a normal night's sleep as "still unlogged"
  — see Waking hours, above.

## [1.3.0] — 2026-08-28

### Added

- **AM/PM dial modes**: two alternatives to the single 24-hour ring, chosen
  in Settings → Appearance → Dial layout —
  - *Two 12-hour rings, side by side*: AM and PM as two full clock faces at
    once, sized to whatever room the card actually has.
  - *One 12-hour ring, with an AM/PM switch*: a single dial at full size,
    with a small AM/PM toggle above it to flip which half you're looking at.
  Both reuse the same 12-hour engine, so painting, undo/redo, the typed-entry
  box, and the live needle work identically to the 24-hour ring; the needle
  and the centre clock only show on the half that actually contains "now"
  (the other reads `--:--`, rather than both claiming the same time). All
  three layouts share the same underlying day, so switching between them
  never loses or duplicates anything.
- **History view**: a month heatmap (colour by score, with unlogged days
  shown as visibly empty rather than scored 0), a month summary (days
  logged, tracked time, average score/productivity, best day, in-month
  streak), per-category weekly trends as small inline-SVG bar charts, a
  this-week-vs-last-week comparison, and a search over your reflection
  notes. Pure calculation lives in `historyLib.js`; the view is `history.js`.

## [1.2.0] — 2026-08-28

### Added

- **JSON backup export/import**, so "export as backup" is finally a real
  promise. Export writes every day, category, and setting with a
  `schemaVersion`; import is a pure, never-trust-the-file `parseBackup` that
  validates and normalizes everything before it touches storage. Choose
  **Merge** (keep existing days, add missing ones) or **Replace** (wipe and
  restore exactly what's in the file) — Replace requires a second confirming
  click and names how many days it would erase first.
- **CSV import** (`parseCsv`), reading back exactly what `buildCsv` emits,
  matched against your current categories by name.
- A **backup nudge**: a dismissible line in Settings → Data and on the day
  view once it's been over two weeks since your last export and you have at
  least a week of history.
- A **☰ Settings** panel — Categories, Reminders, Goals, Data, Appearance, and
  About in one keyboard-accessible modal (<kbd>Esc</kbd> closes, focus stays
  trapped inside). The day view footer now holds only **Clear day** and
  **☰**; category and reminder editing moved in, unchanged.
- **Streaks** — 🔥 a day counts once it has one painted block, shown
  prominently with your best streak. One missed day per rolling 7 days is
  forgiven as a streak freeze rather than resetting you to zero; a second gap
  in the same window still breaks it. An at-risk hint appears when today
  isn't logged yet and it's getting late.
- **Weekly recap** notification (off by default) — total tracked time,
  productive %, top category, best day, and streak for the week just gone, on
  a day and time you choose.
- **Daily goals** — an optional per-category minutes target, edited in
  Settings → Goals, with progress bars (and a ✓, not just colour, once met)
  in the side panel.
- **Personal bests** in Settings → About: longest streak, best single-day
  score, most productive day.
- Faster entry: number keys <kbd>1</kbd>–<kbd>6</kbd> pick a pen and
  <kbd>0</kbd>/<kbd>E</kbd> picks the eraser (ignored while typing);
  <kbd>⇧⌘Z</kbd> / <kbd>Ctrl+Shift+Z</kbd> redoes an undone stroke; **Copy
  yesterday** fills today from the previous day (confirms before overwriting,
  undoable); a typed entry field reads things like `9-11 deep work` or
  `9pm-11pm study` via a forgiving pure parser (`parseTimeEntry`) that
  understands 24h and 12h clocks, `-`/`to`, partial category names, and short
  overnight ranges.
- **Appearance settings**: theme (System/Light/Dark, applied via
  `data-theme`), 12h/24h time display, and week-start day (Sun/Mon).

### Changed

- CSV export now also records `lastExportAt`, which the backup nudge reads.

## [1.1.0] — 2026-08-28

### Added

- **Undo** — <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd> reverts one stroke at a time, up
  to 30 deep. Entries are tagged with their date, so navigating between days
  can't drop a stroke onto the wrong one. "Clear day" is undoable too.
- Extension version is shown beside the wordmark.
- Unit tests (31) over the pure logic, using node's built-in test runner — no
  test framework dependency.
- ESLint config, `npm run check`, and a `package` script for producing a Web
  Store zip.
- README covering install, data handling, permissions, and layout.

### Changed

- Split all calculation out of `dial.js` into `lib.js` — geometry, stats, CSV,
  and reminder scheduling are now pure functions over plain data, shared between
  the page and the service worker, and covered by tests. `dial.js` keeps only
  DOM and storage work.
- Stored data now passes through validating `normalize*` functions on read;
  a malformed or hand-edited value falls back to a default instead of rendering
  a broken day.
- Reminder times are validated before being saved and scheduled.
- Storage write failures surface as a toast rather than failing silently.
- Pending reflection text is flushed on page unload instead of being lost.

## [1.0.0] — 2026-08-28

Initial version.

### Added

- 24-hour dial: click or drag around the ring to paint blocks of time, with a
  live "now" needle and per-block tooltips.
- Six categories, each with a colour and a weight (`+` productive, `·` neutral,
  `–` distraction). Rename, reweight, or hide them; days store the slot index so
  renaming never rewrites history.
- Daily read: tracked time, productive percentage, longest unbroken focus
  stretch, a weighted score with a plain-language summary, and a per-category
  breakdown including untracked time.
- Seven-day strip for spotting patterns; click any day to revisit or backfill it.
- A one-line "why" note per day.
- Two configurable daily reminders (off by default). The evening one reports how
  much of the day is still unlogged.
- CSV export — one row per block, shaped for a spreadsheet pivot, with a UTF-8
  BOM so Excel reads it correctly.
- Local-only storage: no account, no server, no analytics, and no host
  permissions. `tabs` is deliberately not requested.

[Unreleased]: https://github.com/pranav083/daily-dial-extension/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/pranav083/daily-dial-extension/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/pranav083/daily-dial-extension/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/pranav083/daily-dial-extension/releases/tag/v1.0.0
