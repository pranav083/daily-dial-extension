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

The project has a deliberately narrow scope: log a day quickly, and see whether
the time went where you meant it to. Things that make that faster or clearer are
very welcome. Things that make it a general-purpose calendar, a project tracker,
or a cloud service are probably a different project.

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
