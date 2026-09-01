---
title: Why it works this way
description: A dial instead of a form, weighted categories, and a deliberate refusal to auto-track.
---

# Why it works this way

Daily Dial is built on a set of deliberate constraints. Each one comes from watching what time-tracking tools do poorly—and what they do well. This page explains what we chose and what we gave up to choose it.

## A dial, not a form

Most time trackers ask you to name a category, pick a date, enter start time, enter end time. Four fields, eight times a day. The friction is small. The adherence is terrible—almost nobody logs past week two.

A dial works differently. You look at the day's visualization and drag a point around it, pointing at the hours and the shape of the day. One interaction. The feedback is immediate: does the visualization match what happened?

The cost is real. A dial works in 15-minute increments. You cannot record that you spent 23 minutes on email and 37 on code. Nobody needs that precision, and everyone claims they want it until they realize they don't actually remember minutes.

We accept this deliberately. You do not recall your day to the minute. Even if you did, the UI cost of entering it would mean the tracker goes unused. The 15-minute grid is the trade-off that keeps logging sustainable.

## Manual, not automatic

Window-title trackers are honest about what they can see: which application was in focus, how many times you switched, when you were idle. They are excellent at one thing and blind to everything that matters.

An automatic tracker cannot tell you whether the document you were reading was a textbook or a distraction. It cannot know that the time you spent in your chat app was an interview, a conversation that solved a problem, or both. It cannot track a walk where you worked through a design problem. It misses the quiet thinking, the hard parts, the collaboration that shows up only in timestamps.

Manual logging captures what actually happened, including the parts that never appear on a computer screen.

The cost is not small. You have to remember to log. You have to make judgments about where each block of time went. If you stop logging for two days, those days vanish. You will miss things.

That cost is the point. A tracker that sees everything is a tracker that sees nothing—it records accurately but tells you nothing useful. What gets logged in Daily Dial is what you noticed, what you decided mattered enough to name. That is more honest and more actionable than an automatic record of every window you touched.

## Weighted categories, not neutral ones

You can assign a category as productive, distracting, or neutral. A productive hour adds to your score. A distracting hour subtracts. A neutral hour doesn't affect it.

Without weights, a tracker becomes a data archive: it can tell you how many hours you spent on each category, and nothing more. It answers "what" but not "how did today go." You could spend eight hours on work and two on deep focus and come out confused about which day was better.

With weights, the tool becomes a mirror: it measures how much of your time went toward things you decided matter. The score is immediate and clear.

The cost: you have to decide what matters, and you have to decide it right. A poorly weighted setup will produce confident wrong numbers—a score that flatters you or defeats you, both in equal measure. The weights are your judgment, and your judgment is fallible.

This is why weights are editable. You can recalibrate. If a weight starts producing numbers that feel untrue, change it. The score should match your intuition, and if it doesn't, that is information worth trusting.

## Dividing by the day you meant to have

The score is (productive − distraction) divided by whichever is larger: the weighted time you logged, or your daily target.

That denominator has been wrong once already, and the way it was wrong is worth keeping on the record.

The original divided by tracked time alone. The reasoning was that a metric should measure the shape of your time rather than its quantity — nobody needs a tool that rewards working longer, and a focused four-hour day genuinely is better than a scattered ten-hour one. That reasoning still holds. The implementation did not.

Dividing a day by itself means two productive hours and an otherwise blank day return a perfect score. Not a flattering one: a *perfect* one, identical to a flawless twelve-hour day and better than an honest day with one bad hour in it. The number did not merely permit logging selectively — it paid you for it, on the one screen whose entire claim is that it shows you untracked time and never flatters you.

This page used to describe that as a known cost, mitigated by refusing to score days under two hours. That was a patch over a hole, and not even a tight one: two hours exactly cleared the floor and scored a hundred.

The fix is to put the day you meant to have into the denominator. Where you fall short of your target, the target is what you are measured against, so two productive hours against a four-hour target read 50. Above it, your own weighted time takes over. Logging less cannot help you any more, because the thing you failed to do is still in the arithmetic.

One refinement followed, and it only became visible once the new scale was laid out and read. Dividing by everything logged made four productive hours plus four hours of rest score the same as two productive hours with nothing else admitted to — so logging the rest cost exactly what hiding half the day would. That is the same perverse incentive moved one step further out. A neutral category is one you have declared neither good nor bad, so it now sits in neither half of the fraction. Rest is free. Distraction is not, because you weighted it that way.

What holds now is a property rather than a formula: logging something that actually happened can never raise your score, and logging something neutral can never lower it. Honesty is never the losing move.

The two-hour floor is still there, for a reason that survived the change. A barely-started day is not yet a day. It used to flatter; against a target it would accuse, calling you off track at nine in the morning for the crime of logging early. Both are the same mistake, so the tool still declines to score until there is a day to score.

## Untracked time stays visible

The dial always shows what you haven't logged. The daily breakdown shows it. The weekly review shows it. It would be easier to hide: a tracker that only displays the hours you tracked is flattering and appears less chaotic. A tracker that hides the gaps never makes you reckon with incomplete data.

We show it because an incomplete record you can see is more trustworthy than a complete-looking record that is actually missing days. The visible gaps are reminders that the picture is incomplete—which is the honest state of manual logging.

This also catches a common problem: a pattern where you log the morning but never the afternoon, or log weekdays but forget weekends. The visual gap makes the pattern obvious. If you want to fix it, you can see what is missing.

## It stops at noticing

Daily Dial surfaces patterns. It tells you which categories take up the most time, which days are structured, which are scattered. It shows you the shape of your week.

It does not block you. It does not enforce a schedule. It does not nag you when you log a distraction or praise you when you log focus. It does not integrate with your calendar to suggest what you should be doing now.

Blocking is a solved problem. If you want to restrict your own access to an app during work hours, tools like Freedom and Cold Turkey work well. If you want to enforce a structure, calendar blocking is direct and honest. A tool that both tracks and polices you does both jobs worse: the tracking feels like surveillance, and the restrictions feel arbitrary because they are applied by something that does not understand context.

Daily Dial names patterns. It hands you off to tools that already do the doing well. The line between noticing and doing is the line between a tool you trust and a tool that manages you.

## Local by default

Your time log never touches a server. There is no account, no analytics, no sync unless you choose it. The extension stores data in browser storage on your device. That is where it stays.

The cost is real: you cannot automatically sync between your phone and your laptop. You cannot access your log from a café using a borrowed computer. The optional backup feature addresses this, but it is not seamless. A server-based tracker is more convenient.

Worth it: your time log is an unusually intimate record. It contains the shape of your days, what you chose to focus on, what distracted you, how you actually spend time versus how you imagine you spend it. No analytics company, no cloud vendor, no app with a business model that depends on your data should have access to it. The safest place for an intimate record is a device you control.

## What it gets wrong

Manual logging is a solved problem only in one direction: you remember the blocks you choose to examine, and forget the rest. A log with gaps is a log you cannot trust to tell you what actually happened. The picture is always incomplete.

The score is a crude instrument. Treating it as a grade, a measure of how well you are doing as a person or as a professional, is a mistake. It measures one thing: whether the time you logged matched your own weights. That is useful information. It is not comprehensive.

Your weights are subjective. A category you call "distraction" might be necessary context-switching, might be collaboration that matters, might be avoidance. The tool cannot know. You have to know. If your weights are honest, the score is useful. If they reflect what you wish about yourself rather than what is true, the score will flatter and mislead you.

None of this helps if the actual problem is workload rather than attention. If you are logging twelve hours a day and getting a poor score, the issue is not your focus. It is the amount of time available. This tool surfaces problems; it does not solve workload problems.

---

[Try it in your browser](demo/index.html) · [About the extension](about.html)
