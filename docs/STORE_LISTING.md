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
npm run package   # produces daily-dial-v1.1.0.zip
```

The zip contains only what the extension needs to run: `manifest.json`,
`dial.html`, `dial.css`, `dial.js`, `lib.js`, `background.js`, `fonts/`,
`icons/`, and `LICENSE`. Tests, config, and docs are excluded.

> Each upload needs a version higher than the last. Bump **both**
> `manifest.json` and `package.json`, add a `CHANGELOG.md` section, and run
> `npm run check:version` — it fails if they disagree.

---

## 2. Store listing

### Extension name
```
Daily Dial
```

### Summary
*(max 132 characters — this is 118)*
```
Paint your day on a 24-hour dial and see where the time really went. No account, no server, nothing leaves your device.
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

• Pick a category, then click or drag around the ring to paint that stretch of time
• Made a mistake? Ctrl+Z (Cmd+Z on Mac) undoes one stroke at a time, thirty deep
• A live needle marks the current time, so you always know where "now" is
• Navigate to earlier days with the arrows, or click any bar in the seven-day strip

WAS TODAY ACTUALLY PRODUCTIVE?

Each category carries a weight — counts toward your score, neutral, or counts against it. From that you get a daily score, the percentage of tracked time that was productive, and your longest unbroken stretch of focus.

Underneath sits a plain-language summary of the day: which category led, whether distraction outweighed real work, whether your focus came in solid blocks or scattered fragments. It answers "was I productive?" directly, instead of leaving you to interpret a chart.

Untracked time is shown rather than hidden, so gaps in your logging stay visible instead of quietly flattering your numbers.

MADE YOUR OWN

Six category slots, all renameable and reweightable, and you can hide the ones you don't use. The defaults suit a job hunt or university application — Deep Work, Applications, Study, Admin, Break, Distraction — with Applications broken out on purpose, so you can see whether you actually spent time applying or only studying.

Rename freely: days store the category slot, never its name, so renaming never rewrites your history.

GENTLE REMINDERS

Two optional daily nudges, off until you turn them on, at times you choose. The default pair is a midday check-in and an evening wrap-up. The evening one tells you how much of the day is still unlogged, so you close the gap while you still remember it.

YOUR DATA STAYS YOURS

This is the part that matters most, and it is built into the structure rather than promised in a policy:

• No account and no sign-in
• No server — there is nowhere for your data to be sent
• No analytics, no telemetry, no tracking of any kind
• No host permissions, so Chrome will not let it contact any server even if it tried
• No content scripts — it never runs code in your pages and cannot read them
• No third-party code at all

It also does not request the "tabs" permission, which Chrome shows to users as "read your browsing history". A time logger has no business asking for that.

Everything lives in your browser's local storage. Export your full history to CSV whenever you like — it opens straight in Excel, Numbers or Google Sheets, with one row per block, ready to pivot.

OPEN SOURCE

MIT licensed, and the complete source is on GitHub. It is a few small files of unminified JavaScript, so you can read exactly what it does in an afternoon:

https://github.com/pranav083/daily-dial-extension

WORTH KNOWING BEFOREHAND

• Reminders only fire while Chrome is running — extensions cannot wake a closed browser
• Data is stored per browser profile, so there is no cross-device sync
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

**Host permissions**
```
None requested. The extension makes no network requests of any kind.
```

**Remote code**
```
No, I am not using remote code. All JavaScript is contained in the extension package. Fonts and icons are bundled locally; nothing is loaded from a CDN or any external source.
```

### Data usage disclosures

Tick **nothing** in the data collection list. The extension collects none of the
listed categories — not personally identifiable information, health, financial,
authentication, personal communications, location, web history, or user
activity. Nothing is transmitted off the device.

Then confirm all three certifications:

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
This is an open-source, offline-only time logging tool. The complete source is at https://github.com/pranav083/daily-dial-extension under an MIT licence.

The extension makes no network requests. It declares no host permissions, runs no content scripts, and bundles all assets (including fonts) locally. All user data stays in chrome.storage.local on the user's own device and is never transmitted.

The four permissions requested are storage and unlimitedStorage (to save the user's logged days locally), and alarms and notifications (for two optional daily reminders that the user turns on and schedules themselves).

All JavaScript is unminified and dependency-free, so the submitted package can be read directly.
```

---

## 7. After publishing

- Add the store link and an "Available in the Chrome Web Store" badge to
  `README.md`
- Tag the release: `git tag -a v1.1.0 -m "..." && git push --tags` — CI builds
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
