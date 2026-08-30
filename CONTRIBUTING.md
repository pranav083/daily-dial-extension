# Contributing

Thanks for taking an interest. This is a small, deliberately simple project, and
contributions of any size are welcome — including "this was confusing" filed as
an issue.

## Getting set up

You need [Node](https://nodejs.org) 20 or newer and Chrome. There is **no build
step**: the repository is the extension.

```bash
git clone https://github.com/pranav083/daily-dial-extension.git
cd daily-dial-extension
npm install        # eslint only — the extension itself has no dependencies
npm run check      # lint + tests + version consistency
```

To run it:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the repository folder
4. After editing, press the reload icon on the extension card

Editing `dial.js`, `dial.css`, or `dial.html` only needs a page refresh.
Changing `manifest.json` or `background.js` needs the extension reloaded.

## The shape of the code

The one structural rule: **calculation goes in `lib.js`, the browser stays out
of it.**

| File | Responsibility |
|---|---|
| `lib.js` | Pure functions over plain data. No DOM, no `chrome.*`. Fully unit tested. |
| `dial.js` | The page — DOM, events, `chrome.storage`. |
| `background.js` | Service worker — alarms, notifications, opening the dial. |
| `drive.js` | Optional Google Drive backup — `chrome.identity` + `fetch`, no DOM. Its request/response shaping (URLs, the multipart body) still lives in `lib.js` and is unit tested; `drive.js` itself is the thin, untested, impure wrapper, same tier as `background.js`. |
| `i18n.js` | The only module that turns a message key into words. `background.js` needs it too and cannot import `dial.js`, which touches the DOM. |
| `suggestions.js` | Pure data: what people do about each observation. Bundled, never fetched. |

If you find yourself wanting to test something, that is usually a sign it
belongs in `lib.js`. Anything that can be expressed as a function from data to
data should live there, where it costs nothing to cover.

## Conventions worth knowing

These exist for reasons that aren't obvious from reading a single line:

- **A day is 96 slots of 15 minutes**, and `-1` (`UNTRACKED`) means unpainted.
- **Angles run clockwise from midnight at the top**, matching a 24-hour clock.
- **Dates are keyed `YYYY-MM-DD` in local time.** Never `toISOString()` — it is
  UTC, and would file a 23:30 entry under the following day for anyone east of
  Greenwich.
- **Categories are six fixed colour slots.** Days store the slot *index*, never
  the name, so renaming a category never rewrites history.
- **Everything read from storage passes through a `normalize*` function.**
  Stored data is user-editable and outlives any given version; treat it as
  untrusted input.
- **A score of `null` means "nothing logged"** and is not the same as `0`, which
  means "productive and wasted time balanced out".
- **The pure modules never return a finished sentence.** `lib.js` cannot reach
  `chrome.i18n`, so it returns `msg("insightTopCategory", cat, dur)` and the UI
  resolves it. Calculation decides what is worth saying, not how it is worded.
- **A translatable message owns a whole sentence, never a fragment.** Gluing
  `"<b>X</b> led the"` to `" the day at <b>Y</b>"` works only because English
  puts the verb in the middle. Hindi and Japanese put it last, and Chinese wants
  the count in the middle of "5 day streak" — none of which a translator can
  produce from pieces, at any price.
- **A count needs a plural family, not a ternary.** `n === 1 ? a : b` fixes the
  catalog at two forms; Russian needs four and Arabic six. Use
  `tp("filledDays", n, [...])` or `plural(...)` from `lib.js`.

## Adding or fixing a translation

Translators edit one flat file and never touch the shipped catalogs:

```bash
$EDITOR translations/es.json               # {"key": "words"} — that is all
node scripts/build-locale.mjs es translations/es.json
npm run check
```

`build-locale.mjs` generates `_locales/es/messages.json`, copying the
`placeholders` block from English. That block maps `$COUNT$` to `$1`, and those
numbers are positional against arguments the *code* passes — not a translator's
decision, and nine chances to renumber one by hand.

Things worth knowing before starting:

- **`_locales/` is generated.** Edit `translations/`, then rebuild.
- **Placeholders move, but never change.** Put `$NAME$` wherever the sentence
  needs it; never rename, translate or drop one.
- **Supply the plural forms your language actually uses**, not English's two.
  `npm run check` derives them from `Intl.PluralRules` and names any that is
  missing; `npm test` then resolves every family at 0/1/2/3/5/11/21/100.
- **Some strings live in controls that cannot grow** — a placeholder inside a
  64px input, the ring toggle, the `h`/`m` suffixes. `check-locales.mjs` holds a
  character budget for those. If it flags one, shorten the string; do not raise
  the budget.
- **Do not translate**: the name "Daily Dial", CSV export headers (a file
  written on one locale has to import on another), OS and product names, or the
  typed-entry examples like `"9-11 deep work"`, which the parser matches
  literally.

## Before opening a pull request

```bash
npm run check
```

That runs ESLint, the test suite, and the version consistency check. CI runs the
same thing on Node 20 and 22, so a green local run should mean a green CI run.

Please also:

- **Add tests for logic changes.** If it lives in `lib.js`, it should have a
  test. The suite uses Node's built-in runner — no framework to learn.
- **Keep the permission set minimal.** Any new entry in `manifest.json`'s
  `permissions` needs a justification in the PR description. `tabs` is
  deliberately not requested (Chrome shows it to users as "read your browsing
  history"); please don't add it without a strong reason.
- **Don't add runtime dependencies.** The extension ships no third-party code,
  which keeps review easy and the download small. `devDependencies` are fine.
- **Don't add network calls beyond the existing, opt-in Google Drive backup.**
  Everything else is local and should stay that way. `drive.js` is the one
  place `fetch` is expected; if you're touching it, make sure the request
  only ever fires after the user has explicitly connected an account, and
  only ever targets `www.googleapis.com` / `accounts.google.com`.
- **Update `CHANGELOG.md`** under `## [Unreleased]`.

## Reporting bugs

Open an issue using the bug report template. The single most useful thing you
can include is what you painted and what you expected versus what you saw — the
dial has enough interacting state (day boundaries, undo, category edits) that
exact steps matter.

If a bug involves your logged data, please don't paste it — a CSV export is
personal. Describing the shape ("three blocks, one crossing midnight") is
plenty.

## Suggesting features

**The job:** help you see where your time actually went — including the parts no
software can see — in your own words, and decide what to change.

**Not the job:** blocking, enforcing, capturing automatically, managing tasks,
being a calendar, being a coach.

That second list isn't modesty, it's arithmetic. Blocking is solved by
SelfControl, Cold Turkey and Freedom. Automatic capture is solved by RescueTime
and ActivityWatch — and is the thing this project deliberately rejects, since
none of them can see a printed textbook or an hour of thinking. Habit chains,
Pomodoro timers and task managers all have well-funded incumbents with nothing
else to do. Rebuilding any of them means competing badly at someone else's
problem instead of well at ours.

What is genuinely unsolved, and therefore worth our time: **manual logging of
all time including the offline parts**, a **visual whole-day artifact** you
recognise at a glance, **local-first with no account**, and — rarest of the
four — **narrative and measurement on the same object**. Journalling apps have
the narrative without the numbers; time trackers have the numbers and can't see
your afternoon away from the keyboard.

The pattern-detection feature sits right on that line, so it has an explicit
rule: **Daily Dial notices and names the pattern, then hands off to tools that
already solve the doing.** It is a pointer, never the intervention. The drift is
easy to picture — *"we already detect rising distraction, why not add a block
button?"* — and the moment that lands, this project is maintaining a blocker.
Suggestions live in `suggestions.js` as bundled, static data for the same
reason: fetching them would end the "makes no network requests" guarantee,
which is the strongest claim the project has.

Things that make logging faster or the day clearer are very welcome. Things that
make it a general-purpose calendar, a project tracker, or a cloud service are
probably a different project.

Two known constraints that shape what's feasible:

- **Notifications only fire while Chrome is running.** A reminder system that
  works when the browser is closed needs a native app, not an extension.
- **Storage is per-browser-profile.** Cross-device sync would mean
  `chrome.storage.sync` (limited quota) or a server (which the project avoids).

## Releasing

Maintainers only:

1. Move `## [Unreleased]` entries into a new version section in `CHANGELOG.md`
2. Bump the version in **both** `manifest.json` and `package.json`
3. `npm run check` — the version check will fail if these disagree
4. Commit, then `git tag -a vX.Y.Z -m "..."` and push the tag
5. CI builds the zip and attaches it to the GitHub release

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
