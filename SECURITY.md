# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/pranav083/daily-dial-extension/security/advisories/new)
rather than opening a public issue.

Include what you did, what happened, and which version (shown beside the
wordmark in the extension, and in `manifest.json`). You should get a first
response within a week. This is a small hobby project maintained in spare time —
if something is urgent, say so plainly in the report.

## Supported versions

Only the latest release is supported. Fixes ship in a new version rather than
being backported.

## Threat model

Daily Dial's security posture rests mostly on what it *doesn't* do:

- **No network access, except one feature you have to turn on yourself.**
  No host permissions, no remote scripts, no remote fonts, no analytics. The
  only outbound requests the extension is capable of are the optional Google
  Drive backup calls, and only after you've explicitly connected an account
  in Settings → Data — see below.
- **No content scripts.** It never runs code in your pages and cannot read them.
- **No `tabs` permission.** Chrome presents that as "read your browsing
  history"; the extension tracks its own tab via `chrome.storage.session`
  instead.
- **No third-party runtime code.** The extension ships only its own source plus
  two font files. ESLint is the sole development dependency. Google Drive
  backup calls Google's own public API directly; nothing third-party is
  loaded or executed.
- **All data is local by default**, in `chrome.storage.local`, on your machine.

### Google Drive backup, specifically

Optional and off by default. When you turn it on:

- Sign-in goes through Chrome's own `identity` API (`chrome.identity`), which
  wraps Google's standard OAuth consent screen — the extension never sees or
  handles your Google password, only a short-lived access token that Chrome
  manages.
- The OAuth scope requested is `drive.appdata` — scoped to a single
  per-app storage folder that this extension cannot list or browse beyond the
  one file it creates. This token cannot read, modify, or even see any other
  file in your Drive.
- "Disconnect" revokes that token with Google and clears Chrome's cache of it.
  "Delete Drive backup" separately removes the file itself — the two are
  independent since revoking access doesn't delete `appDataFolder` content.
- All requests go to `www.googleapis.com` and `accounts.google.com` over
  HTTPS with a bearer token; no other destination is ever contacted.

Permissions requested, in full:

| Permission | Why |
|---|---|
| `storage` | Store your days, categories, and settings |
| `unlimitedStorage` | Keep years of history past the default quota |
| `alarms` | Schedule the two daily reminders |
| `notifications` | Show them |
| `identity` | Sign in with Google, only if you turn on Drive backup |

## Things that would be bugs

Worth reporting:

- Any outbound network request to a destination other than
  `www.googleapis.com` / `accounts.google.com`, or one that fires without the
  user ever having connected Google Drive backup
- Stored data readable by another extension or by a web page
- A crafted value in `chrome.storage` causing script execution when rendered
  (the insight line and the share-image builder are the only places the
  extension writes markup from stored data; every interpolated value should
  be a number, a formatted date, or an escaped category/reflection string)
- A Drive API call that requests a broader scope than `drive.appdata`, or
  that could plausibly touch a file this extension didn't create itself
- The extension requesting a permission not listed above

## Things that are not vulnerabilities

- **Data is lost if you delete your Chrome profile or the extension**, and
  Drive backup (if you never turned it on) doesn't change that. That is how
  local-only storage works. Export a backup, or connect Google Drive, to keep
  a copy.
- **Data is not encrypted at rest**, locally or in your Google Drive. It sits
  with the same protection as any other site's data or any other file in your
  Drive. Anyone with access to your unlocked machine, or your signed-in
  Google account, can read it.
- **Disconnecting Google Drive doesn't delete the backup file.** That's
  intentional — see [PRIVACY.md](PRIVACY.md#retention-and-deletion) for the
  separate "Delete Drive backup" action.
- **Reminders don't fire when Chrome is closed.** A limitation of extensions,
  not a defect.
- **Moving the extension folder orphans your data.** Chrome derives an unpacked
  extension's ID from its path, and storage is keyed to that ID.
