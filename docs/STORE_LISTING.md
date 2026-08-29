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
> placeholder `oauth2.client_id` in `manifest.json` with a real one. See
> `docs/GOOGLE_DRIVE_SETUP.md` — you need the Web Store's assigned extension
> ID first, which means one initial upload (Drive backup will just fail
> gracefully with the placeholder in place) before you can create the OAuth
> client and do a second upload with the real id.

---

## 2. Store listing

### Extension name
```
Daily Dial
```

### Summary
*(max 132 characters — this is 116)*
```
Paint your day on a 24-hour dial and see where the time really went. Local-first, with optional Google Drive backup.
```

### Category
```
Workflow & Planning
```

### Language
```
English (United States)
```

### Detailed description

```
Daily Dial turns your day into a 24-hour clock face you paint on. Pick a category, drag across the hours you spent on it, and you're done — logging a full day takes about ten seconds.

WHY ANOTHER TIME TRACKER

Most tools force a choice between two frustrating options.

Form-based trackers ask for a category, description, date, start time and end time for every single entry. Logging eight blocks means filling in that form eight times, which almost nobody keeps up for more than a few days.

Automatic trackers record whichever app had focus. That sounds effortless until you realise it cannot see a job interview, a printed textbook, a conversation with a professor, or an hour spent thinking — and it quietly reduces your day to a list of window titles.

Daily Dial takes a middle path. You tell it what you were doing, but the interaction is a single drag rather than a form, so it stays fast enough to actually do every day. And because you're the one saying what happened, it captures everything that goes on away from the keyboard.

HOW IT WORKS

• Pick a category, then click or drag around the ring to paint that stretch of time — or press 1-6 to pick a pen, 0 or E for the eraser
• Type it instead: "9-11 deep work" or "9pm-11pm study" fills the block for you
• Made a mistake? Ctrl+Z (Cmd+Z on Mac) undoes one stroke at a time, thirty deep — Ctrl+Shift+Z redoes
• Copy yesterday into today with one click when you're logging the same routine
• A live needle marks the current time, so you always know where "now" is
• Navigate to earlier days with the arrows, or click any bar in the seven-day strip

WAS TODAY ACTUALLY PRODUCTIVE?

Each category carries a weight — counts toward your score, neutral, or counts against it. From that you get a daily score, the percentage of tracked time that was productive, and your longest unbroken stretch of focus.

Underneath sits a plain-language summary of the day: which category led, whether distraction outweighed real work, whether your focus came in solid blocks or scattered fragments. It answers "was I productive?" directly, instead of leaving you to interpret a chart.

Untracked time is shown rather than hidden, so gaps in your logging stay visible instead of quietly flattering your numbers.

STAY WITH IT

A 🔥 streak counter tracks consecutive logged days, with one missed day per week forgiven as a streak freeze — a single slip doesn't wipe out weeks of consistency. Set an optional daily minutes goal per category and watch a progress bar fill in. An optional weekly recap notification sums up the week just gone: time tracked, top category, best day, current streak.

MADE YOUR OWN

Six category slots, all renameable and reweightable, and you can hide the ones you don't use. The defaults suit a job hunt or university application — Deep Work, Applications, Study, Admin, Break, Distraction — with Applications broken out on purpose, so you can see whether you actually spent time applying or only studying.

Rename freely: days store the category slot, never its name, so renaming never rewrites your history.

GENTLE REMINDERS

Two optional daily nudges, off until you turn them on, at times you choose. The default pair is a midday check-in and an evening wrap-up. The evening one tells you how much of the day is still unlogged, so you close the gap while you still remember it. An optional weekly recap notification, also off by default, adds a once-a-week summary on a day and time you pick.

YOUR DATA STAYS YOURS

This is the part that matters most, and it is built into the structure rather than promised in a policy:

• No account with us, and no sign-in required to use the extension
• No server of ours — by default there is nowhere for your data to go
• No analytics, no telemetry, no tracking of any kind
• No host permissions, so Chrome will not let it contact arbitrary sites even if it tried
• No content scripts — it never runs code in your pages and cannot read them
• No third-party code at all

It also does not request the "tabs" permission, which Chrome shows to users as "read your browsing history". A time logger has no business asking for that.

Everything lives in your browser's local storage. Export your full history to CSV whenever you like — it opens straight in Excel, Numbers or Google Sheets, with one row per block, ready to pivot. Or export a full JSON backup and import it back later — merge it into your existing days, or replace everything outright. The dial gently nudges you to back up if it's been a while and you have real history logged. A "Share as image" button renders the day as a PNG, built entirely on-device, if you want to send someone a snapshot.

OPTIONAL: BACK UP TO YOUR OWN GOOGLE DRIVE

The one exception to "nothing leaves your device," and it's off until you turn it on yourself. Settings → Data has "Back up to Google Drive" and "Restore from Google Drive" — sign in with Google, and your backup is written to a private, app-only folder in your own Drive (Google calls this appDataFolder): invisible in your regular Drive, and unreachable by any other app. Disconnect at any time to revoke access, or permanently delete the file with one more click. Nothing syncs automatically in the background; every backup and restore is something you click.

OPEN SOURCE

MIT licensed, and the complete source is on GitHub. It is a few small files of unminified JavaScript, so you can read exactly what it does in an afternoon:

https://github.com/pranav083/daily-dial-extension

WORTH KNOWING BEFOREHAND

• Reminders only fire while Chrome is running — extensions cannot wake a closed browser
• Data is stored per browser profile with no automatic sync; Google Drive backup lets you carry it to another profile or device manually via Restore
• Blocks are 15 minutes, so shorter bursts round to the nearest quarter hour
```

---

## 3. Graphic assets

| Asset | Size | Required | File |
|---|---|---|---|
| Store icon | 128×128 PNG | Yes | `icons/icon-128.png` |
| Screenshot | 1280×800 PNG | Yes (1–5) | `docs/store/screenshot-*.png` |
| Small promo tile | 440×280 PNG | For featuring | `docs/store/promo-440x280.png` |
| Marquee promo tile | 1400×560 PNG | For featuring | `docs/store/promo-1400x560.png` |

Screenshot captions, in order:

1. *Paint a day in seconds — pick a category and drag around the ring*
2. *See whether the time went where you meant it to*
3. *Make the categories yours, and set two gentle daily reminders*

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
Used only if the user opts into the optional Google Drive backup feature in Settings → Data. Lets the user sign in with their own Google account (via Chrome's identity API, which handles the OAuth flow — the extension never sees the user's password) so their backup can be written to a private, app-only folder in their own Drive. Not used for anything else, and never triggers a sign-in prompt on its own.
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
None of it is personally-identifying beyond what the user chose to type into
a reflection note. It doesn't cleanly match any of Google's listed
categories (personally identifiable information, health, financial,
authentication, personal communications, location, web history, user
activity) — this is closest to none of them, but confirm against the
dashboard's current category descriptions at submission time rather than
trusting this note, since Google revises that list independently of this repo.

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

That feature is Google Drive backup (Settings → Data), off until the user signs in and clicks "Back up to Google Drive". It writes the user's backup to a private, app-only folder in their own Drive (the appDataFolder space, invisible in their regular Drive and unreachable by any other app), using the drive.appdata OAuth scope, which cannot see or touch any other file. Sign-in goes through Chrome's own identity API, so the extension never handles the user's Google password. Disconnecting revokes access; a separate "Delete Drive backup" action removes the file itself.

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
