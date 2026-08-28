# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version here always matches `manifest.json`.

## [Unreleased]

### Added

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
