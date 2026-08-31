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
npx web-ext lint  --source-dir build/firefox      # 0 errors, 2 warnings
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
Leave empty — none of them apply.

AMO tags are **not** free text. They are a fixed list of 42, which you can
read from the API:

```bash
curl -s https://addons.mozilla.org/api/v5/addons/tags/ | python3 -m json.tool
```

The whole list is aimed at content blockers, downloaders, and site-specific
tools: ad blocker, anti malware, anti tracker, antivirus, chat, container,
content blocker, coupon, dailymotion, dark mode, dndbeyond, download,
facebook, google, image search, mp3, music, password manager, pinterest,
pixiv, privacy, reddit, roblox, scholar, search, security, shopping, social
media, streaming, torrent, translate, twitch, twitter, user scripts, video
converter, video downloader, vpn, wayback machine, whatsapp, word counter,
youtube, zoom.

There is no productivity, time tracking, or focus tag. `privacy` is the only
arguable one and is the same trap as the category: someone browsing that tag
wants a tracker blocker, and a time logger wastes their click. Tags are
optional, so none is the right answer.

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

**Answer: no data collected.** Every box in the form stays unchecked, matching
`data_collection_permissions: { required: ["none"] }` in the manifest.

### This is a hard requirement, and a clean local lint will not catch it

AMO **rejects** a new extension that omits `data_collection_permissions`:

> Error: The "/browser_specific_settings/gecko/data_collection_permissions"
> property is required for all new Firefox extensions

`addons-linter` reports the same condition as a **warning**, at every version —
10.10.0 included. Only AMO knows an extension is new, so this failure cannot
be reproduced locally at all. **A clean `web-ext lint` is necessary, not
sufficient.** The upload is the real test.

Declaring the key sets the version floor: Firefox **140** on desktop, **142**
on Android, both stated in `build-firefox.mjs`. That floor pays for itself —
`runtime.getContexts` ships in 140, so four compatibility warnings disappeared
with it. The build now lints at **0 errors, 2 warnings** (both `innerHTML`,
answered in the reviewer note).

### Why "none" is the honest answer

The add-on has no server, no analytics, and no host permissions — the browser
would refuse an outbound request even if the code made one.

Google Drive backup is the case that deserves the thought, since it plainly
moves data off the device. It is off until switched on, it goes to the user's
own Drive rather than anywhere of ours, and every transfer is one deliberate
click — which is Mozilla's own description of implicit consent. Declaring it as
`required` would show every installer a data-collection warning for a feature
most will never enable, misleading far more people than it informs.

`optional` was the other candidate, and is rejected on purpose: Firefox renders
an optional data permission as a toggle in `about:addons`, and nothing in this
code reads that toggle, so denying it would leave Drive backup working exactly
as before. A control that controls nothing is worse than no control. If it is
ever declared, it ships with a real `permissions.request()` check.

> **This is the one judgment call in the submission with a rejection risk.**
> Mozilla's documentation defines transmission broadly enough to arguably
> cover Drive, but gives no guidance on syncing to a user's own account and
> shows `"none"` only in isolation. The reviewer note states the reasoning
> outright rather than hoping nobody looks. If a reviewer disagrees, the fix
> is to declare `optional` **and** implement the permission check — not to
> declare it alone.

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

The build lints at 0 errors and 2 warnings. Both are assignments to innerHTML
(the insight line and the streak banner in dial.js). Every substituted value
passes through escapeHtml() before interpolation, and the only variable parts
are the user's own category names and integers computed locally.

On data collection, declared as "none": the add-on has no server, no
analytics, and no host permissions, so the browser would refuse an outbound
request even if the code made one.

The one case worth raising ourselves, rather than leaving you to find it: the
"identity" permission drives an optional, off-by-default Google Drive backup.
It uses launchWebAuthFlow into the appDataFolder scope, so the add-on can only
ever see files it created itself. Data goes to the user's own Drive, never to
us, only on a deliberate click, and only after the user turns the feature on.

We read that as implicit consent under the policy rather than as collection.
Declaring it "required" would warn every installer about a feature most will
never enable. Declaring it "optional" would render a toggle in about:addons
that this code does not read — denying it would leave backup working, which
is a worse outcome than not offering the control. If you would rather see it
declared, we will add the optional declaration together with a real
permissions.request() check, so the toggle actually does something.

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
