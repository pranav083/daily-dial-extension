# Privacy Policy — Daily Dial

**Last updated: 29 August 2026**
**Applies to: Daily Dial Chrome extension, all versions**

## The short version

By default, Daily Dial collects nothing and makes no network request of any
kind — everything you log stays in your own browser, on your own computer.
There is exactly one exception, and it is off until you turn it on yourself:
**optional Google Drive backup**. If you connect it, a copy of your data is
sent to a private folder in your own Google Drive — not to any server of
ours, since we don't have one. There is still no account with us and still no
analytics, with or without Drive backup turned on.

The rest of this policy covers both: what's true always, and what's true only
if you opt into Drive backup.

## What is stored, and where

The extension stores the following in `chrome.storage.local`, a private area of
your Chrome profile on your own device:

- The blocks of time you paint on the dial (a category and a time range per day)
- The optional one-line note you may write for a day
- Your category names, weights, and which ones are hidden
- Your reminder preferences (on/off and two times of day)
- If you've used Google Drive backup: the id of your backup file, its size,
  when you last synced, and the email address of the connected Google
  account — so the extension knows where to write next time, and so it can
  show you which account that is. That's bookkeeping about the connection,
  not your data itself — your data is covered next.

That is the complete list of what's stored locally. Nothing else is recorded.

## Optional: Google Drive backup

Off by default. If you turn it on, in Settings → Data:

- Signing in uses Google's own OAuth flow (via Chrome's `identity` API) — the
  extension receives a temporary access token from Chrome, never your Google
  password.
- "Back up now" sends your full backup (days, categories, settings — the same
  content as a JSON export) to a single file in **`appDataFolder`**, a storage
  space Google reserves for exactly this purpose: private to this extension,
  invisible in your regular Drive, and inaccessible to any other app or
  person browsing your Drive.
- "Restore from Google Drive" downloads that file and opens the same
  merge/replace confirmation as restoring from a local file — nothing is
  applied without you choosing which.
- The permissions requested — `https://www.googleapis.com/auth/drive.appdata`
  and `https://www.googleapis.com/auth/userinfo.email` — cannot see, list, or
  touch any other file in your Drive, and cannot read your name, photo, or
  anything else about the account. The second scope exists for exactly one
  reason: showing you, in Settings → Data, which Google account is currently
  connected — otherwise there'd be no way to tell "am I about to back up to
  the account I think I am." It's read once per connection, shown on that
  same screen, and never leaves your device — there's still no server of
  ours for it to go to.

This is the only feature in Daily Dial that sends data anywhere. It's
initiated by you, goes to an account you control, and stops the moment you
stop using it — nothing syncs in the background on a timer.

**Once your data is in Google Drive, Google's own privacy policy governs that
copy**, the same as it would for any file you saved there yourself.

## What is not collected

Whether or not you use Drive backup:

- No personal information beyond one exception: connecting Google Drive backup
  reads and displays the connected account's email address, solely so you can
  see which account it is (above). No name, photo, or other profile data is
  ever requested. There is still no account with us of any kind.
- No browsing history, page contents, URLs, or tabs
- No analytics, telemetry, usage statistics, or crash reports
- No advertising or tracking identifiers
- No location data
- No device or hardware identifiers

## No network access, except the Drive backup you turn on yourself

This is enforced structurally, not just by policy:

- It declares **no host permissions** — the Drive backup feature reaches
  Google's API through a plain `fetch()` from an extension page, which
  doesn't require one, so this claim holds even with Drive backup available
- It runs **no content scripts**, so it never executes code in your web pages
  and cannot read them
- It loads **no remote resources for the app itself** — fonts and icons are
  bundled in the extension package; the only outbound requests it is capable
  of are the Drive API calls described above, and only once you've signed in
- It contains **no third-party analytics, tracking, or advertising code**

You can verify all of this: the source is public at
<https://github.com/pranav083/daily-dial-extension> and the entire extension is
a few small files of unminified JavaScript.

## Permissions, and why each is needed

| Permission | Purpose |
|---|---|
| `storage` | Save your logged days, categories, and settings on your device |
| `unlimitedStorage` | Allow years of daily history without hitting Chrome's default quota |
| `alarms` | Schedule the two optional daily reminders |
| `notifications` | Display those reminders |
| `identity` | Only used if you turn on Google Drive backup, to sign you in with Google |

The extension deliberately does **not** request the `tabs` permission, which
would allow reading your browsing history. It tracks only its own tab, using
`chrome.storage.session`.

## Who can see your data

Only you, by default — because nothing is transmitted, there is no one else
who could see it, not the developer, not any third party, and no service
provider of ours. There is no server of ours to breach and no database of
ours to subpoena.

If you turn on Google Drive backup, your data additionally exists in a
private, app-only corner of your own Google Drive. That copy is visible to
you (through the extension, or through Google's own account data-management
tools) and to Google, under Google's privacy policy — not to us, and not to
any other Drive app or person you've shared other files with.

Anyone with access to your unlocked computer and Chrome profile can read the
local data, in the same way they could read any other website's stored data.
The extension does not encrypt it at rest.

## Data sharing and sale

Your data is never shared, sold, rented, or transferred by us to anyone, for
any purpose. Google Drive backup isn't "sharing" in that sense either: it's a
copy you send, to an account you already own, that you can disconnect or
delete at any time — see below.

## Retention and deletion

Your data stays until you remove it. You are always in control:

- **Clear one day** — the "Clear day" button in the extension
- **Delete everything locally** — remove the extension via `chrome://extensions`,
  which deletes all of its locally stored data
- **Keep a copy** — "Export CSV" or "Export JSON backup" saves your full
  history to a file you control

If you've used Google Drive backup, disconnecting (Settings → Data →
"Disconnect Google Drive") only revokes the extension's access — it does not
delete the backup file, since `appDataFolder` content doesn't appear in your
regular Drive for you to delete it there. Use **"Delete Drive backup"** in the
same panel to permanently remove that file; it's a separate, deliberately
two-step action since it can't be undone. Deleting it there has no effect on
your local data on this device, and vice versa — the two are independent
copies once Drive backup has run.

## Children's privacy

The extension collects no data from anyone, including children under 13, and is
compliant with COPPA by virtue of collecting nothing itself. If a parent or
guardian chooses to enable Google Drive backup, that is subject to Google's
own account terms, the same as any other use of Google Drive.

## Your rights

Regulations such as the GDPR and CCPA grant rights to access, correct, delete,
and port your personal data. Because Daily Dial itself stores nothing about
you on any server of ours, these rights are satisfied directly: your data is
already in your possession, editable in the extension, deletable at any time,
and exportable as CSV or JSON. If you've used Drive backup, your existing
rights over your own Google account cover that copy as well — you can access,
export, or delete it through Google directly, or through this extension's own
Restore/Delete actions.

There is no data controller of ours holding information about you, and no
request to submit to us.

## Changes to this policy

Any change will be published in this file and noted in
[CHANGELOG.md](CHANGELOG.md), with the "Last updated" date above revised. The
28 August 2026 → 29 August 2026 revision is the first substantive one: it adds
the optional Google Drive backup feature described above. Nothing before that
date sent data anywhere.

## Contact

Questions about this policy can be raised as an issue at
<https://github.com/pranav083/daily-dial-extension/issues>, or privately through
[GitHub's private vulnerability reporting](https://github.com/pranav083/daily-dial-extension/security/advisories/new).
