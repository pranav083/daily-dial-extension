---
title: FAQ
description: Straight answers about how Daily Dial works and why it works that way.
---

# Questions people actually ask

## Why 15-minute blocks?

The dial has 96 slots of 15 minutes each. Finer resolution would make the drag target fiddlier and suggest false precision — nobody actually remembers a day to the minute. Shorter bursts in the hour naturally round to 15 minutes.

## How is the score calculated?

Your score is (productive − distraction) divided by whichever is larger: the weighted time you logged, or your daily target. Shown as a percentage from −100 to +100.

The target does the important work. Two productive hours against a four-hour target read 50, not 100 — so logging only your best hours can never flatter you, because the day you meant to have is still in the denominator. Neutral time sits outside the fraction, so logging a break costs nothing; distraction subtracts, because that is how you weighted it.

The target is the sum of your daily goals on productive categories, or four hours if you have not set any. Below 2 hours logged the score stays hidden and shows "too little logged" instead, since a barely-started day is not yet a day.

## What happens if I miss a day?

Nothing. Unlogged days aren't zeros — they simply vanish from your history, and averages skip them. The streak forgives one missed day per rolling 7 days.

## Does it work offline?

Yes, entirely. By default it makes no network request at all. The only exception is Google Drive backup, which is optional and stays off until you switch it on.

## Why can't I log time in the future?

Because it hasn't happened yet. Painting ahead inflates the day's total, its score, and the streak from something imagined rather than lived. You can erase the future, but only to remove what shouldn't be there.

## Can I change a block after painting it?

Yes. Painting over existing time is protected against accidents — a stroke stops at an existing block's edge. Press the block twice to replace it deliberately. Undo works with ⌘Z or Ctrl+Z, thirty steps deep. You can also drag the boundary between two blocks to shift just that seam.

## Where is my data?

In your browser profile, in `chrome.storage.local`. No account, no server. You can export a CSV or a full JSON backup whenever you want.

## Does it sync between computers?

Not automatically. Optional Google Drive backup can move your data between machines by exporting and restoring, but there's no live sync — that would require either a server or a tight storage quota.

## What languages does it speak?

Ten: English, Arabic, Chinese (Simplified), French, German, Hindi, Japanese, Portuguese (Brazil), Russian and Spanish. The app follows your browser's language, or you can choose in Settings → Appearance. Only Daily Dial's own words translate — anything you write stays exactly as you wrote it.

## Is it really free?

Yes, and open source under the MIT licence. No ads, analytics, telemetry, or paid tier.

## What does it not do?

It doesn't block sites, enforce anything, auto-capture what you're doing, manage tasks, or connect to your calendar. It shows you where the time went and stops there. Guides on the site cover tools that handle the blocking part.

Still stuck? [Open an issue](https://github.com/pranav083/daily-dial-extension/issues/new/choose) — questions are welcome, not just bugs.

## Can I change a category's colour?

Yes. Settings → Categories, and click the swatch beside a category's name —
that swatch is the picker. The ring, the pens, the week strip, the bars, the
History calendar and the shared image all change together. The ↺ beside it
puts the slot back to its default, which also puts it back under the theme's
control, so it follows light and dark again.

## How many categories are there?

Ten slots. Six are on to begin with; Exercise, Sleep, Social and Errands are
there and switched off. Days store the slot rather than the name, so renaming
or recolouring a category never rewrites history.

## What happens if I miss a day of a challenge?

It ends, and the card says which day it ended on and how long your best run
was. That is deliberate: twenty-one days means twenty-one days in a row, and a
run that tolerates gaps is a weaker thing wearing the same name. One button
restarts the same challenge from today.

Today never breaks a run, because today is not over yet.

## Reminders never appear. How do I find out why?

Work down this list; it is ordered by how often each one is the answer.

**1. Press "Send a test reminder"** (Settings → Reminders). It fires one
immediately.

- If it appears, reminders work. Check the "Next reminder" line right above
  the button — turning reminders on at 2pm with a 1pm time schedules the first
  for *tomorrow*, which looks exactly like nothing happening.
- If nothing appears, the notification is being stopped outside the extension.
  Keep going.

**2. Check your operating system.** Notifications from an extension are
delivered by the system, not by Chrome alone.

- **macOS**: System Settings → Notifications → Google Chrome → *Allow
  notifications*. Also check Focus / Do Not Disturb.
- **Windows**: Settings → System → Notifications → Google Chrome. Also check
  Focus assist.
- **Linux**: whatever your desktop uses for notifications must be running.

**3. Check Chrome itself**: `chrome://settings/content/notifications`.

**4. Watch the toolbar icon instead.** When a reminder is due the extension
puts a **!** on its own badge, with "Time to log your day" as the tooltip.
That is drawn by the extension, so nothing outside it can suppress it. It
clears when you open the day or log anything.

**5. Chrome has to be running.** Alarms do not fire when it is closed, and a
reminder whose time passed while Chrome was shut does not arrive late.

If you want to see the schedule directly: `chrome://extensions` → Daily Dial →
*service worker* → Console, then run
`chrome.alarms.getAll().then(console.log)`. Each enabled reminder appears as
`reminder-0` / `reminder-1` with its next `scheduledTime`.
