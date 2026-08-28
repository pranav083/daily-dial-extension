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

- **No network access.** No host permissions, no `fetch`, no remote scripts, no
  remote fonts, no analytics. The extension cannot phone home because it has no
  ability to make a request.
- **No content scripts.** It never runs code in your pages and cannot read them.
- **No `tabs` permission.** Chrome presents that as "read your browsing
  history"; the extension tracks its own tab via `chrome.storage.session`
  instead.
- **No third-party runtime code.** The extension ships only its own source plus
  two font files. ESLint is the sole development dependency.
- **All data is local**, in `chrome.storage.local`, on your machine.

Permissions requested, in full:

| Permission | Why |
|---|---|
| `storage` | Store your days, categories, and settings |
| `unlimitedStorage` | Keep years of history past the default quota |
| `alarms` | Schedule the two daily reminders |
| `notifications` | Show them |

## Things that would be bugs

Worth reporting:

- Any outbound network request
- Stored data readable by another extension or by a web page
- A crafted value in `chrome.storage` causing script execution when rendered
  (the insight line is the only place the extension writes HTML; every
  interpolated value should be a number or an escaped category name)
- The extension requesting a permission not listed above

## Things that are not vulnerabilities

- **Data is lost if you delete your Chrome profile or the extension.** That is
  how local-only storage works. Export a CSV to keep a copy.
- **Data is not encrypted at rest.** It sits in your browser profile with the
  same protection as any other site's data. Anyone with access to your unlocked
  machine can read it.
- **Reminders don't fire when Chrome is closed.** A limitation of extensions,
  not a defect.
- **Moving the extension folder orphans your data.** Chrome derives an unpacked
  extension's ID from its path, and storage is keyed to that ID.
