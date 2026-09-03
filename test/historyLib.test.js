import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CATEGORIES, SLOTS, UNTRACKED, dateKey } from "../lib.js";
import {
  buildMonthGrid,
  categoryTrendDirection,
  categoryTrendsByWeek,
  daysInMonth,
  deltaDirection,
  monthSummary,
  searchNotes,
  weekOverWeek,
  weekStats,
} from "../historyLib.js";

const cats = DEFAULT_CATEGORIES;

/** A day with [fromHour, toHour) painted into category `cat`. */
function dayWith(fromHour, toHour, cat, reflection = "") {
  const slots = new Array(SLOTS).fill(UNTRACKED);
  for (let i = fromHour * 4; i < toHour * 4; i++) slots[i] = cat;
  return { slots, reflection };
}

const blankDay = () => ({ slots: new Array(SLOTS).fill(UNTRACKED), reflection: "" });

/* ---------- daysInMonth ---------- */

test("daysInMonth handles a leap and non-leap February", () => {
  assert.equal(daysInMonth(2024, 1), 29, "2024 is a leap year");
  assert.equal(daysInMonth(2026, 1), 28);
});

test("daysInMonth handles 30- and 31-day months", () => {
  assert.equal(daysInMonth(2026, 3), 30, "April");
  assert.equal(daysInMonth(2026, 7), 31, "August");
});

/* ---------- buildMonthGrid ---------- */

test("buildMonthGrid pads to full weeks and flags out-of-month days", () => {
  // August 2026: Aug 1 is a Saturday. With weekStart=0 (Sunday), the grid's
  // first row starts on Sun Jul 26, and the last row runs past Aug 31.
  const days = new Map();
  const weeks = buildMonthGrid(2026, 7, days, cats, 0);

  assert.ok(weeks.every((w) => w.length === 7), "every row is a full week");
  assert.equal(weeks[0][0].key, "2026-07-26", "first cell is the Sunday before Aug 1");
  assert.equal(weeks[0][0].inMonth, false, "padding day is flagged out-of-month");

  const aug1 = weeks[0].find((c) => c.key === "2026-08-01");
  assert.equal(aug1.inMonth, true);
  assert.equal(aug1.day, 1);

  const last = weeks[weeks.length - 1];
  assert.ok(last.some((c) => c.key === "2026-08-31"), "grid reaches the last day of the month");
});

test("buildMonthGrid respects weekStart=1 (Monday)", () => {
  const days = new Map();
  const weeks = buildMonthGrid(2026, 7, days, cats, 1);
  // Aug 1 2026 is a Saturday; a Monday-start week puts it 5 columns in.
  assert.equal(weeks[0][5].key, "2026-08-01");
});

test("buildMonthGrid distinguishes 'logged but low score' from 'not logged'", () => {
  const days = new Map();
  days.set("2026-08-05", dayWith(9, 10, 5)); // distraction-only: a bad score, not absent
  const weeks = buildMonthGrid(2026, 7, days, cats, 0);
  const flat = weeks.flat();

  const logged = flat.find((c) => c.key === "2026-08-05");
  assert.equal(logged.logged, true);
  // One distracted hour against a four-hour target, not one hour out of one:
  // a wasted hour, scored as a wasted hour rather than as a wasted day.
  assert.equal(logged.score, -25, "a distraction-only day scores badly");
  assert.ok(logged.score < 0);

  const unlogged = flat.find((c) => c.key === "2026-08-06");
  assert.equal(unlogged.logged, false, "no entries at all reads as unlogged, not scored");
  assert.equal(unlogged.score, null, "score is null, never 0, when nothing was logged");
});

test("buildMonthGrid reports the category a day held most of", () => {
  const days = new Map();
  // Three hours of Study against two of Deep Work.
  const slots = Array(96).fill(-1);
  for (let i = 36; i < 44; i++) slots[i] = 0;   // 2h Deep Work
  for (let i = 44; i < 56; i++) slots[i] = 2;   // 3h Study
  days.set("2026-08-05", { slots, reflection: "", notes: [], intents: [], avoid: [] });

  const cell = buildMonthGrid(2026, 7, days, cats, 0).flat().find((c) => c.key === "2026-08-05");
  assert.equal(cell.topCat, 2, "Study led the day");

  const empty = buildMonthGrid(2026, 7, days, cats, 0).flat().find((c) => c.key === "2026-08-06");
  assert.equal(empty.topCat, null, "a day with nothing painted leads with nothing");
});

/* ---------- monthSummary ---------- */

test("monthSummary averages only over logged days", () => {
  const days = new Map();
  days.set("2026-08-01", dayWith(9, 10, 0)); // productive hour, score +100
  days.set("2026-08-02", dayWith(9, 10, 5)); // distraction hour, score -100
  // Aug 3+ left unlogged.

  const summary = monthSummary(2026, 7, days, cats);
  assert.equal(summary.daysLogged, 2);
  assert.equal(summary.avgScore, 0, "average of +100 and -100, unlogged days don't drag it toward 0 further");
  assert.equal(summary.totalTrackedMin, 120);
});

test("monthSummary returns nulls when nothing is logged", () => {
  const summary = monthSummary(2026, 7, new Map(), cats);
  assert.equal(summary.daysLogged, 0);
  assert.equal(summary.avgScore, null);
  assert.equal(summary.avgProductivePct, null);
  assert.equal(summary.bestDay, null);
  assert.equal(summary.currentStreak, 0);
  assert.equal(summary.longestStreak, 0);
});

test("monthSummary tracks best day by score", () => {
  const days = new Map();
  days.set("2026-08-01", dayWith(9, 10, 0)); // 1h productive → 25
  days.set("2026-08-02", dayWith(9, 11, 0)); // 2h productive → 50
  days.set("2026-08-03", dayWith(9, 10, 3)); // neutral admin → 0

  const summary = monthSummary(2026, 7, days, cats);
  // The two productive days used to tie at +100, because each divided its
  // productive time by itself. Scored against a target, the longer day wins,
  // which is the whole point of the change.
  assert.equal(summary.bestDay.score, 50);
  assert.equal(summary.bestDay.key, "2026-08-02", "two good hours beats one");
});

test("monthSummary computes current and longest streak within the month only", () => {
  const days = new Map();
  days.set("2026-08-01", dayWith(9, 10, 0));
  days.set("2026-08-02", dayWith(9, 10, 0));
  days.set("2026-08-03", dayWith(9, 10, 0));
  // gap on the 4th
  days.set("2026-08-05", dayWith(9, 10, 0));
  days.set("2026-08-06", dayWith(9, 10, 0));

  // `now` is explicit in these: without it the result depends on the date the
  // suite happens to run, since a month in progress only walks as far as today.
  const after = new Date(2026, 8, 15); // September — August is fully in the past
  const summary = monthSummary(2026, 7, days, cats, after);
  assert.equal(summary.longestStreak, 3, "Aug 1-3 is the longest run");
  assert.equal(summary.currentStreak, 0, "the rest of the month (7-31) is unlogged, so the trailing run is 0");
});

test("monthSummary current streak reaches to month-end when the tail is logged", () => {
  const days = new Map();
  const total = daysInMonth(2026, 7);
  days.set(dateKey(new Date(2026, 7, total - 1)), dayWith(9, 10, 0));
  days.set(dateKey(new Date(2026, 7, total)), dayWith(9, 10, 0));

  const summary = monthSummary(2026, 7, days, cats, new Date(2026, 8, 15));
  assert.equal(summary.currentStreak, 2);
});

test("monthSummary current streak is the run ending today, not the one ending on the 31st", () => {
  // The month in progress: days after today haven't been missed, they just
  // haven't happened. Walking to the calendar month-end reported 0 here,
  // while the Day view's streak card showed the real number.
  const days = new Map();
  for (const d of [24, 25, 26, 27, 28]) days.set(dateKey(new Date(2026, 7, d)), dayWith(9, 10, 0));
  const today = new Date(2026, 7, 28, 12, 0);

  const summary = monthSummary(2026, 7, days, cats, today);
  assert.equal(summary.currentStreak, 5, "Aug 24-28 is a live run ending today");
  assert.equal(summary.longestStreak, 5);
});

test("monthSummary keeps the run alive when today isn't logged yet", () => {
  const days = new Map();
  for (const d of [24, 25, 26, 27]) days.set(dateKey(new Date(2026, 7, d)), dayWith(9, 10, 0));
  const today = new Date(2026, 7, 28, 9, 0); // nothing logged today yet

  const summary = monthSummary(2026, 7, days, cats, today);
  assert.equal(summary.currentStreak, 4, "an unlogged today doesn't break the run, same as computeStreak");
});

/* ---------- categoryTrendsByWeek / categoryTrendDirection ---------- */

test("categoryTrendsByWeek sums minutes per category per week, excluding out-of-month days", () => {
  const days = new Map();
  days.set("2026-07-26", dayWith(9, 10, 0)); // Sunday before Aug 1 — must be excluded
  days.set("2026-08-01", dayWith(9, 10, 0)); // Saturday, week 1, 60 productive min

  const weeks = categoryTrendsByWeek(2026, 7, days, cats, 0);
  assert.equal(weeks[0].perCatMin[0], 60, "only the in-month day counts");
});

test("categoryTrendDirection reads first-vs-last week, not a full regression", () => {
  const weeks = [
    { weekStartKey: "w1", perCatMin: [10, 0, 0, 0, 0, 0] },
    { weekStartKey: "w2", perCatMin: [90, 0, 0, 0, 0, 0] }, // dips mid-range, irrelevant
    { weekStartKey: "w3", perCatMin: [30, 0, 0, 0, 0, 0] },
  ];
  assert.equal(categoryTrendDirection(weeks, 0), "up", "30 > 10, even though week 2 was higher still");
});

test("categoryTrendDirection is flat on no weeks or no change", () => {
  assert.equal(categoryTrendDirection([], 0), "flat");
  const weeks = [
    { weekStartKey: "w1", perCatMin: [20] },
    { weekStartKey: "w2", perCatMin: [20] },
  ];
  assert.equal(categoryTrendDirection(weeks, 0), "flat");
});

/* ---------- weekStats / weekOverWeek ---------- */

test("weekStats aggregates tracked time and averages score over logged days", () => {
  const start = new Date(2026, 7, 3); // a Monday
  const days = new Map();
  days.set(dateKey(start), dayWith(9, 10, 0)); // 1h productive → 25
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  days.set(dateKey(next), dayWith(9, 11, 5)); // 2h distraction → -50

  const stats = weekStats(days, cats, start);
  assert.equal(stats.daysLogged, 2);
  assert.equal(stats.trackedMin, 180);
  assert.equal(stats.avgScore, -12, "mean of 25 and -50, rounded");
});

test("weekStats returns null averages and zero minutes for an empty week", () => {
  const stats = weekStats(new Map(), cats, new Date(2026, 7, 3));
  assert.equal(stats.trackedMin, 0);
  assert.equal(stats.daysLogged, 0);
  assert.equal(stats.avgScore, null);
  assert.equal(stats.avgProductivePct, null);
});

test("weekOverWeek computes deltas with correct sign", () => {
  const now = new Date(2026, 7, 12); // a Wednesday
  const days = new Map();
  const thisWeekStart = new Date(2026, 7, 9); // Sunday of the current week (weekStart=0)
  const lastWeekStart = new Date(2026, 7, 2);

  days.set(dateKey(thisWeekStart), dayWith(9, 11, 0)); // 2h productive this week
  days.set(dateKey(lastWeekStart), dayWith(9, 10, 0)); // 1h productive last week

  const wow = weekOverWeek(days, cats, 0, now);
  assert.equal(wow.current.trackedMin, 120);
  assert.equal(wow.previous.trackedMin, 60);
  assert.equal(wow.deltas.trackedMin, 60, "this week minus last week");
});

test("weekOverWeek delta is null when either side has nothing scored", () => {
  const now = new Date(2026, 7, 12);
  const days = new Map();
  days.set(dateKey(new Date(2026, 7, 9)), dayWith(9, 10, 0));
  // Previous week entirely unlogged.

  const wow = weekOverWeek(days, cats, 0, now);
  assert.equal(wow.previous.avgScore, null);
  assert.equal(wow.deltas.avgScore, null, "can't diff against nothing");
});

/* ---------- deltaDirection ---------- */

test("deltaDirection", () => {
  assert.equal(deltaDirection(5), "up");
  assert.equal(deltaDirection(-5), "down");
  assert.equal(deltaDirection(0), "flat");
  assert.equal(deltaDirection(null), "flat");
  assert.equal(deltaDirection(undefined), "flat");
  assert.equal(deltaDirection(NaN), "flat");
});

/* ---------- searchNotes ---------- */

test("searchNotes matches case-insensitively and returns newest first", () => {
  const days = new Map();
  days.set("2026-08-01", { ...blankDay(), reflection: "Great focus in the morning" });
  days.set("2026-08-03", { ...blankDay(), reflection: "distracted all day, low FOCUS" });
  days.set("2026-08-02", { ...blankDay(), reflection: "nothing notable" });

  const results = searchNotes(days, "focus");
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.key), ["2026-08-03", "2026-08-01"], "newest match first");
});

test("searchNotes returns nothing for an empty or all-whitespace query", () => {
  const days = new Map([["2026-08-01", { ...blankDay(), reflection: "anything" }]]);
  assert.deepEqual(searchNotes(days, ""), []);
  assert.deepEqual(searchNotes(days, "   "), []);
});

test("searchNotes skips days with no reflection and truncates a long match into a snippet", () => {
  const days = new Map();
  days.set("2026-08-01", blankDay()); // empty reflection, must not match ""
  const long = "x".repeat(60) + "keyword" + "y".repeat(60);
  days.set("2026-08-02", { ...blankDay(), reflection: long });

  const results = searchNotes(days, "keyword");
  assert.equal(results.length, 1);
  assert.ok(results[0].snippet.length < long.length, "snippet is shorter than the full note");
  assert.ok(results[0].snippet.includes("keyword"));
  assert.ok(results[0].snippet.startsWith("…"), "truncated on the left gets an ellipsis");
  assert.ok(results[0].snippet.endsWith("…"), "truncated on the right gets an ellipsis");
});

test("buildMonthGrid marks days that are written up but have no painted time", () => {
  // What an imported journal looks like: notes and intentions, nothing on the
  // dial. Previously indistinguishable from a day nothing happened on.
  const days = new Map([
    ["2026-06-16", { ...blankDay(), notes: [{ from: 0, to: 4, text: "sleeping" }] }],
    ["2026-06-17", dayWith(9, 11, 0)],
    ["2026-06-18", { ...blankDay(), intents: [{ text: "leetcode", done: false }] }],
  ]);
  const cells = buildMonthGrid(2026, 5, days, cats).flat();
  const at = (k) => cells.find((c) => c.key === k);

  assert.equal(at("2026-06-16").written, true, "a note alone counts as written");
  assert.equal(at("2026-06-16").logged, false);
  assert.equal(at("2026-06-18").written, true, "an intention alone counts too");

  assert.equal(at("2026-06-17").logged, true, "painted time is still 'logged'");
  assert.equal(at("2026-06-17").written, false, "the two states are mutually exclusive");

  assert.equal(at("2026-06-20").logged, false, "a genuinely empty day is neither");
  assert.equal(at("2026-06-20").written, false);
});
