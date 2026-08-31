---
title: Privacy
description: What Daily Dial does and does not do with your data — in plain language.
---

# What happens to your data

## The short version

Daily Dial doesn't upload anything by default. Your logged time, categories, and reminders live in `chrome.storage.local`—a private storage area built into your browser profile on your own computer. Nothing goes to any server. There's no account, no sign-up, and no email address collected.

There is one exception, and it's entirely optional: Google Drive backup. If you turn it on, a copy of your data goes to a private folder in your own Google Drive. Only you can see it. It's off until you switch it on, and you can disconnect or delete it whenever you like.

## What it stores and where

Everything the extension saves lives in your browser:

- The time blocks you paint each day (category and time range)
- Optional daily notes
- Your category names, weights, and which ones are hidden
- Your reminder times
- If you use Drive backup: the ID of that backup file, when you last synced, and the email address of the connected Google account (so the extension knows where to save next time)

That's the complete list. Nothing else is recorded anywhere.

## What it never does

Daily Dial doesn't collect browsing history, page contents, or URLs. It doesn't track you—no analytics, no telemetry, no crash reports, no usage statistics, no advertising IDs. It doesn't know what websites you visit or what other tabs you have open. It doesn't read your name, profile photo, or any other account information beyond the one email address it shows you when Drive backup is connected.

The only network requests the extension can make are to Google's API if you turn on Drive backup. There's no way for it to contact any other server, even if someone tried to make it—Chrome's sandboxing prevents that.

## The permissions, one by one

Daily Dial asks for five permissions:

**`storage`** — saves your logged days, categories, and settings on your device.

**`unlimitedStorage`** — lets you keep years of daily history without bumping into Chrome's default storage limit.

**`alarms`** — powers the two optional daily reminders you can set.

**`notifications`** — displays those reminders when they fire.

**`identity`** — only used if you turn on Google Drive backup, to sign you in with Google.

Notice what's missing: the `tabs` permission. A time logger has no business reading your browsing history, and Daily Dial deliberately doesn't ask for it. This permission would expose your tabs to the extension code; instead, the extension uses a narrower API that tracks only its own tab.

All the fonts and icons are bundled inside the extension. There are no remote resources, no third-party analytics SDKs, no Google Fonts loaded from the internet. MV3's content security policy blocks remote fonts anyway, so bundling them was simpler and safer.

## The one exception: Google Drive

If you connect Google Drive backup in Settings → Data, here's what happens:

Your data is encrypted in transit and sent to Google's `appDataFolder`—a private storage space Google reserves for exactly this purpose. It's invisible in your normal Drive. No other app can see it, and nobody browsing your Drive can access it.

The scope the extension requests—`drive.appdata` and `userinfo.email`—cannot read any other file in your Drive, and cannot access your name, photo, or profile. The email scope exists for one reason: so the Settings screen can show you which Google account you're connected to. It's read once per connection, displayed on that screen, and never stored or transmitted anywhere.

Backups don't sync in the background. You control when to back up and when to restore. Disconnect or delete the backup file at any time. Once it's deleted, it's gone.

After your data reaches Google Drive, Google's own privacy policy covers that copy, the same as any file you saved there yourself. Daily Dial has no server, no database, and no ongoing access to your backups—once they're on your Drive, only you and Google can see them.

## How to check for yourself

The source code is public on GitHub at [github.com/pranav083/daily-dial-extension](https://github.com/pranav083/daily-dial-extension). Every line is unminified and readable. You can download the published extension and compare it against a git tag to verify the build matches the open source.

All of this is enforced structurally, not just by policy. The manifest declares no host permissions. There are no content scripts. The code is small and straightforward—it's easy to audit for yourself if you want to.

---

The full technical statement is in [PRIVACY.md](https://github.com/pranav083/daily-dial-extension/blob/main/PRIVACY.md), and the source is [on GitHub](https://github.com/pranav083/daily-dial-extension).
