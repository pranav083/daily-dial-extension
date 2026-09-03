---
title: Automate SelfControl without letting it start on its own
description: Scheduling the reminder rather than the block, four things SelfControl's source says that its docs don't, and the day a block on Reddit broke LinkedIn.
---

# Automate SelfControl without letting it start on its own

[The blocking guide](blocking-sites.html) covers which blocker to pick. This
one is what happens after you pick SelfControl and want it to run on a
schedule — every script, every gotcha, and the one design decision that
decides whether the whole thing survives a real week.

Everything described here is in
[`guides/selfcontrol/`](https://github.com/pranav083/daily-dial-extension/tree/main/docs/guides/selfcontrol):
four shell scripts, a blocklist of 382 domains, and the generator that builds
it. All of it is MIT licensed along with the rest of this repository.

## The one decision that matters

The obvious automation is a scheduled job that starts a block at 10am every
weekday. Don't build that.

A block you did not consciously begin is a block that catches you
mid-something — on a call that needs a document you have just blocked, or ten
minutes before you need a site that is now gone for two hours. And you cannot
undo it. That happens once, and you rip the whole system out.

So invert it. **The schedule fires a reminder. You start the block.** Nothing
here ever calls `selfcontrol-cli start` on a timer.

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

**`is-running` prints to stderr, not stdout.** The CLI reports through
`NSLog`, which writes to standard error. Capture only stdout — the reflex when
scripting anything — and you get an empty string, read it as "no block
running", and start a second one. Use `2>&1`. If you script this CLI yourself
and read nothing else here, read this.

**The 24-hour cap exists only in the GUI.** `MaxBlockLength` constrains the
duration slider in the app's own controller and nothing else. The daemon
method behind the CLI's `--enddate` honours whatever date it is given. A typo
in a script can therefore commit you to a block measured in days, with no way
out. `selfcontrol-focus-setup.sh` has its own confirmation gate above 24 hours
for exactly this reason: the GUI protects you automatically, the CLI does not.

**There is genuinely no early stop.** The installed CLI exposes only `start`,
`is-running`, `print-settings` and `version`. There is no GUI button. The
app's own "extend" feature explicitly refuses any end date earlier than the
current one, and `print-settings` carries a `TamperingDetected` flag — the
tricks people reach for are anticipated. Nothing in this setup attempts to
stop, shorten or tamper with a running block, because nothing could.

**No sudo, ever.** The privileged work happens in a root-owned LaunchDaemon
the installer already set up, and the CLI talks to it over XPC — the binary
itself is not setuid. All of this runs as your normal user with no password
prompts.

## The afternoon a block on Reddit broke LinkedIn

This is the failure worth knowing about in advance, because you cannot fix it
while it is happening.

Mid-block, LinkedIn started rendering as unstyled HTML. Greenhouse job pages
too. Neither is on the blocklist. The browser console showed
`ERR_CONNECTION_REFUSED` on their asset hosts — not a 404, not a timeout, a
flat refusal arriving in about twenty milliseconds. Other devices on the same
network were fine, and every browser on the Mac was affected, so it was not a
browser problem.

SelfControl blocks by resolving each domain on your list and adding firewall
rules for the resolved addresses. The list has Reddit on it. Reddit is behind
Fastly. So are LinkedIn's and Greenhouse's asset CDNs — and large CDNs hand
out a small pool of anycast addresses across enormous numbers of unrelated
customers. The address blocked on Reddit's behalf was, that afternoon, also
serving somebody else's stylesheets.

Probing neighbouring addresses across the surrounding range found them all
reachable, which rules out a broad range block: this was an exact-IP
collision. Confirming precisely which entry caused it needs root to read the
live firewall ruleset — which rather proves the point about how much you can
inspect from inside a block.

**There is no resolution. You wait.** The block ended at 2:49pm and everything
worked again at 2:49pm. When a tool's headline feature is that you cannot stop
it, "I will just stop it" is not available as a fix, and the collateral damage
lands on sites you never chose to block.

If it happens to you: check the console for `ERR_CONNECTION_REFUSED`
specifically, `curl -v` the failing host (a fast connection-refused is a
firewall signature, a multi-second timeout is something else), and check
whether the resolved address sits on shared CDN infrastructure that something
on your list also uses. Verify it has cleared afterwards by curling the asset
host and looking for any real HTTP response.

The practical lesson is about list composition rather than tooling. Every
large consumer site on a shared CDN is a small bet that you will not need a
neighbour of theirs for the next two hours. Blocking Reddit is worth it. A
long tail of obscure domains, each dragging in whatever addresses it happens
to resolve to, is a larger bet than it looks.

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

An evening, roughly. And what you get is not really automation — the thing you
would most want automated, starting the block, is the one thing to keep
manual. What you get is a reminder that arrives whether or not you remembered,
a system that notices what you did and keeps count, and one command that tells
you where you stand.

The rest is the app doing the only thing it promises: refusing to let you
change your mind. Everything above is making sure that when it refuses, it
refuses at a moment you chose.

*Verified against SelfControl 4.0.2 on macOS, including reading the daemon's
block methods and constants in the app's source. The CDN collision was
diagnosed on 27 August 2026.*

[Back to the guides](index.html)
