# Setting up Google Drive backup

Daily Dial's optional Drive backup (Settings → Data) is fully built and
wired up, but it can't authenticate with anything until you create your own
OAuth Client ID in Google Cloud Console and paste it into `manifest.json`.
This is the one step in the whole project that has to happen outside this
repo, in your own Google account — nobody can do it for you, including an AI
assistant, since it requires clicking through Google's own console as
yourself.

Good news: for your own personal use, this takes about ten minutes and costs
nothing, and doesn't require Google's app-verification review at all (that's
only needed once you want people *other than a handful you personally add*
to use Drive backup — see the note at the end).

## Before you start: get your extension's ID

The OAuth Client ID you're about to create is registered against one
specific extension ID, so you need that ID first.

- **Testing unpacked, loaded from source:** Chrome derives the ID from a key
  it generates the first time you load the folder, and normally that key
  isn't checked into git — so the ID would be different on every machine
  that loads it. Pin it instead: load the extension unpacked once
  (`chrome://extensions` → Developer mode → Load unpacked), then Chrome
  shows you its generated ID on the extensions page. Note it down; as long as
  you keep loading from the same folder path on the same machine, it stays
  stable.
- **Publishing to the Chrome Web Store:** upload a first draft (even
  unlisted, even before Drive backup works) to get a *permanent* ID from the
  Web Store — visible on the item's page in the
  [developer dashboard](https://chrome.google.com/webstore/devconsole). Use
  this one for the OAuth client if you're publishing; it won't change again.

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in with the Google
   account you want backups to live in (this can be the same account you'll
   later use *inside* Daily Dial to back up, but it doesn't have to be).
2. Top bar → project dropdown → **New Project**. Any name (e.g. "Daily Dial
   Drive Backup"). No billing account is required for this.

## 2. Enable the Drive API

1. In the left sidebar: **APIs & Services → Library**.
2. Search for **Google Drive API** and click **Enable**.

## 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** (this doesn't mean "public" — see the note at the
   end; anyone not in your Google Workspace organization needs this option
   regardless of how many people will actually use it).
3. Fill in the required fields: app name (e.g. "Daily Dial"), your email as
   the support email and developer contact.
4. **Scopes** step: **Add or remove scopes**, then either search for "Drive
   API" and pick the one whose description matches *"See, create, and
   delete its own configuration data in your Google Drive"* (that's
   `drive.appdata`), or paste it directly into the manual box:
   ```
   https://www.googleapis.com/auth/drive.appdata
   ```
   Don't add any other Drive scope — this is the one that keeps the whole
   feature narrowly sandboxed to files this extension creates itself.
5. **Test users** step: add your own Google account email (and anyone
   else's you want able to use Drive backup right away). Save.
6. Leave **Publishing status** as **Testing**. See the note at the end for
   what this means and when (if ever) you'd need to change it.

## 4. Create the OAuth Client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Chrome Extension**.
3. Name: anything (e.g. "Daily Dial").
4. **Item ID**: paste the extension ID from the step before section 1.
5. Create. Copy the **Client ID** shown — it ends in
   `.apps.googleusercontent.com`. You won't need the client secret; Chrome
   extensions don't use one for this flow.

## 5. Wire it into the extension

Open `manifest.json` and replace the placeholder:

```diff
   "oauth2": {
-    "client_id": "REPLACE_WITH_YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com",
+    "client_id": "123456789-abcxyz.apps.googleusercontent.com",
     "scopes": ["https://www.googleapis.com/auth/drive.appdata"]
   },
```

Reload the extension (`chrome://extensions` → the reload icon on Daily
Dial's card, or re-upload if you're testing from the Web Store draft).

## 6. Test it

Open Daily Dial → Settings → Data → **Back up to Google Drive**. The first
click opens Google's standard consent screen (it'll say "unverified" while
in Testing status — that's expected and fine for an app only you and your
test users use; click **Advanced → Go to Daily Dial (unsafe)** to proceed,
same as any app in Testing). Approve, and it should back up immediately.
**Restore from Google Drive** and **Delete Drive backup** use the same
connection.

If it fails, open the page's DevTools console (right-click the extension
page → Inspect) — `driveBackupNow`/`driveRestore` log the real error there
before showing a generic toast. Common causes: the extension ID pinned in
the OAuth client doesn't match the one Chrome is actually running with, or
the client ID wasn't saved into `manifest.json` correctly.

## Do you ever need to leave "Testing" and get verified?

Only if you want people beyond the test users you've manually added (Google
caps this at 100) to be able to use Drive backup. Since `drive.appdata` is
classified as a **sensitive** (not **restricted**) scope, moving to
"In production" typically requires Google's standard OAuth verification
review rather than the longer restricted-scope security assessment — but
requirements and turnaround change on Google's side independently of this
doc, so check the current requirements in the Cloud Console when you get
there rather than trusting a specific timeline here.

For personal use, or sharing with a small number of people you know, staying
in **Testing** indefinitely is the simplest option and needs no review at
all — the "unverified app" screen is just one extra click for your test
users, forever.
