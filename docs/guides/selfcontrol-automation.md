---
title: Automate SelfControl without letting it start on its own
description: Scheduling the reminder rather than the block, four things SelfControl's source says that its docs don't, and the day a block on Reddit broke LinkedIn.
---

# Automate SelfControl without letting it start on its own

[The blocking guide](blocking-sites.html) covers which blocker to pick. This
one is what happens after you've picked SelfControl and want it running on a
schedule.

Everything here is in
[`guides/selfcontrol/`](https://github.com/pranav083/daily-dial-extension/tree/main/docs/guides/selfcontrol)
— four shell scripts, a blocklist of 382 domains, and the generator that
builds it, MIT licensed like the rest of the repo. Take what's useful and
ignore the rest; the blocklist in particular is mine and yours won't look like
it.

Fair warning that most of the value below is in the things that went wrong.

## The one decision that matters

The obvious thing to build is a cron job that starts a block at 10am every
weekday. That's what I built first. Don't.

A block you didn't consciously start is a block that catches you
mid-something — on a call that needs a doc you've just blocked, or ten minutes
before you need a site that's now gone for two hours. And you can't undo it.
It happened to me once and I very nearly deleted the whole thing.

So invert it. **The schedule fires a reminder. You start the block.** Nothing
here calls `selfcontrol-cli start` on a timer, ever.

| Component | Runs | What it does |
|---|---|---|
| `selfcontrol-focus-reminder.sh` | On a schedule (`StartCalendarInterval`) | Sends one notification and exits. Starts nothing. Stays quiet if a block is already active. |
| *You* | Deliberately | Press Start, in the app or via the script. The only thing that ever begins a block. |
| `selfcontrol-focus-watch.sh` | Always (`KeepAlive` + `RunAtLoad`) | Polls every 30s. Sees a block begin and end — however it began — and sends every notification. |
| `selfcontrol-focus.sh` | By hand | Starts a block now from your config. Also `--status` and a two-minute `--test`. |

Splitting it this way has a payoff worth naming: because the watcher is the
*only* thing that notifies, and it reacts to the block's actual state rather
than to whatever launched it, you never get duplicate notifications. Start
from the app, from the script, or from a reminder you clicked — one start
notification, one finish notification, every time.

## Installing it

**1. Install SelfControl and a notifier that can be clicked.**

```
brew install --cask selfcontrol
brew install terminal-notifier
```

`terminal-notifier` is worth the extra install: unlike a plain `osascript`
banner, its notifications carry a click action, so the reminder can open
SelfControl for you. Every script here falls back to `osascript`
automatically, so a missing authorization degrades to a plain banner rather
than to silence.

**2. Authorize notifications once, by hand.** Do this first, because the
failure is silent.

```
terminal-notifier -message "test" -title "SelfControl"
```

If no prompt appears and nothing shows up, open **System Settings →
Notifications → terminal-notifier** and set the alert style — it can sit at
"None" until you touch it. On the machine this was built on, neither the
tool's own prompt nor `tccutil reset UserNotification` could grant this. The
Settings pane was the only thing that worked.

**3. Put the files in place.**

```
mkdir -p ~/.config/selfcontrol-focus ~/.local/bin
cp selfcontrol/sites.txt selfcontrol/test-sites.txt \
   selfcontrol/update_blocklist.py selfcontrol/*.selfcontrol \
   ~/.config/selfcontrol-focus/
cp selfcontrol/selfcontrol-focus*.sh ~/.local/bin/
chmod +x ~/.local/bin/selfcontrol-focus*.sh
```

**4. Edit the blocklist as text, then compile it.**

`sites.txt` is grouped by category — video, social, messaging, then news by
country and language. Edit that, never the `.selfcontrol` file:

```
python3 ~/.config/selfcontrol-focus/update_blocklist.py
```

It backs up the previous blocklist and prints a diff of what changed, which
turns "why is this site blocked?" into a question with an answer. Delete
generously — anything you genuinely need for work should come out, and it is
worth leaving a comment saying so, since a bare deletion looks like an
oversight to future-you.

**5. Set the schedule.**

```
~/.local/bin/selfcontrol-focus-setup.sh
```

An interactive wizard: which days, what time. It writes the config and
generates and loads both LaunchAgents. Run it again any time to change the
schedule, or hand-edit the config and apply with `--apply`.

```
launchctl list | grep selfcontrol-focus    # both loaded?
```

**6. Test with two minutes, not two hours.**

```
~/.local/bin/selfcontrol-focus.sh --test
```

That starts a two-minute block against the small `test.selfcontrol` list.
Watch the whole cycle — start notification, YouTube actually failing to load,
finish notification — before you trust it with a real afternoon. Two minutes
is long enough to verify and short enough to be no punishment when something
is wrong.

## Four things the source says and the docs don't

**`is-running` prints to stderr, not stdout.** It reports through `NSLog`,
which goes to standard error. So if you capture stdout — which is what
everyone does — you get an empty string back, read it as "no block running",
and cheerfully start a second one. Use `2>&1`. This cost me an hour and it's
the one line in this post I'd keep if I had to cut the rest.

**The 24-hour cap exists only in the GUI.** `MaxBlockLength` constrains the
duration slider in the app's own controller and nothing else. The daemon
method behind the CLI's `--enddate` honours whatever date it is given. A typo
in a script can therefore commit you to a block measured in days, with no way
out. `selfcontrol-focus-setup.sh` has its own confirmation gate above 24 hours
for exactly this reason: the GUI protects you automatically, the CLI does not.

**There's genuinely no early stop.** The CLI gives you `start`,
`is-running`, `print-settings` and `version`, and that's the lot. No GUI
button either. The app's own "extend" feature refuses any end date earlier
than the current one, and `print-settings` carries a `TamperingDetected` flag,
so the clever workarounds people reach for have been thought about already.
Nothing here tries to stop or shorten a block, mostly because nothing could.

**No sudo, ever.** The privileged work happens in a root-owned LaunchDaemon
the installer already set up, and the CLI talks to it over XPC — the binary
itself is not setuid. All of this runs as your normal user with no password
prompts.

## The afternoon a block on Reddit broke LinkedIn

Know about this one before it happens, because you can't fix it while it's
happening.

Halfway through a block, LinkedIn started rendering as raw unstyled HTML.
Greenhouse job pages too. Neither is on my blocklist. The console showed
`ERR_CONNECTION_REFUSED` on their asset hosts — not a 404, not a timeout, a
flat refusal coming back in about twenty milliseconds. My phone loaded both
fine on the same wifi, and every browser on the Mac was broken the same way,
so it wasn't Chrome being Chrome.

I spent a while assuming I'd fat-fingered something into the blocklist. I
hadn't.

SelfControl blocks by resolving each domain on your list and adding firewall
rules for the resolved addresses. The list has Reddit on it. Reddit is behind
Fastly. So are LinkedIn's and Greenhouse's asset CDNs — and large CDNs hand
out a small pool of anycast addresses across enormous numbers of unrelated
customers. The address blocked on Reddit's behalf was, that afternoon, also
serving somebody else's stylesheets.

I probed neighbouring addresses across the surrounding range and they all
connected fine, so it wasn't a broad range block — just one unlucky address.
Working out exactly which blocklist entry caused it would mean reading the
live firewall ruleset as root, which I couldn't do without a password prompt I
wasn't going to get mid-block. Which is itself a decent illustration of how
little you can inspect from inside one of these.

**There's no fix. You wait.** The block ended at 2:49pm and everything worked
again at 2:49pm. When the whole selling point of a tool is that you can't stop
it, "I'll just stop it" isn't on the table — and the collateral damage lands
on sites you never chose to block in the first place.

If it happens to you: check the console for `ERR_CONNECTION_REFUSED`
specifically, `curl -v` the failing host (a fast connection-refused is a
firewall signature, a multi-second timeout is something else), and check
whether the resolved address sits on shared CDN infrastructure that something
on your list also uses. Verify it has cleared afterwards by curling the asset
host and looking for any real HTTP response.

The lesson is about what you put on the list, not about the tooling. Every
big consumer site on a shared CDN is a small bet that you won't need one of
its address-neighbours for the next two hours. Reddit's worth that bet. Two
hundred obscure domains, each dragging in whatever address it happens to
resolve to that day, is a bigger bet than it looks — and I've since trimmed
mine on exactly that reasoning.

## Things that will bite you

- **LaunchAgents only run while you are logged in.** Mac asleep or sitting at
  the login screen at 10am? That day's reminder never fires, and launchd does
  not retry it afterwards.
- **Sleep delays the watcher, not the block.** The polling loop pauses with
  the system, so a notification can arrive late. The block itself is enforced
  by a root daemon and does not care.
- **You cannot edit a running block's list.** By design — if you could add
  sites you could remove them. Edit `sites.txt` and recompile *before* you
  press Start.
- **Notifications are transient and logs are raw text.** `selfcontrol-focus.sh
  --status` prints whether a block is active, the current streak and the next
  reminder in plain English. It is read-only and safe to run mid-block, and it
  is the command you will actually use.

## Counting streaks without lying to yourself

Every completed block bumps a consecutive-day counter, shown in the finish
notification. Two decisions in it needed more thought than expected.

**A gap of up to three days still counts.** Otherwise a Monday-to-Friday
schedule resets every single weekend, which makes the number meaningless and
mildly insulting. Three days covers a weekend plus a holiday.

**Test blocks do not count.** They did at first, and a streak you can inflate
with a two-minute test is not a streak. The starter drops a marker file before
a test run and the watcher checks for it before bumping anything.

Both are the same principle as the app itself, and the same one behind [how
Daily Dial scores a day](../method.html): a number that measures something
real is worth having, and one you can quietly game is worse than none,
because you will trust it anyway.

## Whether this is worth it

An evening, give or take. And what you end up with isn't really automation —
the part you'd most want automated, starting the block, is the exact part I'd
tell you to keep manual. What you get instead is a reminder that shows up
whether or not you remembered, something that notices what you did and keeps
count, and one command that tells you where you stand.

The rest is the app doing the only thing it promises, which is refusing to let
you change your mind. All of the above is just making sure that when it
refuses, it's refusing at a moment you picked.

*Verified against SelfControl 4.0.2 on macOS, including reading the daemon's
block methods and constants in the app's source. The CDN collision was
diagnosed on 27 August 2026.*

[Back to the guides](index.html)
