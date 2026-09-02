---
title: What's new
description: Every release of Daily Dial, and what changed in it.
---

# What's new

Daily Dial is developed in the open. This is the project's changelog, unedited.

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version here always matches `manifest.json`.

## [Unreleased]

## [1.34.1] — 2026-09-02

### Fixed

- **The shading over hours that haven't happened yet was frozen at whatever
  time the day last re-rendered.** The 30-second timer moved the needle and
  the centre clock but never redrew the future arc, so a tab left open all
  afternoon showed the needle sitting well inside its own shaded "future" —
  and hours that had already passed still looked unavailable to paint. The
  arc is a function of the current time in exactly the way the needle is, and
  now refreshes alongside it.

## [1.34.0] — 2026-09-01

### Changed

- **"Share as image" now carries the day's breakdown**, not just a ring and a
  number. It shows where the time went, bar by bar, with untracked time
  included — the part of the panel actually worth handing to someone else. On
  a quiet day the old card was a near-empty circle beside the word "score".

- **The daily score is measured against a target, not against itself.** It
  used to divide productive time by however much you had logged, so logging
  *less* raised it: two good hours and a blank day read +100, the same as a
  flawless twelve-hour day and better than an honest one with a bad hour in
  it. The number rewarded exactly the behaviour the app exists to discourage.
  It now divides by your daily target where you fall short of it, so two
  productive hours against a four-hour target read 50.
- **Neutral time no longer counts against you.** Only productive and
  distraction minutes are in the fraction. Dividing by everything logged
  would have meant four productive hours plus four hours of break scoring the
  same as two productive hours and nothing else admitted to — honesty about a
  break costing exactly what hiding half the day would. Breaks are free;
  distraction is not, because that is how you weighted it.
- The target comes from your own daily goals on productive categories
  (Settings → Goals), summed, and falls back to four hours when none are set.
- Score bands re-cut for the new scale. Under the old ratio they sat at
  40/10/-15, which suited a number that hit 100 on two clean hours.

### Fixed

- **The share card drew Distraction in green.** Its palette was a second copy
  of the category colours, and it had drifted from the stylesheet: five of six
  were subtly off and `--cat-5` was a green where the app shows red. Wrong for
  months on the one picture that leaves the device. A test now reads dial.css
  and fails when the two disagree.

### Added

- **An observation when the target and your typical day drift apart** — a
  median day well clear of the target in either direction, after three weeks
  of history like every other pattern. It states both figures and leaves the
  advice to the suggestion, which is the only one in the catalog about the
  app rather than about you, and names no tool at all.
- **A Firefox build.** `npm run build:firefox` produces one from the same
  sources, submitted to addons.mozilla.org.
- `npm run firefox:redirect` prints the Google OAuth redirect URI Firefox
  uses. It is derived from the add-on id and differs from Chrome's, so Drive
  backup fails on Firefox alone until it is registered.

### Fixed

- **Google Drive backup worked only for the developer.** The OAuth app's
  publishing status was left on Testing, which is not a milder setting but a
  hard allowlist of 100 accounts — so every real user was refused at Google's
  own consent screen, on Chrome as much as Firefox, where it read as a broken
  extension rather than a switch in a console they cannot see. Invisible to
  the obvious test, since the developer is always on the list.

### Notes on the Firefox build

- It declares `data_collection_permissions: ["none"]` and raises its floor to
  Firefox 140 (142 on Android), which that key requires. AMO rejects a new
  extension without it, as an *error* — where `addons-linter` reports only a
  *warning*, at every version, since only AMO knows an extension is new. That
  failure cannot be reproduced locally at all: a clean lint is necessary and
  not sufficient.
- The higher floor turned out to cost nothing and pay for itself:
  `runtime.getContexts` ships in Firefox 140, so four compatibility warnings
  went with it. The build lints at 0 errors, 2 warnings.

## [1.33.0] — 2026-08-31

### Added

- **The ring can start at your waking hour** instead of midnight
  (Settings → Appearance → Ring starts at). Midnight at the top is the
  convention, and it spends the top of the circle — the part your eye reads
  first — on hours you were asleep. Turning it puts your actual day across
  the top. Midnight remains the default.

## [1.32.0] — 2026-08-31

### Added

- **A keyboard shortcut.** <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>
  (<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> on a Mac) opens the dial from
  anywhere. On a tracker you fill in yourself, the thing that decides whether
  a day gets logged is how little stands between remembering and recording.
  Rebindable at `chrome://extensions/shortcuts`.

### Fixed

- **Small controls are now properly tappable on a touch screen.** Buttons
  sized for a mouse were as small as 19px. Their hit areas are 44px on touch
  devices, while they look exactly as before with a pointer.

## [1.31.1] — 2026-08-31

### Fixed

- **The page had no viewport tag**, so on a phone it rendered at 980px and
  zoomed out — the responsive layout never engaged. Invisible inside the
  extension, which opens in a desktop tab, and very visible in the playable
  demo on the website, which is the same file and is exactly what someone
  taps when a link reaches them on a phone.

## [1.31.0] — 2026-08-31

### Changed

- **The hours that haven't happened yet are now shaded on the dial.** Painting
  them was already refused, but nothing said so until you tried: the ring
  looked available all the way round, you dragged into the evening, and got a
  message explaining why nothing happened. A refusal you can't see coming
  reads as a broken control rather than a rule. The needle now sits on the
  boundary between the two, which is what it was always marking.

## [1.30.1] — 2026-08-31

### Fixed

- **The occasional review request disappeared as soon as you did anything.**
  It showed on opening, then the first edit made it vanish — while still
  counting as one of the two times it is ever allowed to ask. It also shifted
  the dial upward as it went. It now stays until you answer it.

## [1.30.0] — 2026-08-30

### Added

- **A way to report a bug from inside the app.** Settings → About now links
  to the project's issue form, with the version and browser already filled
  in — the two questions people are least able to answer and most likely to
  get wrong. Nothing from your day is attached; only what you type is sent.
- **A theme button in the top bar**, beside the settings menu. One press
  cycles system → light → dark and back. Theme is the one appearance setting
  people change by mood rather than once, so it no longer lives three clicks
  deep — and Settings → Appearance still has it, with the two kept in step
  whichever you use.

## [1.29.1] — 2026-08-30

### Fixed

- **Reminders now arrive in the language you chose.** Picking a language set
  it for the dial but not for notifications, which kept following the
  browser — so the app could be in Hindi and its evening reminder in English.
- The two notification titles were never translated at all, in any language.

## [1.29.0] — 2026-08-30

### Changed

- **Painting no longer writes over time you have already logged.** A stroke
  that runs into an existing block now stops at its edge and says what is
  there, instead of quietly replacing it. Overshooting a drag by a few
  minutes used to eat the neighbouring block with nothing to show for it but
  a changed colour.
- **To replace a block on purpose, press it twice.** That swaps the whole
  stretch for whichever pen is selected, and ⌘Z still undoes it. Hovering a
  block that a different pen would replace says so before you click.
- Empty time is unchanged — one click or one drag, as before. The eraser is
  unchanged too: removing something is visible and reversible, which is the
  whole point of it.

## [1.28.1] — 2026-08-30

### Changed

- **Switching between 24h and AM/PM no longer moves the clock.** The AM/PM
  pair sat between the header and the ring, so leaving 24h inserted a control
  above the dial and pushed the face down. It now lives in the header row
  beside the layout switch, and keeps its place there when unused, so the
  ring stays put at every window size.
- **The typed-entry row sits under the clock**, rather than spanning the whole
  card with half of it beneath the category column.

## [1.28.0] — 2026-08-30

### Added

- **A language setting.** Settings → Appearance → Language. It was following
  your browser and there was no way to say otherwise, which left anyone whose
  Chrome is set to one language unable to read the app in another. Automatic
  is still the default. Changing it reloads the page, and never touches a word
  you have written.

### Fixed

- **A challenge name typed before its start date was silently erased.** The
  form saved on every edit, an incomplete form is not a challenge, and saving
  "no challenge" wrote itself back over the field you were still filling in.
  Filling the form in the obvious order — name, then date — could not work.

### Changed

- **"Fill multiple days" moved from Data to Categories.** It paints your time
  with a category; Data is for export, import and backup.
- The welcome tour's third card now mentions choosing your language, since
  that is where you would look for it.

## [1.27.0] — 2026-08-30

### Added

- **Nine more languages: Arabic, Chinese (Simplified), French, German,
  Hindi, Japanese, Portuguese (Brazil), Russian and Spanish.** Chrome picks
  whichever matches your browser's language; anything else still gets
  English. This translates the app's own words — labels, buttons, tooltips,
  the score, the sentence under the dial, the observations and their advice.
  It never touches a single word you wrote: your notes, intentions,
  reflections and category names are yours, in whatever language you wrote
  them.
- **Arabic reads right to left.** The layout mirrors — the pens and the week
  move to the right, the panel to the left. The dial does not: a clock runs
  clockwise in every language, and 15:00 is 15:00.
- On a fresh install the six starting categories arrive in your language.
  If you have already renamed them, or logged anything at all, nothing
  changes — they are your data from the first edit onward.

### Fixed

- **Counts that stayed plural when they meant one.** "You met 1 of 1
  intentions", "sits in just 1 categories", "Filled 1 days". Five of them,
  wrong in English before they were ever wrong anywhere else.
- Dates and weekday names follow the app's language rather than the
  browser's — a fully translated page was still saying "August 2026".
- The streak now reads correctly in languages that put the number in the
  middle of the phrase rather than at the front.

### Changed

- **The pens moved into a column to the left of the dial**, with the eraser
  below a divider rather than sitting among them — it isn't a category, and
  it was moving every time the real ones did.
- The week strip sits under the pens, and its labels size themselves to the
  language, so long weekday names are not cut off.
- Less empty space between the intentions, avoid and reflection fields.
- The welcome card and the first-run hint now point at where the categories
  actually are — they still said "below the dial", with an arrow pointing down.

## [1.26.0] — 2026-08-30

### Fixed

- **The other four ways to paint the future.** 1.25.0 stopped the three
  painting paths — dragging the ring, the keyboard, and typed entry — but the
  rule was written into each of them separately, so everything else that
  writes slots still wrote whatever it liked. Filling a gap from "The day,
  end to end" would happily claim the rest of tonight; "Copy yesterday" and
  applying a template stamped a full 24 hours onto a day that had only had
  ten of them; and a multi-day fill of "9–5 all week", run on Monday morning,
  recorded the whole week as already worked. All four now stop at now, and
  the rule lives in one place instead of four.
- Multi-day fill reports the days it actually wrote. It counted the days in
  the range, so a range reaching into next week claimed days it had skipped.

### Changed

- **The week moved to the left of the dial.** Below it, it was a long scroll
  away from anything; above it, it pushed the pens and the note field off a
  laptop screen. Beside the ring it costs nothing, because the days now run
  top to bottom with each bar running left to right — seven of them fit in
  something narrower than the dial is tall. On a narrow window it goes back
  to a band above the ring.
- Breakdown rows for hours later today read "Not yet" instead of offering a
  category dropdown. The row stays, because the day does continue — it just
  no longer offers a control whose every use would be refused.

## [1.25.0] — 2026-08-29

### Fixed

- **Time that hasn't happened yet can no longer be painted.** Stopping the
  date arrows at today only covered future *days*; you could still paint this
  evening at nine in the morning, which inflated the day's tracked total, its
  score and the streak from something imagined. A stroke that crosses "now"
  paints up to it and stops, rather than refusing entirely. Erasing is
  unaffected — it can only ever remove something that shouldn't be there.

### Changed

- **Writing a note no longer means scrolling away from the dial.** The field
  offered after a stroke sat below the pens and the typed-entry row, which on
  a laptop put it off the bottom of the window: you painted, scrolled down,
  typed, scrolled back. It now sits directly beneath the ring, so painting
  and annotating happen in the same place.
- **The week strip moved below the dial.** It's reference rather than
  something acted on each session, and at the top it was pushing the pens and
  the note field off-screen. With both changes the whole loop — ring, note,
  pens, typed entry — fits on one screen.

## [1.24.0] — 2026-08-29

### Added

- **The interface can now be translated.** All 454 of the app's own strings —
  settings labels, buttons, tabs, tooltips, placeholders, toasts, status
  lines, and the accessible names screen readers read — moved into
  `_locales/en/messages.json`, with the manifest, extension name and Store
  description alongside them. Adding a language is now a data file and no
  code: copy that file to `_locales/hi/`, translate the values, keep the
  keys. Chrome picks the language from the browser, and any key a translation
  is missing falls back to English, so a half-finished translation still
  works.

  Uses Chrome's own `chrome.i18n` rather than a library — it's what the Web
  Store reads for localised listings, and it keeps the extension at zero
  runtime dependencies with no build step, which is what makes the published
  build checkable against this source.

  **Your own words are never translated.** Notes, reflections, intentions,
  to-avoid lines, template names, challenge names and renamed categories only
  ever pass through as values, never as anything looked up. Verified by
  seeding distinctive text and confirming it renders byte-identical through a
  full storage round-trip.

  Strings carrying values use whole-sentence messages with named placeholders
  rather than concatenated fragments, so a translator can move a number or a
  category name to wherever their language puts it. Singular and plural are
  separate messages, since Chrome's format has no plural support.

### Note

- The insight sentence, the score labels and the six "Worth noticing"
  observations still come from `lib.js`, which is deliberately pure — no
  `chrome.*`, so its 200 tests run under plain Node. Translating those means
  having it return keys rather than finished sentences; worth doing when a
  second language actually exists, and harmless until then.

## [1.23.0] — 2026-08-29

### Added

- **Automatic Google Drive backup**, off by default, in Settings → Data.
  Roughly once a day it quietly updates the same backup file, so "your data
  lives only in this browser" stops depending on you remembering.

  Every part of it is deliberately silent and deliberately limited:
  - **It can never raise a sign-in window.** A background alarm asking for
    Google consent, with no action to explain it, would be alarming. It uses
    a strictly non-interactive connect, so it can only ever *update* a backup
    you made by hand — turning it on before connecting Drive does nothing at
    all rather than surprising you.
  - **It never reports failure.** A skipped run is logged to the service
    worker console and nothing else. Manual "Back up now" stays the place
    errors are worth raising, because there someone is waiting for an answer.
  - Demo days are excluded and an empty backup is refused, exactly as with a
    manual backup.
  - The alarm exists only while the setting is on — an alarm that fires and
    does nothing still wakes the service worker for no reason.

## [1.22.0] — 2026-08-29

### Added

- **Day templates.** Most days rhyme, so save the shape of one and stamp it
  onto another: Settings → Goals → Templates. A template carries painted time
  only, never notes, intentions or a reflection — it's the shape of a day, not
  its content, and copying someone's words onto a different day would be
  wrong. Applying to a day that already has painted time asks first, and is
  undoable with ⌘Z like any other stroke.
- **Multi-day fill.** "I was away Monday to Friday" is now one action rather
  than five days of clicking: Settings → Data, pick a date range and a
  category, optionally narrow it to part of each day. Before anything is
  written it tells you exactly how many days will change and how many of them
  already have painted time in that window, then still needs a second click.
  Capped at 92 days, and an inverted range is refused rather than silently
  reversed. Notes and reflections on the affected days are left alone —
  only painted time is replaced.

## [1.21.0] — 2026-08-29

### Changed

- **A day with barely anything logged no longer gets a score.** Thirty minutes
  of Deep Work and nothing else divided 30 by 30 and read **+100** — the same
  as a flawless twelve-hour day, and *better* than an honest one with a bad
  hour in it. Below two hours logged, the day now reads "Too little logged to
  score" with a dash instead of a number, on the dial, in the month heatmap,
  in the log, and on the toolbar badge. The score is still computed and
  stored; this governs how it's presented, not what it is, so nothing
  historical is rewritten.

### Fixed

- **You could walk forward into future days and paint them.** There was no
  upper bound on the date arrows, so days that hadn't happened could be
  filled in, carried a score, and sat in History looking like something you'd
  done. The forward arrow now stops at today.

## [1.20.0] — 2026-08-29

### Added

- **The calendar marks days you wrote up but didn't paint.** A day can hold
  notes, intentions or a reflection with no time on the dial — an imported
  journal is made entirely of those — and the heatmap showed every one as
  blank, which reads as "nothing happened here" about days you demonstrably
  wrote about. They now get a solid outline and a dot, clearly different from
  the dashed cells of a day with nothing at all, and a "Written only" entry
  in the legend. Deliberately not given a score colour: those mean painted
  time, and borrowing one would imply a score that doesn't exist.

## [1.19.0] — 2026-08-29

### Added

- **The pen you last used is remembered.** Every session started on Deep Work
  regardless of what you actually log most. The eraser counts as a pen worth
  remembering too, and a saved pen whose category has since been hidden still
  falls back to the first visible one.
- **Changing a category's weight now says so where you change it.** Colours
  encode the default weights — Distraction red, the productive ones cool — so
  setting Break to `+1` leaves it pink while counting toward your score. The
  category editor now notes that on the row you edited, and the note goes when
  the weight goes back. Colours themselves stay put: a category's hue is its
  identity on the ring, and recolouring on a weight change would make the day
  unreadable at a glance.

### Fixed

- **Painting didn't update the table directly beneath it.** "The day, end to
  end" only refreshed on a full view redraw, so a stroke changed the ring and
  left the rows under it stale until you switched tabs — on the surface that
  is now the main way to edit a day.
- **"14 stretches · 15h logged · 9h not"** — the trailing fragment was
  ungrammatical and got clipped on narrower cards. Now reads
  "14 stretches · 15h logged, 9h unlogged", and a single stretch is a
  "stretch".

## [1.18.1] — 2026-08-29

### Fixed

- **The extension stopped opening from the toolbar** — clicking the icon went
  to `dial.html[object Object]`, which doesn't exist. Introduced in 1.17.0
  when the recap notification gained a deep link: `openDial` grew an optional
  hash argument, and `chrome.action.onClicked` hands its listener the Tab
  object, so every toolbar click passed a Tab where a string was expected and
  concatenated it into the URL. The listener is wrapped now, the suffix is
  resolved through a function that only ever returns a hash it recognises,
  and there's a test covering the exact shape that broke it.

## [1.18.0] — 2026-08-29

### Fixed

- **Distraction was green, the same family as Study.** One counts for your
  score and the other against it, which makes them the worst possible pair to
  render alike — and the colourblind-safe palette in 1.11.0 made it worse by
  optimising numeric distance without ever checking that opposite weights
  shouldn't share a hue. Distraction is red now. The new colour still clears
  the same floors: no pair confusable under deuteranopia or protanopia, and
  3:1 contrast against the panel.

### Added

- **A note field appears right where you paint.** Writing a note about the
  stretch you just painted meant scrolling past the pens and the whole
  breakdown table to find its row — so the note usually didn't get written.
  A finishing stroke, or a typed entry, now offers a labelled field in place;
  Enter saves, Escape dismisses.
- **Each painted row in "The day, end to end" can be cleared from the table.**
  Removing a stretch previously meant going back to the ring, finding the
  same range, and painting over it with the eraser. Shown on hover rather
  than always, since a column of crosses turns a day's summary into a list of
  things to delete.

## [1.17.0] — 2026-08-29

### Added

- **A single switch for "Worth noticing"**, in Settings → Goals. Per-item
  silencing already existed, but the feature was meant to be optional and had
  no way to turn the whole thing off. On by default — an observation is
  arithmetic on your own data rather than an opinion — but it is still
  something watching your habits and saying so, which not everyone wants.
- **The weekly recap notification opens History**, where the numbers it just
  quoted actually live, instead of dropping you on today's dial. An already
  open dial is focused and told to switch view rather than reloaded, since a
  reload would throw away unsaved edits.

### Fixed

- **Imported history was invisible.** Bringing in a journal — days carrying
  notes and intentions but no painted time — left History looking empty and
  the import looking failed. Two independent causes: the month cursor sought
  the latest month with *painted* days and so never moved, and the log
  defaults to "This week" while the import was months old. The cursor now
  falls back to the latest month with anything written at all, and the log
  opens on the narrowest range that actually contains something.
- **The month summary read as a row of zeros next to a full log.** Every
  figure up there counts painted time, so a month of written-up days showed
  "0 days logged · 0m tracked" directly above the entries themselves — which
  looks exactly like a failed import. It now says how many days are written
  up without painted time, and where to find them.

## [1.16.2] — 2026-08-29

### Fixed

- **The weekly recap summarised the wrong week.** It was scheduled on
  `weeklyRecapDay` but its window came from `weekStart` alone, so the two
  disagreed the moment either setting moved off its default. Set the recap to
  Saturday evening and it reported the week *before* the one you had just
  lived through — up to seven days stale, with numbers that looked current.
  Worse than no recap, since it's the one thing that reaches out unprompted.
  It now reports the most recent week that has actually ended, counting the
  current week as ended when the recap fires on its final day — because
  choosing that day is exactly how someone asks to hear about the week they
  just finished. The default (recap on the same day the week starts) behaves
  as it always did.

## [1.16.1] — 2026-08-29

### Fixed

- **The v1.16.0 zip would not have loaded.** `npm run package` lists its files
  by hand, and `suggestions.js` — added in 1.16.0 and imported by both
  `dial.js` and `history.js` — was never added to that list. The extension
  ran fine from source, so nothing caught it; a packaged build would have
  died on a module-resolution error, and the release workflow builds from the
  same script, so it would have gone straight to a GitHub release.
- **Added `npm run check:package` so this can't happen again.** It walks the
  real import graph from the two entry points Chrome loads (`dial.js` and
  `background.js`) and fails if anything reachable is missing from the zip.
  Deliberately not a second hand-written list, which would be the same
  problem wearing a different hat. Now part of `npm run check`, so CI
  enforces it.

## [1.16.0] — 2026-08-29

### Added

- **"Worth noticing" — patterns from your own data, at the top of History.**
  Six things it looks for: setting more intentions than you finish, two weeks
  with no rest logged, the hour you're most productive in going unprotected,
  distraction climbing week over week, logging thinning out, and everything
  sitting in only a few categories.
  - **Observations only. No advice unless you ask.** Each one states a fact
    with the numbers behind it; "What people do about this" is a click, and
    stays closed until then. An observation is arithmetic on data you entered
    and can't really be wrong — unprompted advice reads as a lecture, and a
    tracker that lectures is one people stop opening. Then the data stops too,
    which costs far more than the advice was worth.
  - **Nothing fires on a single bad day.** Every detector needs three weeks of
    history and eight logged days, and looks for a sustained trend.
  - **"Don't show this again" is permanent**, not "for now". If you've decided
    your answer, the app has no business asking again.
  - Suggestions are **bundled and static** (`suggestions.js`), never fetched —
    downloading them would end the "makes no network requests" guarantee,
    which is the strongest claim this extension has. Two of the six recommend
    no software at all, and several recommend leaving the computer. Tools are
    named as examples of an approach, platform-tagged, and explicitly not
    endorsed or affiliated.

### Changed

- **`CONTRIBUTING.md` now states the project's boundary.** What the job is
  (see where your time went, including what no software can see, and decide
  what to change) and what it isn't (blocking, enforcing, capturing
  automatically, task management, coaching) — with the reasoning, so the
  obvious drift here (*"we detect distraction, why not add a block button?"*)
  has an answer written down before someone asks it.

## [1.15.0] — 2026-08-29

### Added

- **"The day, end to end" — the whole 24 hours as rows, gaps included.**
  Replaces the old note box, which only worked while something was selected
  on the dial: a note could be written at the moment of painting and never
  afterwards, when you actually remember what you were doing. Every stretch
  now has its own always-live note field — no clicking "+ note" first, just
  tab down the day and type. Uncapped on purpose: the point is seeing all
  24 hours, and a scroll box would hide exactly the gaps this exists to
  surface.
- **Unlogged gaps are rows too, with a category dropdown to fill them.**
  An hour you forgot is now something you can see and act on in one place,
  rather than something invisible you'd have to go back to the ring and
  re-drag to fix. You can write the note on the same row while filling it,
  which the paint-then-annotate flow never allowed.

### Changed

- **The typed-entry category is a dropdown.** It was the only half of
  `9-11 deep work` you could get wrong by misspelling. Typing a category
  still works and still wins, so aliases and `9-11 leetcode` are unaffected
  — the dropdown fills in when the box holds a bare time range.
- **"Share as image" moved to the top-left of the dial card**, opposite the
  layout switch. It was below the pens, off-screen on shorter windows.

### Fixed

- **The journal never rendered on first load.** `boot()` loaded the day with
  its own inline copy of the day-loading code, which set slots and the
  reflection but not notes, intentions, or the avoid list — so they appeared
  blank until you navigated to another day and back. It now loads through
  the same path a date change uses.

## [1.14.1] — 2026-08-29

### Fixed

- **The Chrome Web Store name never actually changed.** The name decided
  earlier this session ("Daily Dial – Time Tracker & Focus") had only been
  written into the submission planning doc, not `manifest.json` — and the
  Store, `chrome://extensions`, and every notification title all read the
  name from the manifest, not from a doc. The in-app wordmark stays plain
  "Daily Dial", as intended; only the manifest's store-facing name changes.
- The Store submission doc's permission justifications and review notes
  still only described the `drive.appdata` scope — stale since v1.14.0 added
  `userinfo.email` to show the connected account. Both now mention it, and
  the data-usage guidance now flags that "personally identifiable
  information" likely needs to be ticked, since an email address is one of
  Google's own listed examples of PII, even though it's never transmitted
  anywhere beyond local display.

## [1.14.0] — 2026-08-29

### Added

- **Settings → Data now shows which Google account is connected**, and how
  much space the backup is using. Previously there was no way to tell
  "am I about to back up to the account I think I am" once connected.
  Showing the account required one new, narrow OAuth scope
  (`userinfo.email` — the address only, nothing else about the profile);
  read once per connection, shown locally, and — like everything else Drive
  backup touches — never included in an export or a backup file itself.
  PRIVACY.md and SECURITY.md describe exactly what this does and doesn't
  do. Existing users will see one extra line in Google's consent screen the
  next time they connect.
- **The Store submission doc reflects the store-facing name decided earlier
  this session** ("Daily Dial – Time Tracker & Focus"), which had been
  decided but never actually written down.

### Changed

- **"Welcome tour" and "Demo mode" are one section in Settings → About**,
  not two. Both answered the same underlying question — "show me what this
  looks like" — and splitting them across two headings just meant reading
  twice to find the one you wanted.

## [1.13.0] — 2026-08-29

### Added

- **A "to avoid" list per day.** The other half of setting out a day: what
  you mean to steer clear of. Deliberately not a checklist — these are
  things to notice yourself doing — and they sit beside what you actually
  did in the History log.
- **A named challenge with its own day counter.** For anyone running a
  "#100days"-style stretch: give it a name and a start date and it shows as
  `#100days · day 19 / 100` beside the streak. Unlike the streak it doesn't
  break — it counts from the start date, which is what a personal challenge
  actually is. Set it under Settings → Goals.
- **The weekly recap now reports how your intentions went** — "you met 2 of
  3 intentions" — and ends by asking what to adjust, rather than reporting
  numbers and stopping. A review that doesn't prompt a decision is just a
  statement.

### Fixed

- **Undo silently lost other days' history.** One shared stack was popped
  until it found an entry for the day on screen, so painting Monday,
  switching to Tuesday and painting, then returning to Monday and undoing
  discarded the Tuesday entry along the way — the stroke stayed on screen
  but could never be undone, with nothing said about it. Each day now keeps
  its own history.
- **The History tab was hidden entirely unless something had been painted**,
  so a day carrying only intentions or a note — which the new log exists to
  show — made the whole view disappear.
- **The month heatmap was around forty consecutive tab stops.** It's now a
  single stop with arrow keys moving between days, which is how a grid is
  supposed to behave.

## [1.12.2] — 2026-08-29

### Fixed

- **The keyboard cursor stopped dead at midnight instead of going round.**
  The ring is a circle, so hitting an invisible wall at the top read as the
  cursor being stuck. Arrows now run round and round in either direction,
  and a selection can cross midnight — it draws as two arcs and paints both
  sides as one block, matching what a mouse drag across the top already did.

## [1.12.1] — 2026-08-29

### Fixed

- **Editing still froze the tab, claiming another tab had changed the data.**
  The previous attempt fixed one cause; the guard itself was the deeper
  problem. It froze on *any* write it hadn't recorded, so a single missed
  write path — or two structurally identical objects whose keys happened to
  be in a different order — stopped a perfectly healthy tab mid-edit. It's
  now narrowed to what can actually be lost: only the day currently on
  screen, and the shared settings and categories, are worth freezing over.
  A change to any other day is simply adopted, so two tabs sitting on
  different days now work together instead of fighting. Comparisons ignore
  key order, and the banner names what actually conflicted.
- **The Settings dialog resized every time you switched tabs**, because it
  sized itself to whichever tab was showing and they hold very different
  amounts. It now keeps one height and scrolls its body.

### Added

- **The week strip says which month it's showing.** It listed bare day
  numbers, which is ambiguous at any month boundary — and it names both
  months when the seven days span two.

## [1.12.0] — 2026-08-29

### Added

- **A written log, not just a measured one.** The dial could tell you a day
  was six hours at +100 and nothing about what those hours were. Three
  additions close that:
  - **Intentions** — the day's list of what you meant to do, ticked off as
    they land. They're kept whether or not you do them, because a week later
    the ones you didn't are the interesting half.
  - **Notes pinned to a stretch of the day** — select a range on the ring
    (drag it, or focus the ring and hold Shift with the arrows) and write
    what happened between those hours. A day used to hold exactly one note
    for all 24 hours; it now holds up to forty, each anchored to its own
    stretch, and each marked on the ring so you can see where the writing is.
  - **"The log" in History** — every day with anything written on it,
    newest first, showing what you meant to do, what you ticked off, what
    happened in each stretch, and the line you left at the end. Filter to
    this week, this month, or everything.
- Notes and intentions travel in JSON backups and Google Drive backups.

### Fixed

- **Editing froze the tab and claimed another tab had changed the data.**
  The multi-tab guard added in 1.10.0 compared each change event against
  live state — but a day's slot array is shared by reference with the
  in-memory day, so painting again before the first event arrived made the
  tab's own write look foreign. It now matches events against what was
  actually written, which has no such race. A genuinely foreign write is
  still caught.
- **A stray box appeared on the ring when painting with the mouse.** The
  keyboard cursor added in 1.11.0 showed on any focus, and clicking the ring
  focuses it. It's now shown only for keyboard focus, and returns the moment
  an arrow key is pressed.

## [1.11.0] — 2026-08-29

Accessibility. Two of these locked people out of the app completely.

### Added

- **The dial can now be used without a mouse.** It was pointer-only — not
  focusable, no key handling — so anyone who can't use a pointer could not
  log time at all. The ring now takes focus and carries a cursor: arrow keys
  move it (hold Alt for hour steps), Shift+arrows extend a selection, Home
  and End jump to the ends, Enter paints with the active pen, and Delete
  clears. It runs through the same fill-and-commit path the mouse uses, so
  the two can't drift apart.
- **Typed entry can erase.** `9-11 erase` (or `clear`, `untracked`, `none`,
  `empty`) clears a range. Previously typed entry could only add, so without
  a pointer the only way to fix a wrong block was Clear day — wiping all 24
  hours. A category you've named "Empty" still wins over the reserved word.
- **Screen readers are told what happened.** Painting and score changes were
  completely silent: the toast is the only live region and it never fires
  for an edit. There's now a live region announcing each change, and each
  dial's label lists the day's actual blocks instead of being a fixed
  string on an unlabelled shape.

### Fixed

- **Two default categories were the same colour to a red-green colourblind
  reader.** Study and Break sat at a colour difference of 5.9 under
  deuteranopia — indistinguishable — and they're on opposite sides of the
  score, so an unreadable day was also a misleading one. The palette was
  re-picked against simulated deuteranopia and protanopia: the worst pair
  now separates at 18, and every category also clears 3:1 contrast against
  the panel, which four of them previously failed.
- **Muted text failed contrast throughout the light theme.** Section
  labels, hints, stat captions, the dial's hour numbers and the import
  summary all sat near 3.4–3.9:1 against 4.5:1. Muted ink is darker, and
  status colours now have separate text-weight variants, since a colour
  bright enough to fill a shape is too light to read as a word.
- **The focus ring itself failed contrast in light mode** at 2.42:1 against
  a 3:1 requirement — the indicator telling you where you are was the least
  visible thing on screen.
- **The welcome dialog wasn't managed like a dialog.** It claimed
  `aria-modal` but Tab walked straight out of it, Escape did nothing, focus
  was never restored, and the shortcut keys still changed the pen behind it.
- **The dial layout switchers announced nothing useful.** They used
  `role="tab"` with `aria-pressed`, which isn't valid together, so which
  layout was active simply wasn't conveyed. They're button groups now.

## [1.10.0] — 2026-08-29

### Fixed

- **Two copies of the dial open at once could silently destroy a day's
  work.** The page reads everything into memory when it loads and writes
  back a whole day — or the whole settings object — at a time, and nothing
  told it when another copy had changed something. So a second tab holding
  an older snapshot would overwrite the newer data on its very next write,
  and merely *typing a note* was enough to trigger it. Nothing errored: the
  write succeeded, and the losing tab carried on displaying work that no
  longer existed anywhere. Two copies wasn't exotic either — a restored
  pinned tab or a Ctrl+Shift+T was enough, because the "reuse the open tab"
  logic remembered a tab id in session storage, which Chrome clears on
  shutdown. Now: the dial notices when another copy writes, stops writing
  itself, and says so with a Reload button rather than quietly clobbering.
  And it finds an already-open dial by asking the runtime instead of
  remembering an id, so a restored tab is reused rather than duplicated.
  (Nothing here needs the `tabs` permission — that constraint still holds.)

### Changed

- **The README leads with the Chrome Web Store link.** It previously
  described only the unpacked developer install, along with a warning about
  moving the folder that doesn't apply to a store install at all.
- **Added a section on verifying the published build.** All the JavaScript
  is unminified and dependency-free, so anyone can diff the installed
  extension against the matching git tag rather than taking the privacy
  claims on faith — worth spelling out, since nobody thinks to try it.
- Getting-started guide no longer says the extension isn't published yet.
- README's test count, file table, and feature list were behind the code —
  History had no entry at all despite being a headline feature.

## [1.9.9] — 2026-08-29

### Added

- **Drag the seam between two blocks to move it.** Hovering where two
  blocks meet shows a handle and a resize cursor; dragging it hands time
  from one to the other. Previously the only way to change where a block
  ended was to paint over it, and starting that stroke a slot early quietly
  ate into the block you meant to keep. A seam drag can squeeze either side
  down to nothing but never reaches past into a third block, and the
  tooltip shows both sides of the trade while you drag —
  `08:00–09:00 Deep Work | 09:00–12:00 Applications` — so you can see what
  you're giving up as you give it up.
- **Durations in the dial tooltip.** Hovering a block now reads
  `08:00–10:00 · Deep Work · 2h` rather than making you work the length out
  from the endpoints. It follows the cursor while painting, so a stroke
  reports its running total instead of leaving you to guess.

### Changed

- **In AM/PM mode, the half that doesn't contain the current time no longer
  shows a dead `--:--`.** It shows how much of that half is logged, and
  ticks up as you paint into it — so both rings carry information instead
  of one being a placeholder.

## [1.9.8] — 2026-08-29

Rough edges from the same audit — none of these lose data, they just make
the app feel unreliable.

### Fixed

- **After restoring a backup made with a different dial layout, the wrong
  rings stayed on screen — and clicking the right layout button did
  nothing.** The imported setting was live while the old layout was still
  rendered, so the switcher thought it was already on the mode you were
  asking for and returned early. Restoring now applies the layout it
  restored. An import made while History was open also left the heatmap and
  summaries showing pre-import data until you switched tabs.
- **Hiding a category and reloading left the first brush stroke painting
  that hidden category.** The pen defaulted to the first category and was
  only re-pointed when one was hidden mid-session — so after a reload no
  pen showed as selected, the dial still read "pen: Deep Work", and
  painting used a category missing from the pen row whose keyboard shortcut
  was refused. It now falls back to the first visible category.
- **History opened on the current month even when every logged day was
  somewhere else** — after a gap, or restoring an older backup — showing
  four panels of zeros with only a bare "‹" hinting the data existed. It
  now opens on the most recent month that has something in it, and keeps
  wherever you navigate afterwards.
- **"Current streak" in the month summary read 0 for almost every month in
  progress**, while the streak card on the Day view showed the real number.
  It measured the run ending on the last day of the *calendar* month, so
  days that hadn't happened yet counted as missed. It now measures the run
  ending today, and an unlogged today doesn't break it — the same rule the
  Day view uses.
- **Week over week showed a green "▲ 5h" in your first week**, comparing
  against a week that doesn't exist. It now shows a dash, with a tooltip
  saying there's nothing to compare against — matching how the score and
  percentage rows already behaved.

### Changed

- Two month-summary tests were silently dependent on the date the suite ran
  on. They now pass an explicit date.

## [1.9.7] — 2026-08-29

Date and time correctness, from a dedicated audit of that area. The first
one affects anyone who works past midnight, which for a tool aimed at deep
work and study is not a rare case.

### Fixed

- **A tab left open across midnight wrote everything to the previous day.**
  The viewed date was captured once when the page opened and only ever
  moved by explicitly navigating, while the 30-second timer refreshed just
  the needle and the clock. So at 00:20 the header still said "Today", the
  clock face still showed the live time — and painting silently overwrote
  the *previous* day's early morning. The new day stayed empty, so it
  broke the streak, and the toolbar badge never saw the entry. The dial now
  notices the date changing (on the timer, on returning to the tab, and
  before any edit), rolls the view forward if you were sitting on today,
  and says so. Anyone who had deliberately navigated to a past day keeps
  their place.
- **An overnight typed entry folded the post-midnight half back onto the
  same day.** `11pm-1am study` painted 23:00–24:00 *and* 00:00–01:00 of one
  day — destroying whatever was already in that early hour, leaving the
  next day empty, and splitting a two-hour session into two blocks so
  "longest focus" read 60 minutes instead of 120. The part after midnight
  now goes to the next day, where it happened.
- **CSV import silently dropped every block that wasn't on a 15-minute
  boundary.** A row like `09:07,10:07` produced a fractional array index:
  the day imported completely empty while the import reported success and
  counted it — and under "Replace everything" that empty day overwrote a
  real one. Any CSV that had been through a spreadsheet, or came from a
  10-minute-grid tracker, imported as nothing. Times now round to the
  nearest slot, exactly as typed entry already did, and a block too short
  to represent is rejected with a message saying so.
- **Streaks were permanently one day short in timezones where the clocks
  go forward at midnight** (Havana, Santiago). The day-by-day walk
  normalized to 01:00 on the transition and never returned to midnight, so
  the final day was never counted — every streak, personal best, and
  weekly recap read one short from that day on, forever.

## [1.9.6] — 2026-08-29

Found by auditing the demo/onboarding flow as a whole rather than fixing
the reported symptom — several of these are considerably more serious than
the bug that prompted the review.

### Fixed

- **Merging a backup while demo mode was on silently destroyed the days it
  was supposed to restore.** A merge keeps the day already in place on any
  date collision, and demo mode occupies most of the last three weeks — so
  every real day in your file that landed on a demo date was skipped, the
  toast still said "Backup merged in", and leaving demo mode afterwards
  deleted those same dates. The data was neither imported nor kept, and the
  confirmation screen counted overlaps against fabricated days, so its
  numbers described an import that wasn't the one about to happen. Demo
  data is now cleared before any import is applied, and the confirmation
  counts only real days and says when demo data will be cleared.
- **Demo data could permanently contaminate your real history through a
  backup.** Exports and Google Drive backups serialized every day in
  storage, sample days included, and nothing in a backup file marks a day
  as fabricated. So: turn on demo mode, back up (the "you haven't backed
  up in a while" nudge sits right below the demo banner, actively
  suggesting it), turn demo off, and restore later — and seventeen
  invented days come back indistinguishable from real ones, with no way
  left to identify or remove them. Backups now exclude sample days, so a
  backup is always a copy of your data and only your data.
- **Editing a day while in demo mode, then leaving demo mode, deleted the
  edit.** Painting on a sample day left it on the sample list, so exiting
  demo removed the day you had just worked on. Editing a demo day now
  makes it yours, and leaving demo mode never touches it.
- **CSV export leaked demo days that JSON export had started refusing.**
  Both exports and the Drive backup now apply the same rule.
- **You couldn't revoke Google Drive access without first uploading to
  it.** "Disconnect" and "Delete backup" were shown only once a *sync time*
  existed, which only an upload sets — so restoring on a new machine linked
  the account, stored a file id, and then hid both controls permanently.
  The only way to earn the right to disconnect was to upload, the exact
  thing a privacy-minded user is avoiding, and the file lives in Drive's
  hidden app folder so there was no way out through Drive either. Both
  controls now appear whenever the account is linked at all, and the status
  line distinguishes "restored from" a backup from "synced to" one.
- **Google Drive backup no longer runs the whole Google sign-in flow just
  to upload an empty file.** Both file exports already refused to write an
  empty backup; Drive didn't, and reported success afterwards.
- **Skipping the welcome tour, or clicking outside it, left a new user on
  a blank dial with no guidance at all.** Only "Let's start" showed the
  first-run hint, so the two other ways out of the tour led straight back
  to the problem the tour exists to prevent. Every exit now leaves the
  hint (it's one dismissible line, not a lecture).
- **The first-run hint retired itself while the dial was still empty.** It
  keyed off "does any day record exist", but saving a reflection or
  clearing a day writes a record with nothing painted in it. It now uses
  the same "has anything actually been logged" test as the heatmap,
  streaks, and History's own empty state.

## [1.9.5] — 2026-08-29

### Changed

- **Demo mode is now a two-way door, at any point in an account's life.**
  It was previously offered only while you had logged absolutely nothing,
  so the most common way people actually ask for it — "let me see what
  this looks like once it's full" — was the one request it couldn't
  answer: paint a single real block and the option disappeared forever.
  It's now always available, and made safe by construction: sample days
  fill only dates that hold no day of your own, so entering and leaving
  demo mode can never touch, overwrite, or lose anything you logged. The
  round trip is verified byte-identical across repeated cycles.
- **Demo mode is now visibly signposted while it's on.** Sample data
  rendered identically to real data, so a 6-day streak or a +65 average
  gave no clue which it was. A banner now sits above every view for as
  long as sample data is loaded, saying so plainly and carrying its own
  one-click "Exit demo" — previously a three-level trip into
  Settings → About.
- **Settings → About no longer files a guided tour and fake data under one
  heading.** "Welcome tour" and "Demo mode" are separate sections with
  their own explanations, since replaying an intro and loading three weeks
  of fabricated days have nothing to do with each other.

### Fixed

- **"Let's start" no longer hands a new user a blank screen.** The only
  guidance after it was a toast that erased itself in 2.6 seconds, plus a
  line in the stats column on the opposite side of the window from the
  thing it was describing — so the tour ended by dumping you on an empty
  dial with nothing to act on. A hint now sits directly above the category
  pens, which is what it's pointing at, and stays until the first block is
  painted (or is dismissed outright).

## [1.9.4] — 2026-08-29

### Fixed

- **"Let's start" on the welcome overlay could silently do nothing.** Two
  compounding bugs, found via a full click-through re-audit rather than
  just re-testing the one reported button: (1) the overlay's footer sat in
  the same scrolling block as its content, so on any browser window shorter
  than ~780px tall, "Let's start" could render past the panel's clipped
  visible area — a click there landed on the backdrop instead and just
  closed the dialog, with no error and no toast. The footer is now sticky
  to the bottom of the panel, so it's always in reach regardless of scroll
  position or window height. (2) Even when the click did land correctly,
  the confirmation toast used that day's slots (not any day's data) to
  decide whether to speak up, and stayed silent whenever today happened to
  be blank — which is common for a returning user replaying the tour from
  Settings on a fresh day. It now always toasts, and checks the same
  "has this person ever used the extension" signal the sample-data link
  itself uses, so the message is consistent everywhere it's asked.

## [1.9.3] — 2026-08-29

### Added

- **Sample data is now discoverable where it actually matters**, not just
  buried in Settings → About → Demo mode: the welcome overlay itself has a
  "Prefer to see it with real numbers first? Load sample data instead" link
  that loads it and jumps straight to History in one click, and History's
  own empty state has the same shortcut inline, re-rendering in place with
  no tab switch needed. Both stay hidden the moment real data exists, same
  as every other sample-data entry point.

This follows a full re-audit of the whole onboarding/demo journey end to
end, not just the individual reports that prompted it — walked as a
genuinely new user would, in one continuous 7-step session (fresh boot →
sample data → Day view → Settings → clear → History's own link → replay
with real data present), verifying every transition rather than only the
one button in question. All 15 checks passed with zero exceptions.

## [1.9.2] — 2026-08-29

### Fixed

- Clicking "Let's start" on the welcome overlay closed it into silence —
  a dead end right when someone's most likely to need a next step. It now
  shows a one-line nudge ("Pick a category below, then drag around the
  ring to paint") — but only when the visible day is still genuinely
  blank, so replaying the tour later doesn't lecture someone who's
  clearly already painting. "Skip" and clicking outside stay silent, both
  meaning "I don't need the help."

## [1.9.1] — 2026-08-29

### Changed

- Moved "Load sample data" / "Clear sample data" from Settings → Data into
  a new "Demo mode" section in Settings → About, next to "Replay welcome
  tour" — the two exploration features now live together.

### Fixed

- Once real data existed, the "Try it with sample data" section stayed
  visible with both its buttons hidden — a section header and description
  pointing at nothing, which read as broken rather than inactive. The
  whole block now hides together whenever it has nothing reachable to
  offer, and reappears if sample data is later loaded or cleared.

## [1.9.0] — 2026-08-29

### Added

- **Sample data mode** (Settings → Data → "Load sample data"): fills in
  three realistic, varied weeks — a mix of strong and rough days, a couple
  left deliberately unlogged, a running streak, a couple of reflections —
  so History's heatmap, week-over-week, category trends, and the streak
  counter all have something real to show on a genuinely empty install.
  Only offered while there's zero real logged history, so it can never
  overwrite anything real; "Clear sample data" removes exactly the days it
  wrote, tracked by their own keys, regardless of what's been logged since.

## [1.8.3] — 2026-08-29

### Changed

- Replaced the static, stale hero screenshot (`docs/screenshot.png`, predating
  the current topbar/streak layout) with `docs/demo.gif` — a real recorded
  sequence of painting the dial, a typed entry landing, and the score
  updating live. Embedded at the top of the README and `GETTING_STARTED.md`.

### Removed

- `docs/screenshot.png` — superseded by the demo GIF above, and no longer
  referenced anywhere.

## [1.8.2] — 2026-08-29

### Added

- **Replay welcome tour** (Settings → About): brings back the same first-run
  welcome overlay on demand — for showing someone else around, or just a
  refresher, without needing to clear real data or dig through DevTools.
  Also linked the written [Getting started](docs/GETTING_STARTED.md) guide
  from the same spot, next to GitHub and Privacy.

## [1.8.1] — 2026-08-29

### Fixed

- The new first-run welcome overlay would have shown to **existing**
  installs too — anyone who already had logged history, on their very next
  reload after updating — since the "seen" flag never existed before this
  version. It now also treats any existing logged day as "already seen,"
  so the welcome screen only ever greets a genuinely empty, brand-new
  install. Verified with a pre-seeded day: overlay stays hidden.

## [1.8.0] — 2026-08-29

### Added

- **First-run welcome overlay**: shown once, the very first time the dial
  opens with nothing dismissed yet — three short cards covering painting,
  reading your score, and where settings live (Settings, reminders, goals,
  Drive backup). Dismiss with "Let's start," "Skip," or by clicking outside
  it; never shown again after that, tracked by its own flag rather than by
  whether any days are logged, so clearing your history later doesn't bring
  it back. See also `docs/GETTING_STARTED.md` for the written version.

## [1.7.4] — 2026-08-29

### Fixed

- The category alias field's placeholder showed the identical example —
  "also match: leetcode, resume, mock interview…" — under all six
  categories, including Break and Distraction, where it made no sense.
  Now shows `other words for "<category name>"…`, staying correct even
  through a rename.

## [1.7.3] — 2026-08-29

### Fixed

- Consolidated Drive backup onto a single OAuth client with both redirect
  URIs registered — the local dev extension ID's and the published Web
  Store ID's — instead of juggling separate clients per ID. Verified for
  real this time, not just mocked: a live Google account connected, backed
  up, and restored correctly (round-trip confirmed the restored day count
  matched exactly what was logged). One client now covers both testing and
  the eventual published build.

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
