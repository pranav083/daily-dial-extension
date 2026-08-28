# Daily Dial

A Chrome extension for logging your day on a 24-hour dial. Pick a category, drag
around the ring, and see whether your time went where you meant it to.

Built for a specific problem: most time trackers either make you fill in a form
per entry (too slow to keep up daily) or record your app usage automatically
(which can't see a mock interview, a printed textbook, or thinking). This one
takes ten seconds and records what you actually chose to do.

![The dial](docs/screenshot.png)

## Install

No build step — the repository *is* the extension.

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Pin it to the toolbar; the icon opens the dial

> Chrome derives an unpacked extension's ID from its path, and your data is keyed
> to that ID. **Moving this folder orphans your logged days** — export a CSV
> first if you need to relocate it.

## Using it

| | |
|---|---|
| **Paint** | Pick a category, then click or drag around the ring |
| **Erase** | Select the Eraser pen and drag over a block |
| **Undo** | <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd> — one step per stroke, 30 deep |
| **Past days** | Arrows beside the date, or click a bar in the week strip |
| **Reminders** | Two a day, off by default. Times are yours to set |
| **Export** | CSV — one row per block, shaped for a spreadsheet pivot |

Each category carries a weight: `+` counts toward your daily score, `·` is
neutral, `–` counts against it. The score is
`(productive − distraction) ÷ tracked`, so it measures the *shape* of your day
rather than its length — a well-spent four hours beats a scattered ten.

Rename categories or change their weights under **Edit categories**. Days store
the category slot, not its name, so renaming never rewrites your history.

## Your data

Everything stays in `chrome.storage.local` on this machine. No account, no
server, no analytics, no network access of any kind — the extension requests no
host permissions and runs no content scripts.

Permissions requested, and why:

| Permission | Why |
|---|---|
| `storage` | Save your days, categories, and settings |
| `unlimitedStorage` | Keep years of history without hitting the default quota |
| `alarms` | Fire the two daily reminders |
| `notifications` | Show them |

Notably absent is `tabs`, which Chrome presents to users as *"read your browsing
history"*. The extension tracks its own tab through `chrome.storage.session`
instead.

Data lives in your Chrome profile. It survives restarts and clearing browsing
data, but not deleting the profile or the extension — **export a CSV
periodically** if the history matters to you.

## Development

```bash
npm install     # eslint only; the extension itself has no dependencies
npm test        # 31 unit tests, node's built-in runner
npm run lint
npm run check   # both
npm run package # zip for the Chrome Web Store
```

### Layout

| Path | |
|---|---|
| `manifest.json` | MV3 manifest |
| `dial.html` / `dial.css` | Page shell and styles |
| `dial.js` | Page controller — owns the DOM and `chrome.storage` |
| `lib.js` | All calculation: geometry, stats, CSV, scheduling. No DOM, no `chrome.*` |
| `background.js` | Service worker — reminders and opening the dial |
| `test/lib.test.js` | Unit tests over `lib.js` |
| `fonts/` | Manrope + JetBrains Mono, bundled (MV3's CSP blocks remote fonts) |

The `lib.js` / `dial.js` split is what makes the logic testable: anything that
can be a pure function over plain data lives in `lib.js` and is covered by tests;
`dial.js` is left with wiring that only a browser can exercise.

### Conventions

- A day is 96 slots of 15 minutes; `-1` means untracked
- Angles run clockwise from midnight at the top
- Dates are keyed `YYYY-MM-DD` in **local** time — never `toISOString()`, which
  is UTC and would file a late-evening entry under the wrong day
- Anything read from storage goes through a `normalize*` function first; stored
  data is user-editable and outlives any given version

## License

MIT — see [LICENSE](LICENSE).
