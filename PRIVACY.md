# Privacy Policy — Daily Dial

**Last updated: 28 August 2026**
**Applies to: Daily Dial Chrome extension, all versions**

## The short version

Daily Dial collects nothing. It has no server, no account, and no ability to
make a network request. Everything you log stays in your own browser, on your
own computer.

## What is stored, and where

The extension stores the following in `chrome.storage.local`, a private area of
your Chrome profile on your own device:

- The blocks of time you paint on the dial (a category and a time range per day)
- The optional one-line note you may write for a day
- Your category names, weights, and which ones are hidden
- Your reminder preferences (on/off and two times of day)

That is the complete list. Nothing else is recorded.

## What is not collected

- No personal information — no name, email address, or account of any kind
- No browsing history, page contents, URLs, or tabs
- No analytics, telemetry, usage statistics, or crash reports
- No advertising or tracking identifiers
- No location data
- No device or hardware identifiers

## Data is never transmitted

The extension makes no network requests. This is enforced structurally, not just
by policy:

- It declares **no host permissions**, so Chrome will not permit it to contact
  any server
- It runs **no content scripts**, so it never executes code in your web pages
  and cannot read them
- It loads **no remote resources** — fonts and icons are bundled in the
  extension package
- It contains **no third-party or analytics code**

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

The extension deliberately does **not** request the `tabs` permission, which
would allow reading your browsing history. It tracks only its own tab, using
`chrome.storage.session`.

## Who can see your data

Only you. Because nothing is transmitted, there is no one else who could see it
— not the developer, not any third party, and no service provider. There is no
server to breach and no database to subpoena.

Anyone with access to your unlocked computer and Chrome profile can read the
data, in the same way they could read any other website's stored data. The
extension does not encrypt it at rest.

## Data sharing and sale

None. Your data is never shared, sold, rented, or transferred to anyone, for any
purpose, because it never leaves your device.

## Retention and deletion

Your data stays until you remove it. You are always in control:

- **Clear one day** — the "Clear day" button in the extension
- **Delete everything** — remove the extension via `chrome://extensions`, which
  deletes all of its stored data
- **Keep a copy** — "Export CSV" saves your full history as a spreadsheet file

Because the data is local, deleting it is immediate and complete. There is no
copy elsewhere to request deletion of.

## Children's privacy

The extension collects no data from anyone, including children under 13, and is
compliant with COPPA by virtue of collecting nothing.

## Your rights

Regulations such as the GDPR and CCPA grant rights to access, correct, delete,
and port your personal data. Because Daily Dial stores nothing about you on any
server, these rights are satisfied directly: your data is already in your
possession, editable in the extension, deletable at any time, and exportable as
CSV.

There is no data controller holding information about you, and no request to
submit.

## Changes to this policy

Any change will be published in this file and noted in
[CHANGELOG.md](CHANGELOG.md), with the "Last updated" date above revised. Since
the extension collects nothing, changes would only ever narrow this further.

## Contact

Questions about this policy can be raised as an issue at
<https://github.com/pranav083/daily-dial-extension/issues>, or privately through
[GitHub's private vulnerability reporting](https://github.com/pranav083/daily-dial-extension/security/advisories/new).
