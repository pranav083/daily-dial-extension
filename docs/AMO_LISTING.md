# Firefox Add-ons (AMO) submission

Everything addons.mozilla.org asks for, written out and ready to paste, in
roughly the order the submission flow presents it.

Unlike the Chrome Web Store there is **no registration fee**. Review is
usually faster too, and this add-on is the easy case: no host permissions, no
content scripts, no remote code, no minification.

The Chrome listing lives in `STORE_LISTING.md`. This file only covers what
differs — where a field is identical, it says so rather than repeating it.

---

## 0. Before you upload — the one thing that is not copy-paste

Google Drive backup will fail on Firefox until you do this, and it will fail
*silently from the user's side* (they click Connect, a window opens, Google
refuses with `redirect_uri_mismatch`).

The two browsers hand Google different redirect URIs:

| | |
|---|---|
| Chrome | `https://mgcjgngceajnmfhkifccaoeccbmfikhn.chromiumapp.org/` |
| Firefox | `https://<sha1 of the add-on id>.extensions.allizom.org/` |

For the id `daily-dial@pranav083.github.io` that second one is:

```
https://ee65ceb082b4c14a52275f736845ebda729b6eb0.extensions.allizom.org/
```

Run `npm run firefox:redirect` to print it, or pass a different id as an
argument if you registered one. The script self-checks its derivation against
Firefox's own test vector, so it fails loudly rather than printing a
plausible-looking URI that Google will reject.

**Add it to the *same* Google OAuth client as the Chrome one** — Authorized
redirect URIs is a list; this is an addition, not a replacement. Console:
<https://console.cloud.google.com/apis/credentials>

**Status: registered and verified** on client
`752491211125-e7flupmel0jlpds3cdvo78rjfldrdr9n` (the one hardcoded in
`drive.js` — Google validates the URI against that specific client, so it had
to be that one and not the other client in the same project).

To re-check it later without a browser, request the auth URL and follow the
redirects. Note that Google **defers** redirect validation past the sign-in
hop, so a naive request returns 302 for anything at all — including a URI that
was never registered. Follow redirects, and always test a deliberately bogus
URI alongside the real one: if the bogus one does not report
`redirect_uri_mismatch`, the test is not discriminating and proves nothing.

> This is the reason the add-on id is pinned in `scripts/build-firefox.mjs`.
> Firefox derives the subdomain from the id, so an unpinned id produces a new
> redirect URI on every temporary install and no registration can ever match.
> If you change the id, this URI changes with it and Drive breaks.

---

## 1. Package

```bash
npm run check           # never upload something that hasn't passed
npm run build:firefox   # build/firefox/
npx web-ext lint  --source-dir build/firefox      # must be 0 errors
npx web-ext build --source-dir build/firefox --artifacts-dir build/firefox-dist
```

That produces `build/firefox-dist/daily_dial_time_tracker_focus-<version>.zip`.

Upload it under **"On this site"** (listed) so it appears on AMO and
auto-updates. Self-distribution is the other option and is not what you want
here.

### Source code submission

AMO requires a source upload only when the submitted code has been through a
minifier, obfuscator, transpiler, or bundler. **None applies here** — every
file in the zip is byte-identical to the repo except `manifest.json`, which
the build script rewrites by hand. Answer *no*, and say why in the reviewer
notes below.

---

## 2. Listing fields

### Name
```
Daily Dial – Time Tracker & Focus
```

### Summary
*(AMO allows 250 characters, against Chrome's 132 — so this one can breathe)*
```
Paint your day on a 24-hour dial and see where the time really went. One drag logs an hour; a whole day takes about ten seconds. No account, no server, no analytics — everything stays in your browser.
```

### Description

Paste this as-is. It is the Chrome description with the three edits AMO needs
already applied: every "Chrome" is now "Firefox", the per-bullet emoji are
gone (they read as native on the Web Store and as noise here), and it is plain
text — AMO renders no Markdown, only a small HTML subset (`<b> <i> <a> <ul>
<li> <br>`), so blank lines between paragraphs is the safe form.

```
Paint your day on a 24-hour dial. Pick a category, drag across the hours — a full day logged in about 10 seconds.

WHY ANOTHER TIME TRACKER

Forms are slow. A category, a date, a start, an end, eight times a day. Nobody keeps that up.

Auto-trackers miss real life. No interview, no textbook, no conversation — just window titles. They can tell you that you had Firefox open. They cannot tell you what you were doing.

Daily Dial asks for one drag. Fast enough to do every day, honest enough to catch everything.

HOW IT WORKS

• Drag around the ring to paint — or press 1-6 for a pen, 0 or E for the eraser
• Type it instead: "9-11 deep work" or "9pm-11pm study"
• Ctrl+Z / Cmd+Z undoes one stroke at a time, 30 deep — Ctrl+Shift+Z redoes
• Ctrl+Shift+D / Cmd+Shift+D opens the dial from anywhere
• Copy yesterday into today in one click
• A live needle always marks "now"
• Jump days with the arrows, or click any bar in the 7-day strip

WAS TODAY ACTUALLY PRODUCTIVE?

• A daily score, weighted by your own categories
• The share of tracked time that was productive
• Your longest unbroken focus streak
• A plain-language read: what led, what dragged, blocks or fragments
• Untracked time is shown, never hidden — no quietly flattered numbers

STAY WITH IT

• A streak counter that forgives one missed day a week, so one slip doesn't cost you a month
• Optional daily goals per category, with a progress bar
• An optional weekly recap: time tracked, top category, best day, streak

MADE YOUR OWN

Six category slots — rename them, reweight them, hide the ones you don't use.
Defaults: Deep Work, Applications, Study, Admin, Break, Distraction.

Renaming is safe. Days store the slot, never the name, so your history never rewrites itself behind you.

IN YOUR LANGUAGE

English, العربية, 中文, Français, Deutsch, हिन्दी, 日本語, Português (BR), Русский, Español.

It follows your browser's language, or you can pick one yourself in Settings. Arabic reads right to left, layout and all. Only the app is translated — your own notes and category names stay exactly as you wrote them.

GENTLE REMINDERS

Two optional daily nudges at times you choose, and an optional weekly recap. All of it is off until you turn it on.

YOUR DATA STAYS YOURS

• No account with us, and no sign-in required
• No server of ours — by default there is nowhere for your data to go
• No analytics, no telemetry, no tracking
• No host permissions, so Firefox itself will not let it contact websites even if the code tried
• No content scripts — it never touches your other tabs
• No third-party code, and no "tabs" permission (that one reads as "read your browsing history", and a time logger has no business asking)
• Export to CSV for Excel or Sheets, or a full JSON backup, restored by merge or replace
• "Share as image" renders your day as a PNG, built entirely on your own device

OPTIONAL: BACK UP TO YOUR OWN GOOGLE DRIVE

The one exception to "nothing leaves your device", and it is off until you switch it on.

Sign in with Google and the backup goes to a private, app-only folder in your own Drive. It is invisible in your regular Drive and unreachable by any other app, because the add-on can only ever see files it created itself. Disconnect at any time to revoke access, or delete the file permanently with one more click. Nothing syncs in the background — every backup and every restore is a click you make.

OPEN SOURCE

MIT licensed. A few small files of plain, unminified JavaScript — readable in an afternoon.

https://github.com/pranav083/daily-dial-extension

WORTH KNOWING

• Reminders only fire while Firefox is running
• There is no automatic cross-device sync; Google Drive backup covers manual restore instead
• Blocks round to the nearest 15 minutes
• It is manual on purpose. You have to remember to log. That is the trade, and it is the reason the data is worth anything.
```

### Categories

AMO has no "Productivity" category — the full list is Alerts & Updates,
Appearance, Bookmarks, Download Management, Feeds News & Blogging, Games &
Entertainment, Language Support, Other, Photos Music & Videos, Privacy &
Security, Search Tools, Shopping, Social & Communication, Tabs, Web
Development.

Pick **Other**. It is the only accurate one.

*Privacy & Security is tempting and would get more traffic, but this is a time
tracker that happens to be private, not a privacy tool. Miscategorising is
the kind of small dishonesty the whole listing is arguing against.*

### Tags

AMO tags are free text, up to 10. Suggested:

```
time-tracking, productivity, focus, deep-work, time-management,
privacy, local-first, no-tracking, study, pomodoro-alternative
```

### Support site
```
https://github.com/pranav083/daily-dial-extension/issues
```

### Support email

Your own. AMO shows it publicly, so use one you don't mind published.

### Homepage
```
https://pranav083.github.io/daily-dial-extension/
```

### Privacy policy
```
https://pranav083.github.io/daily-dial-extension/privacy.html
```
AMO also accepts pasted text; the URL is better, since it stays current.

### License
```
MIT
```
Pick it from AMO's dropdown rather than pasting — it links the canonical text.

### "This add-on is experimental"
Leave **unchecked**. It has been in the Web Store for months.

### Screenshots

Reuse `docs/store/screenshot-*.png`. AMO has no fixed dimensions (Chrome's
rigid 1280×800 is a Google rule), shows them in a carousel, and lets each
carry a caption — the same three captions from `STORE_LISTING.md` work
unchanged.

---

## 3. Data collection

AMO asks this directly in the submission form, as a set of checkboxes.

**Answer: no data collected.** Every box stays unchecked.

The one thing worth being ready to explain, if a reviewer asks: Google Drive
backup is not collection. It is the user sending their own data to their own
Drive, into an app-private folder (`appDataFolder`), on an explicit click,
with the feature off until they turn it on. Nothing reaches any server of
ours — there is no server of ours.

> The manifest deliberately does **not** declare
> `data_collection_permissions`. That key needs a newer Firefox than the
> `strict_min_version: "121.0"` this build targets, so declaring it trades one
> lint warning for two and narrows compatibility for nothing. The form is the
> right place to answer, and the answer is "none".

---

## 4. Notes to the reviewer

Paste this. It answers, up front, the three things a reviewer would otherwise
have to work out for themselves.

```
Source: https://github.com/pranav083/daily-dial-extension (MIT)

No build step in the usual sense. Every file in this package is
byte-identical to the repository except manifest.json, which
scripts/build-firefox.mjs rewrites to swap the service worker for an event
page and to add browser_specific_settings. Nothing is minified, bundled, or
transpiled. There is no remote code and there are no runtime dependencies.

On the three lint warnings:

- runtime.getContexts is called only after checking it exists, with a
  fallback to extension.getViews. The linter cannot see a runtime guard.
  Both APIs return only this extension's own pages, so neither needs the
  "tabs" permission — a time logger has no business asking to read browsing
  history.

- Two innerHTML assignments (the insight line in dial.js and the streak
  banner) escape every substituted value through escapeHtml() before
  interpolation. The only variable parts are the user's own category names
  and integers computed locally.

- data_collection_permissions is omitted deliberately; it requires a newer
  Firefox than strict_min_version 121.0. The add-on collects nothing, which
  is answered in the submission form.

The "identity" permission is used for one optional, off-by-default feature:
backing up to the user's own Google Drive, via launchWebAuthFlow into the
appDataFolder scope. It is scoped so the add-on can only see files it
created itself. No other network access exists — there are no host
permissions, so the browser would refuse one anyway.

An unmodified copy of this UI runs at
https://pranav083.github.io/daily-dial-extension/demo/ if it is useful to
try before reading.
```

---

## 5. After it is approved

- [ ] Add the AMO link to `README.md`, `docs/index.md`, and the site header
      next to the Web Store badge.
- [ ] Update `DAILY_DIAL_LAUNCH.md` — "Firefox port" moves out of *worth
      building* and becomes a line in every post, since it roughly doubles
      the addressable audience and r/firefox becomes a place you can post.
- [ ] Test Drive backup on Firefox **once**, end to end, after registering the
      redirect URI. It is the only feature that can break on Firefox alone.

---

## 6. Updating later

Every AMO upload needs a version higher than the last, same as Chrome. The two
stores can sit at different versions without a problem — Firefox does not care
what Chrome is serving. Run `npm run check` first; it verifies `manifest.json`
and `package.json` agree before anything else.
