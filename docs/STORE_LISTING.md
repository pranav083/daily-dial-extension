# Chrome Web Store submission

Everything the Web Store dashboard asks for, written out and ready to paste.
Fields are in roughly the order the dashboard presents them.

**Before you start:** a Chrome Web Store developer account costs a **one-time
$5 USD** registration fee, paid at
<https://chrome.google.com/webstore/devconsole>. Review typically takes a few
days; extensions requesting few permissions (like this one) tend to clear
faster.

---

## 1. Package

Build the upload zip:

```bash
npm run check     # never upload something that hasn't passed
npm run package   # produces daily-dial-v1.2.0.zip
```

The zip contains only what the extension needs to run: `manifest.json`,
`dial.html`, `dial.css`, `dial.js`, `lib.js`, `background.js`, `drive.js`,
`fonts/`, `icons/`, and `LICENSE`. Tests, config, and docs are excluded.

> Each upload needs a version higher than the last. Bump **both**
> `manifest.json` and `package.json`, add a `CHANGELOG.md` section, and run
> `npm run check:version` — it fails if they disagree.

> **Before your first upload with Drive backup enabled:** replace the
> placeholder `CLIENT_ID` near the top of `drive.js` with a real one. See
> `docs/GOOGLE_DRIVE_SETUP.md` — you need the Web Store's assigned extension
> ID first, to register `https://<that-id>.chromiumapp.org/` as an
> authorized redirect URI, which means one initial upload (Drive backup will
> just fail gracefully with the placeholder in place) before you can create
> the OAuth client and do a second upload with the real id.

---

## 2. Store listing

### Extension name
```
Daily Dial – Time Tracker & Focus
```
*("Time tracker" is the high-intent search term; "Focus" pulls the deep-work/study crowd this was originally built for. The app's own UI keeps the plain "Daily Dial" wordmark — this is the Store's search-facing name only.)*

### Summary
*(max 132 characters — this is 119)*
```
🕐 Paint your day on a 24-hour dial and see where the time really went. Local-first, with optional Google Drive backup.
```

### Category
```
Workflow & Planning
```

### Language
```
English (United States)
```

The listing language stays English; the extension itself ships ten locales
(`ar`, `de`, `en`, `es`, `fr`, `hi`, `ja`, `pt-BR`, `ru`, `zh-CN`) and Chrome
picks by browser language. Worth mentioning in the description, since store
search does not surface it on its own.

### Detailed description

```
🕐 Paint your day on a 24-hour dial. Pick a category, drag across the hours — a full day logged in about 10 seconds.

🤔 WHY ANOTHER TIME TRACKER
📝 Forms are slow — a category, date, start, end, times eight blocks a day. Nobody keeps that up.
🤖 Auto-trackers miss real life — no interview, no textbook, no conversation, just window titles.
✅ Daily Dial: one drag. Fast enough for every day, honest enough to catch everything.

✍️ HOW IT WORKS
🖱️ Drag around the ring to paint — or press 1-9 for a pen, 0/E for the eraser
⌨️ Type it instead: "9-11 deep work" or "9pm-11pm study"
↩️ Ctrl+Z / Cmd+Z undoes one stroke at a time, 30 deep — Ctrl+Shift+Z redoes
📋 Copy yesterday into today in one click
🧭 A live needle always marks "now"
📅 Jump days with the arrows, or click any bar in the 7-day strip

📅 A MONTH AT A GLANCE
Colour the History calendar three ways — by score, by hours logged, or by the category each day led with. "How did it go" and "what was this month made of" are different questions.

📊 WAS TODAY ACTUALLY PRODUCTIVE?
🎯 A daily score, from your categories' weights
📈 % of tracked time that was productive
⏳ Your longest unbroken focus streak
💬 A plain-language read: what led, what dragged, blocks or fragments
👁️ Untracked time shown, never hidden — no quietly flattered numbers

🔥 STAY WITH IT
🔥 Streak counter — one missed day a week forgiven, so one slip doesn't cost you weeks
🏁 Challenges — a named run of consecutive days with a goal you set: anything logged, minutes of a category, or a daily score. It tells you how many days in a row you've kept, whether today counts, and whether the run is still alive. Miss a day and it says so — a run that tolerates gaps isn't a run
🎯 Optional daily goals per category, with a progress bar
📬 Optional weekly recap: time tracked, top category, best day, streak

🎨 MADE YOUR OWN
10 category slots — rename, reweight, recolour, hide the ones you don't use.
On by default: Deep Work · Applications · Study · Admin · Break · Distraction
There and switched off: Exercise · Sleep · Social · Errands
🎨 Click a category's swatch to pick its colour — the ring, week strip, calendar and shared image all follow
🔒 Renaming is safe — days store the slot, never the name, so history never rewrites.

🌍 IN YOUR LANGUAGE
🗣️ English · العربية · 中文 · Français · Deutsch · हिन्दी · 日本語 · Português (BR) · Русский · Español
🔤 Follows your browser's language, or pick one yourself in Settings
↔️ Arabic reads right to left, layout and all
✍️ Only the app is translated — your own notes and category names stay exactly as you wrote them

🔔 GENTLE REMINDERS
⏰ Two optional daily nudges, times you choose (default: midday + evening wrap-up)
🔕 If your system blocks Chrome's notifications, the toolbar icon still shows a ! when one is due — and a "Send a test reminder" button tells you which is happening
📬 Optional weekly recap, also off by default
🤫 Everything here is off until you turn it on

🔒 YOUR DATA STAYS YOURS
🚫 No account with us, no sign-in required
🚫 No server of ours — nowhere for your data to go, by default
🚫 No analytics, no telemetry, no tracking
🚫 No host permissions — Chrome won't let it contact arbitrary sites even if it tried
🚫 No content scripts — never touches your other tabs
🚫 No third-party code, and no "tabs" permission (that's "read your browsing history" — a time logger has no business asking)
📤 Export to CSV (opens in Excel/Sheets) or a full JSON backup, restore by merge or replace
🖼️ "Share as image" renders your day as a PNG, built entirely on-device

☁️ OPTIONAL: BACK UP TO YOUR OWN GOOGLE DRIVE
The one exception to "nothing leaves your device" — and it's off until you switch it on.
🔑 Sign in with Google → backup goes to a private, app-only folder in your own Drive (appDataFolder)
👻 Invisible in your regular Drive, unreachable by any other app
🔌 Disconnect anytime to revoke access, or permanently delete the file with one more click
🙅 Nothing syncs in the background — every backup and restore is a click you make

💻 OPEN SOURCE
MIT licensed. A few small files of plain, unminified JavaScript — readable in an afternoon.
🔗 github.com/pranav083/daily-dial-extension

ℹ️ WORTH KNOWING
⏰ Reminders only fire while Chrome is running
🔄 No automatic cross-device sync — Google Drive backup covers manual restore instead
⏱️ Blocks round to the nearest 15 minutes
```

---

## 3. Graphic assets

| Asset | Size | Required | File |
|---|---|---|---|
| Store icon | 128×128 PNG | Yes | `icons/icon-128.png` |
| Screenshot | 1280×800 PNG | Yes (1–5) | `docs/store/screenshot-*.png` — run `npm run shots` |
| Small promo tile | 440×280 PNG | For featuring | `docs/store/promo-440x280.png` |
| Marquee promo tile | 1400×560 PNG | For featuring | `docs/store/promo-1400x560.png` |

Screenshot captions, in order:

1. *Paint a day in seconds — pick a category and drag around the ring*
2. *See whether the time went where you meant it to, and how the run is going*
3. *A month at a glance, coloured by score, hours, or what each day was spent on*
4. *Ten categories, each with its own colour, weight and words*

`npm run shots` regenerates all four from the running extension at the size
the Store requires. They were hand-made once and went stale for months —
advertising a scoring rule the app had replaced — which nothing caught,
because a screenshot cannot fail a build.

---

## 4. Privacy practices

This tab blocks publication until every field is filled, and the answers must
match what the code actually does.

### Single purpose description
```
Daily Dial lets you record how you spent your day by painting blocks of time onto a 24-hour dial, and shows you a summary of where that time went. That is its only function.
```

### Permission justifications

**`storage`**
```
Stores the user's logged time blocks, category settings, and reminder preferences locally on their own device. This is the extension's core function: without it, nothing the user logs would persist between sessions.
```

**`unlimitedStorage`**
```
A user logging daily accumulates several years of history. This permission ensures long-term users are never silently cut off by the default storage quota. The data remains entirely local; no additional access of any kind is granted by this permission.
```

**`alarms`**
```
Schedules the two optional daily reminders at the times the user chooses. Reminders are off by default and the user sets both times. Alarms are the only mechanism Chrome provides for a service worker to run at a specific time of day.
```

**`notifications`**
```
Displays the two optional daily reminders described above. Notifications appear only at the times the user has explicitly configured, and only if they have turned reminders on.
```

**`identity`**
```
Used only if the user opts into the optional Google Drive backup feature in Settings → Data. Lets the user sign in with their own Google account (via Chrome's identity API, which handles the OAuth flow — the extension never sees the user's password) so their backup can be written to a private, app-only folder in their own Drive. The OAuth request also asks for the account's email address (the userinfo.email scope) so the extension can show the user, locally in Settings, which Google account is currently connected — nothing else about the profile is requested, and the email is never transmitted anywhere or included in a backup. Not used for anything else, and never triggers a sign-in prompt on its own.
```

**Host permissions**
```
None requested. By default the extension makes no network requests of any kind. The optional Google Drive backup feature (off until the user turns it on) reaches Google's Drive API through a plain fetch() from the extension page, which doesn't require a host permission entry since Drive's API supports CORS for authenticated requests.
```

**Remote code**
```
No, I am not using remote code. All JavaScript is contained in the extension package. Fonts and icons are bundled locally; nothing is loaded from a CDN or any external source. The optional Google Drive backup feature calls Google's own Drive API directly and only ever receives JSON data back — no code is fetched or executed from any remote source.
```

### Data usage disclosures

⚠️ **Read this before filling out the form — it changed with the Google Drive
backup feature, and the exact category to tick is a judgment call against
Google's current definitions, not something to copy blindly.**

By default (Drive backup never connected), nothing is collected or
transmitted, and the "nothing collected" answer from before still applies.

Once Drive backup exists as a capability the extension *can* exercise, the
Web Store's privacy tab most likely needs `This item transmits user data`
set to **Yes**, since the form asks about capability, not whether a given
installer has opted in. What's transmitted is exactly the user's own logged
time blocks, category names, and settings — sent only after the user signs
in and clicks Back Up, only to a Google Drive folder in their own account.

As of the account-email feature (v1.14.0), the extension also **reads** the
connected account's email address back from Google — for local display only
in Settings → Data, never transmitted onward, never stored in a backup. This
tips "personally identifiable information" from "doesn't apply" to "probably
does": an email address is one of Google's own listed examples of PII, and
the honest answer is that this extension now has it, even though it never
leaves the user's device. Tick **personally identifiable information** for
that reason. The logged time/category/settings data still doesn't cleanly
match any of the *other* listed categories (health, financial, authentication,
personal communications, location, web history, user activity) — but confirm
both answers against the dashboard's current category descriptions at
submission time rather than trusting this note, since Google revises that
list independently of this repo.

Still applicable regardless of how the category question is answered:

- ☑ I do not sell or transfer user data to third parties, outside of approved use cases
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

Required. Use the raw GitHub URL, or a GitHub Pages link if you enable Pages:

```
https://github.com/pranav083/daily-dial-extension/blob/main/PRIVACY.md
```

---

## 5. Distribution

| Field | Value |
|---|---|
| Visibility | Public |
| Distribution | All regions |
| Pricing | Free |
| Contains ads | No |
| In-app purchases | No |

---

## 6. Review notes

Optional, but a short note tends to speed up review for an extension whose
permissions look unusual only in how few there are:

```
This is an open-source, local-first time logging tool. The complete source is at https://github.com/pranav083/daily-dial-extension under an MIT licence.

By default the extension makes no network requests. It declares no host permissions, runs no content scripts, and bundles all assets (including fonts) locally. All user data stays in chrome.storage.local on the user's own device unless the user explicitly opts into the one optional feature below.

That feature is Google Drive backup (Settings → Data), off until the user signs in and clicks "Back up to Google Drive". It writes the user's backup to a private, app-only folder in their own Drive (the appDataFolder space, invisible in their regular Drive and unreachable by any other app), using the drive.appdata OAuth scope, which cannot see or touch any other file. The OAuth request also includes the narrow userinfo.email scope, used only to display which Google account is currently connected in Settings → Data — the address is read once per connection, shown locally, and never transmitted anywhere else or included in a backup. Sign-in goes through Chrome's own identity API, so the extension never handles the user's Google password. Disconnecting revokes access; a separate "Delete Drive backup" action removes the file itself.

The five permissions requested are storage and unlimitedStorage (to save the user's logged days locally), alarms and notifications (for two optional daily reminders that the user turns on and schedules themselves), and identity (only exercised if the user turns on Google Drive backup).

All JavaScript is unminified and dependency-free, so the submitted package can be read directly.
```

---

## 7. After publishing

- Add the store link and an "Available in the Chrome Web Store" badge to
  `README.md`
- Tag the release: `git tag -a v1.2.0 -m "..." && git push --tags` — CI builds
  the zip and attaches it to a GitHub release
- Watch the [developer dashboard](https://chrome.google.com/webstore/devconsole)
  for the review outcome

### Updating later

1. Move `## [Unreleased]` entries into a new version section in `CHANGELOG.md`
2. Bump the version in `manifest.json` **and** `package.json`
3. `npm run check` (the version check enforces the above)
4. `npm run package`, then upload the new zip to the existing listing
5. Push the matching git tag

Updates go through review again, though it is usually quicker than the first
submission.
