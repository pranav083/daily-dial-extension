import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  SLOTS,
  SLOT_MIN,
  UNTRACKED,
  buildBackup,
  excludeDays,
  buildCsv,
  buildInsight,
  computeRuns,
  computeStats,
  computeStreak,
  dateKey,
  dayHasEntries,
  dayHasContent,
  fillRange,
  fmtClock,
  fmtDuration,
  fmtHM,
  csvCell,
  goalProgress,
  isValidTime,
  mergeDayMaps,
  mostRecentWeekStart,
  recapWeekStart,
  dialUrlSuffix,
  nextOccurrence,
  nextWeeklyOccurrence,
  normalizeCategories,
  normalizeDay,
  normalizeSettings,
  parseBackup,
  parseCsv,
  parseTimeEntry,
  personalBests,
  reminderMessage,
  runAt,
  scoreBucket,
  shouldNudgeBackup,
  slotFromAngle,
  summarizeImport,
  angleAt,
  buildSampleDays,
  challengeProgress,
  buildShareSvgMarkup,
  DRIVE_BACKUP_FILENAME,
  driveCreateMultipartBody,
  driveDeleteUrl,
  driveDownloadUrl,
  driveUserInfoUrl,
  driveParseUserInfoResponse,
  fmtBytes,
  driveListUrl,
  driveParseListResponse,
  driveUploadUrl,
  weekPerCatMinutes,
  weeklyRecap,
  weeklyRecapMessage,
  weightLabel,
  detectPatterns,
  detectIntentionOvercommit,
  detectNoBreaks,
  detectDistractionTrend,
  detectCoverageDecline,
  detectPeakHoursUnprotected,
  detectUntrackedLifeArea,
  MIN_HISTORY_DAYS,
  MIN_LOGGED_DAYS,
  OVERCOMMIT_WINDOW_DAYS,
  OVERCOMMIT_MIN_INTENTIONS,
  OVERCOMMIT_MAX_DONE_RATIO,
  NO_BREAKS_WINDOW_DAYS,
  NO_BREAKS_MIN_TRACKED_HOURS,
  DISTRACTION_TREND_WINDOW_DAYS,
  DISTRACTION_TREND_MIN_RATIO,
  DISTRACTION_TREND_MIN_CURRENT_MIN,
  COVERAGE_DECLINE_RECENT_DAYS,
  COVERAGE_DECLINE_PRIOR_DAYS,
  COVERAGE_DECLINE_MAX_RATIO,
  COVERAGE_DECLINE_MIN_PRIOR_AVG_MIN,
  PEAK_HOURS_WINDOW_DAYS,
  PEAK_HOURS_DAY_MAJORITY_SLOTS,
  PEAK_HOURS_MAX_PROTECTED_RATIO,
  UNTRACKED_LIFE_AREA_WINDOW_DAYS,
  UNTRACKED_LIFE_AREA_MAX_DISTINCT_CATEGORIES,
} from "../lib.js";

const cats = DEFAULT_CATEGORIES;
const blank = () => new Array(SLOTS).fill(UNTRACKED);

/** Paint [fromHour, toHour) with a category. */
function paint(slots, fromHour, toHour, cat) {
  const next = [...slots];
  for (let i = fromHour * 4; i < toHour * 4; i++) next[i] = cat;
  return next;
}

/* ---------- formatting ---------- */

test("fmtHM maps slot indices to clock times", () => {
  assert.equal(fmtHM(0), "00:00");
  assert.equal(fmtHM(1), "00:15");
  assert.equal(fmtHM(36), "09:00");
  assert.equal(fmtHM(95), "23:45");
  assert.equal(fmtHM(96), "00:00", "end-of-day boundary wraps to midnight");
});

test("fmtDuration drops empty units", () => {
  assert.equal(fmtDuration(0), "0m");
  assert.equal(fmtDuration(45), "45m");
  assert.equal(fmtDuration(60), "1h");
  assert.equal(fmtDuration(135), "2h 15m");
});

test("dateKey uses local time, not UTC", () => {
  // 23:30 local must stay on its own local date, which toISOString() would shift
  // for anyone east of UTC.
  const d = new Date(2026, 7, 28, 23, 30);
  assert.equal(dateKey(d), "2026-08-28");
});

/* ---------- normalization ---------- */

test("normalizeDay repairs anything malformed", () => {
  assert.deepEqual(normalizeDay(null).slots.length, SLOTS);
  assert.equal(normalizeDay(undefined).reflection, "");
  assert.equal(normalizeDay({ slots: [1, 2, 3] }).slots.length, SLOTS, "wrong length is discarded");
  assert.equal(normalizeDay({ reflection: 42 }).reflection, "", "non-string reflection is dropped");

  const good = { slots: paint(blank(), 9, 10, 0), reflection: "ok" };
  assert.deepEqual(normalizeDay(good), { ...good, notes: [], intents: [], avoid: [] });
});

test("normalizeCategories keeps ids and colours, takes user name and weight", () => {
  const saved = [{ name: "  Thesis  ", weight: -1, enabled: false }];
  const out = normalizeCategories(saved);
  assert.equal(out[0].name, "Thesis", "trimmed");
  assert.equal(out[0].weight, -1);
  assert.equal(out[0].enabled, false);
  assert.equal(out[0].id, 0, "slot identity is never taken from storage");
  assert.equal(out[0].cls, "cat-0", "colour is never taken from storage");
  assert.equal(out.length, DEFAULT_CATEGORIES.length, "always six slots");
  assert.equal(out[1].name, DEFAULT_CATEGORIES[1].name, "missing entries fall back");
});

test("normalizeCategories rejects an out-of-range weight", () => {
  const out = normalizeCategories([{ name: "X", weight: 99 }]);
  assert.equal(out[0].weight, DEFAULT_CATEGORIES[0].weight);
});

test("normalizeCategories defaults to no aliases, and trims/lowercases/dedupes provided ones", () => {
  assert.deepEqual(normalizeCategories(null)[0].aliases, []);
  const out = normalizeCategories([{ name: "Applications", aliases: ["  LeetCode ", "Resume", "leetcode", ""] }]);
  assert.deepEqual(out[0].aliases, ["leetcode", "resume"], "trimmed, lowercased, deduped, blanks dropped");
});

test("normalizeCategories caps alias count and per-alias length", () => {
  const many = Array.from({ length: 20 }, (_, i) => `alias-${i}`);
  const out = normalizeCategories([{ name: "Applications", aliases: many }]);
  assert.equal(out[0].aliases.length, 8, "capped at 8");

  const longOne = normalizeCategories([{ name: "Applications", aliases: ["x".repeat(60)] }]);
  assert.equal(longOne[0].aliases[0].length, 24, "capped at 24 chars");
});

test("normalizeSettings validates reminder times", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ remindersOn: true, times: ["07:30", "19:45"] }).times, ["07:30", "19:45"]);
  assert.deepEqual(normalizeSettings({ times: ["25:00", "19:45"] }).times, ["13:00", "21:00"], "bad hour rejected");
  assert.equal(normalizeSettings({ remindersOn: "yes" }).remindersOn, false, "only true enables");
});

test("normalizeSettings validates appearance, goals, and recap fields", () => {
  assert.equal(normalizeSettings(null).theme, "system");
  assert.equal(normalizeSettings({ theme: "dark" }).theme, "dark");
  assert.equal(normalizeSettings({ theme: "purple" }).theme, "system", "unknown theme falls back");

  assert.equal(normalizeSettings({ timeFormat: "12h" }).timeFormat, "12h");
  assert.equal(normalizeSettings({ timeFormat: "nonsense" }).timeFormat, "24h");

  assert.equal(normalizeSettings(null).dialMode, "24h");
  assert.equal(normalizeSettings({ dialMode: "ampm" }).dialMode, "ampm");
  assert.equal(normalizeSettings({ dialMode: "ampm-toggle" }).dialMode, "ampm-toggle");
  assert.equal(normalizeSettings({ dialMode: "nonsense" }).dialMode, "24h");

  assert.equal(normalizeSettings({ weekStart: 1 }).weekStart, 1);
  assert.equal(normalizeSettings({ weekStart: 5 }).weekStart, 0, "only 0 or 1 are valid");

  assert.deepEqual(normalizeSettings({ goals: { 0: 120, 1: 60.7, 9: 30, bad: 10, 2: -5 } }).goals, {
    0: 120,
    1: 61,
  });
  assert.deepEqual(normalizeSettings({ goals: "nope" }).goals, {});

  assert.deepEqual(normalizeSettings({ weeklyGoals: { 1: 300 } }).weeklyGoals, { 1: 300 });
  assert.deepEqual(normalizeSettings(null).weeklyGoals, {}, "independent of the daily goals map");

  assert.equal(normalizeSettings({ weeklyRecapOn: true }).weeklyRecapOn, true);
  assert.equal(normalizeSettings({ weeklyRecapDay: 3 }).weeklyRecapDay, 3);
  assert.equal(normalizeSettings({ weeklyRecapDay: 9 }).weeklyRecapDay, 0);
  assert.equal(normalizeSettings({ weeklyRecapTime: "09:15" }).weeklyRecapTime, "09:15");
  assert.equal(normalizeSettings({ weeklyRecapTime: "bad" }).weeklyRecapTime, "20:00");

  assert.equal(normalizeSettings({ lastExportAt: 12345 }).lastExportAt, 12345);
  assert.equal(normalizeSettings({ lastExportAt: "nope" }).lastExportAt, null);
  assert.equal(normalizeSettings(null).lastExportAt, null);

  assert.deepEqual(normalizeSettings(null).dayWindow, { start: "07:00", end: "23:00" });
  assert.deepEqual(normalizeSettings({ dayWindow: { start: "06:30", end: "22:30" } }).dayWindow, {
    start: "06:30",
    end: "22:30",
  });
  assert.deepEqual(
    normalizeSettings({ dayWindow: { start: "bad", end: "22:30" } }).dayWindow,
    { start: "07:00", end: "22:30" },
    "an invalid half falls back on its own, not the whole pair"
  );
});

test("isValidTime accepts 24h clock only", () => {
  assert.ok(isValidTime("00:00"));
  assert.ok(isValidTime("23:59"));
  assert.ok(!isValidTime("24:00"));
  assert.ok(!isValidTime("9:00"));
  assert.ok(!isValidTime(""));
});

/* ---------- geometry ---------- */

test("angleAt puts midnight at the top and runs clockwise", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.001, `${a} ≈ ${b}`);
  near(angleAt(230, 40).angle, 0);    // straight up  → 00:00
  near(angleAt(420, 230).angle, 90);  // right        → 06:00
  near(angleAt(230, 420).angle, 180); // down         → 12:00
  near(angleAt(40, 230).angle, 270);  // left         → 18:00
});

test("slotFromAngle never exceeds the last slot", () => {
  assert.equal(slotFromAngle(0), 0);
  assert.equal(slotFromAngle(180), 48);
  assert.equal(slotFromAngle(359.99), 95);
  assert.equal(slotFromAngle(360), 95, "clamped");
});

test("computeRuns collapses equal neighbours and splits on change", () => {
  let slots = paint(blank(), 9, 11, 0);
  slots = paint(slots, 11, 12, 1);
  const runs = computeRuns(slots);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0], { cat: 0, start: 36, end: 44 });
  assert.deepEqual(runs[1], { cat: 1, start: 44, end: 48 });
});

test("runAt finds the enclosing run, or null when untracked", () => {
  const slots = paint(blank(), 9, 11, 0);
  assert.deepEqual(runAt(slots, 38), { cat: 0, start: 36, end: 44 });
  assert.equal(runAt(slots, 0), null);
});

test("fillRange takes the short way round, including across midnight", () => {
  // 23:00 → 01:00 is 8 slots forward, not 88 backward.
  const out = fillRange(blank(), 92, 4, 0);
  const painted = out.filter((v) => v === 0).length;
  assert.equal(painted, 9, "inclusive of both ends");
  assert.equal(out[92], 0);
  assert.equal(out[0], 0);
  assert.equal(out[4], 0);
  assert.equal(out[50], UNTRACKED, "midday untouched");
});

test("fillRange does not mutate its input", () => {
  const before = blank();
  fillRange(before, 10, 20, 0);
  assert.ok(before.every((v) => v === UNTRACKED));
});

/* ---------- AM/PM half-dial (a 48-slot window instead of the full 96) ---------- */

test("slotFromAngle scales to a smaller window, e.g. a 48-slot half-dial", () => {
  assert.equal(slotFromAngle(0, 48), 0);
  assert.equal(slotFromAngle(180, 48), 24);
  assert.equal(slotFromAngle(359.99, 48), 47);
  assert.equal(slotFromAngle(360, 48), 47, "clamped");
});

test("computeRuns and runAt operate on whatever window they're given, not always all 96 slots", () => {
  const half = new Array(48).fill(UNTRACKED);
  half[10] = 0;
  half[11] = 0;
  const runs = computeRuns(half);
  assert.deepEqual(runs, [{ cat: 0, start: 10, end: 12 }]);
  assert.deepEqual(runAt(half, 10), { cat: 0, start: 10, end: 12 });
});

test("fillRange wraps within its own window, so a 48-slot half stays confined to that half", () => {
  // Slot 46 → slot 2 is 4 slots forward within a 48-slot window, not 44 backward.
  const half = new Array(48).fill(UNTRACKED);
  const out = fillRange(half, 46, 2, 0);
  const painted = out.filter((v) => v === 0).length;
  assert.equal(painted, 5, "inclusive of both ends, wrapping at 48 rather than 96");
  assert.equal(out[46], 0);
  assert.equal(out[0], 0);
  assert.equal(out[2], 0);
  assert.equal(out[24], UNTRACKED, "the other side of the half untouched");
});

/* ---------- stats ---------- */

test("computeStats totals a mixed day", () => {
  let slots = paint(blank(), 9, 13, 0);   // 4h Deep Work   (+1)
  slots = paint(slots, 13, 14, 4);        // 1h Break        (0)
  slots = paint(slots, 14, 15, 5);        // 1h Distraction (-1)

  const s = computeStats(slots, cats);
  assert.equal(s.trackedMin, 360);
  assert.equal(s.productiveMin, 240);
  assert.equal(s.distractionMin, 60);
  assert.equal(s.productivePct, 67);
  assert.equal(s.longestFocusMin, 240);
  assert.equal(s.score, Math.round(((240 - 60) / 360) * 100));
  assert.equal(s.untrackedSlots, SLOTS - 24);
});

test("computeStats.untrackedInWindowMin defaults to the whole day without a dayWindow", () => {
  const slots = paint(blank(), 9, 13, 0); // 9am–1pm logged, rest untracked
  const s = computeStats(slots, cats);
  assert.equal(s.untrackedInWindowMin, s.untrackedSlots * SLOT_MIN);
});

test("computeStats.untrackedInWindowMin only counts untracked time inside the window — e.g. sleep excluded", () => {
  const slots = paint(blank(), 9, 13, 0); // 9am–1pm logged; midnight–7am and 11pm–midnight are "asleep"
  const wholeDay = computeStats(slots, cats).untrackedInWindowMin;
  const wakingOnly = computeStats(slots, cats, { startMin: 7 * 60, endMin: 23 * 60 }).untrackedInWindowMin;
  assert.ok(wakingOnly < wholeDay, "restricting to waking hours should count less untracked time");
  assert.equal(wakingOnly, 12 * 60, "7am–9am and 1pm–11pm, minus the logged 9am–1pm");
});

test("computeStats reports null score for an empty day, not zero", () => {
  const s = computeStats(blank(), cats);
  assert.equal(s.score, null, "null means 'no data', 0 means 'balanced'");
  assert.equal(s.trackedMin, 0);
  assert.equal(s.productivePct, 0);
});

test("longest focus spans category changes but breaks on neutral time", () => {
  let slots = paint(blank(), 9, 11, 0); // productive
  slots = paint(slots, 11, 12, 2);      // productive, different category
  slots = paint(slots, 12, 13, 4);      // neutral — breaks the streak
  slots = paint(slots, 13, 14, 0);      // productive again

  const s = computeStats(slots, cats);
  assert.equal(s.longestFocusMin, 180, "9–12 counts as one unbroken stretch");
});

test("computeStats ignores slots referencing a missing category", () => {
  const slots = paint(blank(), 9, 10, 42);
  const s = computeStats(slots, cats);
  assert.equal(s.productiveMin, 0);
  assert.ok(Number.isFinite(s.trackedMin));
});

test("scoreBucket thresholds", () => {
  assert.equal(scoreBucket(null).tone, "muted");
  assert.equal(scoreBucket(80).label, "Locked in");
  assert.equal(scoreBucket(20).label, "Solid");
  assert.equal(scoreBucket(0).label, "Mixed bag");
  assert.equal(scoreBucket(-50).label, "Off track");
});

/* ---------- insight ---------- */

test("buildInsight leads with the top category on a good day", () => {
  const slots = paint(blank(), 9, 13, 0);
  const text = buildInsight(computeStats(slots, cats), cats);
  assert.match(text, /100%/);
  assert.match(text, /Deep Work/);
});

test("buildInsight calls out a day lost to distraction", () => {
  let slots = paint(blank(), 9, 10, 0);
  slots = paint(slots, 10, 14, 5);
  const text = buildInsight(computeStats(slots, cats), cats);
  assert.match(text, /more than you spent moving forward/);
});

test("buildInsight flags fragmented time", () => {
  // 4 × 30min productive blocks split by breaks: 2h productive, none over 45m.
  const slots = blank();
  for (const h of [9, 11, 13, 15]) {
    for (let i = h * 4; i < h * 4 + 2; i++) slots[i] = 0;
  }
  const text = buildInsight(computeStats(slots, cats), cats);
  assert.match(text, /short pieces/);
});

test("buildInsight prompts when the day is empty", () => {
  assert.match(buildInsight(computeStats(blank(), cats), cats), /Nothing logged yet/);
});

test("buildInsight's 'still unlogged' nag respects the day window — no false nag about sleep", () => {
  // Fully logged waking hours (7am–11pm); only overnight is untracked.
  const slots = paint(blank(), 7, 23, 0);
  const wholeDay = buildInsight(computeStats(slots, cats), cats);
  const wakingOnly = buildInsight(computeStats(slots, cats, { startMin: 7 * 60, endMin: 23 * 60 }), cats);
  assert.match(wholeDay, /still unlogged/, "8h of 'sleep' reads as unlogged without a window");
  assert.doesNotMatch(wakingOnly, /still unlogged/, "same day, but nothing is unlogged within waking hours");
});

/* ---------- CSV ---------- */

test("csvCell quotes only when it must", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(0), "0", "zero is not blank");
});

test("weightLabel maps the tri-state", () => {
  assert.equal(weightLabel(1), "productive");
  assert.equal(weightLabel(0), "neutral");
  assert.equal(weightLabel(-1), "distraction");
});

test("buildCsv emits one row per run, sorted by date", () => {
  const days = new Map([
    ["2026-08-27", { slots: paint(blank(), 14, 15, 1), reflection: "later day" }],
    ["2026-08-26", { slots: paint(blank(), 9, 11, 0), reflection: "earlier" }],
  ]);

  const csv = buildCsv(days, cats);
  const lines = csv.split("\r\n");

  assert.equal(lines[0], "Date,Start,End,Duration (min),Category,Weight,Note");
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith("2026-08-26,09:00,11:00,120,Deep Work,productive,"), lines[1]);
  assert.ok(lines[2].startsWith("2026-08-27,14:00,15:00,60,Applications,productive,"), lines[2]);
});

test("buildCsv returns null when nothing is logged", () => {
  assert.equal(buildCsv(new Map(), cats), null);
  assert.equal(buildCsv(new Map([["2026-08-26", { slots: blank(), reflection: "" }]]), cats), null);
});

test("buildCsv escapes a comma in the note", () => {
  const days = new Map([["2026-08-26", { slots: paint(blank(), 9, 10, 0), reflection: "good, mostly" }]]);
  assert.match(buildCsv(days, cats), /"good, mostly"/);
});

/* ---------- CSV import ---------- */

test("parseCsv round-trips what buildCsv emits", () => {
  const days = new Map([
    ["2026-08-26", { slots: paint(blank(), 9, 11, 0), reflection: "earlier, with a comma" }],
    ["2026-08-27", { slots: paint(blank(), 14, 15, 1), reflection: "later day" }],
  ]);
  const csv = buildCsv(days, cats);
  const result = parseCsv(csv, cats);

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.get("2026-08-26"),
    { slots: paint(blank(), 9, 11, 0), reflection: "earlier, with a comma", notes: [], intents: [], avoid: [] });
  assert.deepEqual(result.data.get("2026-08-27"),
    { slots: paint(blank(), 14, 15, 1), reflection: "later day", notes: [], intents: [], avoid: [] });
});

test("parseCsv rounds times that aren't on the 15-minute grid instead of dropping them", () => {
  // A CSV that has been through a spreadsheet, or came from a 10-minute
  // tracker. This used to produce a fractional array index: the row imported
  // as nothing at all while still reporting success.
  const csv =
    "Date,Start,End,Duration (min),Category,Weight,Note\n" +
    "2026-08-26,09:07,10:07,60,Deep Work,productive,imported\n";
  const result = parseCsv(csv, cats);

  assert.equal(result.ok, true);
  const day = result.data.get("2026-08-26");
  assert.deepEqual(day.slots, paint(blank(), 9, 10, 0), "09:07-10:07 rounds to 09:00-10:00");
  assert.equal(dayHasEntries(day), true, "the imported day must not be silently empty");
});

test("parseCsv says why a sub-slot block can't be imported", () => {
  const csv =
    "Date,Start,End,Duration (min),Category,Weight,Note\n" +
    "2026-08-26,09:02,09:06,4,Deep Work,productive,tiny\n";
  const result = parseCsv(csv, cats);

  assert.equal(result.ok, false);
  assert.match(result.error, /shorter than 15 minutes/);
});

test("parseCsv rejects a file with the wrong header", () => {
  const result = parseCsv("A,B,C\n1,2,3", cats);
  assert.equal(result.ok, false);
  assert.match(result.error, /doesn't look like/);
});

test("parseCsv rejects an unknown category", () => {
  const csv = "Date,Start,End,Duration (min),Category,Weight,Note\n2026-08-26,09:00,10:00,60,Nonexistent,productive,";
  const result = parseCsv(csv, cats);
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown category/i);
});

test("parseCsv rejects a malformed date or time", () => {
  const header = "Date,Start,End,Duration (min),Category,Weight,Note";
  assert.equal(parseCsv(`${header}\nnot-a-date,09:00,10:00,60,Deep Work,productive,`, cats).ok, false);
  assert.equal(parseCsv(`${header}\n2026-08-26,25:00,10:00,60,Deep Work,productive,`, cats).ok, false);
});

test("parseCsv treats an empty or whitespace-only file as empty", () => {
  assert.match(parseCsv("", cats).error, /empty/);
  assert.match(parseCsv("   \n  ", cats).error, /empty/);
});

/* ---------- backup (JSON import/export) ---------- */

test("excludeDays keeps demo days out of a backup without touching the original", () => {
  const real = { slots: paint(blank(), 9, 10, 0), reflection: "mine" };
  const fake = { slots: paint(blank(), 14, 15, 1), reflection: "sample" };
  const days = new Map([
    ["2026-08-26", real],
    ["2026-08-20", fake],
    ["2026-08-21", fake],
  ]);
  const mine = excludeDays(days, ["2026-08-20", "2026-08-21"]);

  assert.deepEqual([...mine.keys()], ["2026-08-26"]);
  assert.equal(days.size, 3, "the source map must not be mutated");

  const backup = buildBackup(mine, cats, DEFAULT_SETTINGS, "1.2.0");
  assert.ok(backup.days["2026-08-26"]);
  assert.equal(backup.days["2026-08-20"], undefined, "demo days must never reach a backup");
  assert.equal(backup.days["2026-08-21"], undefined);
});

test("excludeDays returns every day untouched when demo mode is off", () => {
  const days = new Map([["2026-08-26", { slots: blank(), reflection: "" }]]);
  assert.equal(excludeDays(days, []), days);
  assert.equal(excludeDays(days, undefined), days);
});

test("buildBackup stamps the schema version and app version", () => {
  const days = new Map([["2026-08-26", { slots: paint(blank(), 9, 10, 0), reflection: "" }]]);
  const backup = buildBackup(days, cats, DEFAULT_SETTINGS, "1.2.0", new Date(2026, 7, 27, 12, 0));
  assert.equal(backup.schemaVersion, SCHEMA_VERSION);
  assert.equal(backup.appVersion, "1.2.0");
  assert.ok(backup.days["2026-08-26"]);
  assert.equal(backup.categories.length, DEFAULT_CATEGORIES.length);
});

test("parseBackup round-trips a backup built by buildBackup", () => {
  const days = new Map([["2026-08-26", { slots: paint(blank(), 9, 10, 0), reflection: "note" }]]);
  const backup = buildBackup(days, cats, { ...DEFAULT_SETTINGS, theme: "dark" }, "1.2.0");
  const result = parseBackup(JSON.stringify(backup));

  assert.equal(result.ok, true);
  assert.equal(result.data.settings.theme, "dark");
  assert.deepEqual(result.data.days.get("2026-08-26"),
    { slots: paint(blank(), 9, 10, 0), reflection: "note", notes: [], intents: [], avoid: [] });
});

test("parseBackup rejects invalid JSON", () => {
  const result = parseBackup("{not json");
  assert.equal(result.ok, false);
  assert.match(result.error, /valid JSON/);
});

test("parseBackup rejects a file with no schema version", () => {
  const result = parseBackup(JSON.stringify({ days: {} }));
  assert.equal(result.ok, false);
  assert.match(result.error, /schema version/);
});

test("parseBackup rejects a backup from a newer schema", () => {
  const result = parseBackup(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, days: {} }));
  assert.equal(result.ok, false);
  assert.match(result.error, /newer version/);
});

test("parseBackup never trusts the file — malformed data is normalized, not passed through", () => {
  const result = parseBackup(
    JSON.stringify({
      schemaVersion: 1,
      categories: [{ name: "X", weight: 99 }],
      settings: { theme: "nonsense" },
      days: { "not-a-date": { slots: [] }, "2026-08-26": { slots: "nope" } },
    })
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.categories[0].weight, DEFAULT_CATEGORIES[0].weight, "bad weight falls back");
  assert.equal(result.data.settings.theme, "system", "bad theme falls back");
  assert.equal(result.data.days.has("not-a-date"), false, "malformed key dropped");
  assert.equal(result.data.days.get("2026-08-26").slots.length, SLOTS, "malformed slots repaired");
});

test("summarizeImport counts new vs overlapping days", () => {
  const existing = new Map([
    ["2026-08-25", {}],
    ["2026-08-26", {}],
  ]);
  const incoming = new Map([
    ["2026-08-26", {}],
    ["2026-08-27", {}],
    ["2026-08-28", {}],
  ]);
  assert.deepEqual(summarizeImport(existing, incoming), {
    incomingCount: 3,
    overlapping: 1,
    newCount: 2,
    existingCount: 2,
  });
});

test("mergeDayMaps merge keeps existing days on conflict", () => {
  const existing = new Map([["2026-08-26", { slots: paint(blank(), 9, 10, 0), reflection: "mine" }]]);
  const incoming = new Map([
    ["2026-08-26", { slots: paint(blank(), 1, 2, 5), reflection: "theirs" }],
    ["2026-08-27", { slots: paint(blank(), 3, 4, 2), reflection: "" }],
  ]);
  const merged = mergeDayMaps(existing, incoming, "merge");
  assert.equal(merged.get("2026-08-26").reflection, "mine", "existing day wins on conflict");
  assert.ok(merged.has("2026-08-27"), "missing day is added");
  assert.equal(merged.size, 2);
});

test("mergeDayMaps replace discards days not in the backup", () => {
  const existing = new Map([
    ["2026-08-25", { slots: blank(), reflection: "will be wiped" }],
    ["2026-08-26", { slots: paint(blank(), 9, 10, 0), reflection: "mine" }],
  ]);
  const incoming = new Map([["2026-08-26", { slots: paint(blank(), 1, 2, 5), reflection: "theirs" }]]);
  const replaced = mergeDayMaps(existing, incoming, "replace");
  assert.equal(replaced.has("2026-08-25"), false, "day absent from the backup is gone");
  assert.equal(replaced.get("2026-08-26").reflection, "theirs", "incoming wins outright");
  assert.equal(replaced.size, 1);
});

test("shouldNudgeBackup requires real history and staleness", () => {
  const now = new Date(2026, 7, 28);
  assert.equal(shouldNudgeBackup(null, 3, now), false, "not enough logged days yet");
  assert.equal(shouldNudgeBackup(null, 7, now), true, "never exported, enough history");
  const fifteenDaysAgo = now.getTime() - 15 * 24 * 60 * 60 * 1000;
  const tenDaysAgo = now.getTime() - 10 * 24 * 60 * 60 * 1000;
  assert.equal(shouldNudgeBackup(fifteenDaysAgo, 7, now), true, "stale export");
  assert.equal(shouldNudgeBackup(tenDaysAgo, 7, now), false, "recent enough export");
});

/* ---------- reminders ---------- */

test("nextOccurrence picks today when the time is still ahead", () => {
  const now = new Date(2026, 7, 28, 9, 0);
  const at = new Date(nextOccurrence("13:00", now));
  assert.equal(at.getDate(), 28);
  assert.equal(at.getHours(), 13);
});

test("nextOccurrence rolls to tomorrow when the time has passed", () => {
  const now = new Date(2026, 7, 28, 15, 0);
  const at = new Date(nextOccurrence("13:00", now));
  assert.equal(at.getDate(), 29);
});

test("nextOccurrence rolls over month end", () => {
  const now = new Date(2026, 7, 31, 22, 0);
  const at = new Date(nextOccurrence("09:00", now));
  assert.equal(at.getMonth(), 8, "September");
  assert.equal(at.getDate(), 1);
});

test("reminderMessage varies morning vs evening, and reports what's left", () => {
  assert.match(reminderMessage(0, 999), /morning/);
  assert.match(reminderMessage(1, 60), /1h.*isn't logged/);
  assert.match(reminderMessage(1, 0), /fully logged/);
});

test("nextWeeklyOccurrence finds the next matching weekday, rolling a week if today's slot passed", () => {
  const fri = new Date(2026, 7, 28, 12, 0); // Friday
  const sunday8pm = new Date(nextWeeklyOccurrence(0, "20:00", fri));
  assert.equal(sunday8pm.getDate(), 30, "next Sunday");

  const alreadyPast = new Date(nextWeeklyOccurrence(5, "09:00", fri)); // Friday 09:00 already passed
  assert.equal(alreadyPast.getDate(), 4, "rolls to Friday next week (Sep 4)");
  assert.equal(alreadyPast.getMonth(), 8);

  const stillAhead = new Date(nextWeeklyOccurrence(5, "18:00", fri)); // later today
  assert.equal(stillAhead.getDate(), 28, "today, since 18:00 hasn't passed");
});

test("mostRecentWeekStart finds the most recent occurrence of the chosen weekday", () => {
  const fri = new Date(2026, 7, 28, 12, 0);
  assert.equal(dateKey(mostRecentWeekStart(0, fri)), "2026-08-23", "most recent Sunday");
  assert.equal(dateKey(mostRecentWeekStart(1, fri)), "2026-08-24", "most recent Monday");
  assert.equal(dateKey(mostRecentWeekStart(5, fri)), "2026-08-28", "today, if today is the chosen day");
});

/* ---------- streaks ---------- */

/** Marks a set of dates (YYYY-MM-DD) as logged with a single trivial block. */
function loggedDays(...keys) {
  const days = new Map();
  for (const key of keys) days.set(key, { slots: paint(blank(), 9, 10, 0), reflection: "" });
  return days;
}

test("computeStreak counts an unbroken run of consecutive days", () => {
  const days = loggedDays("2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28");
  const now = new Date(2026, 7, 28, 12, 0);
  const streak = computeStreak(days, now);
  assert.equal(streak.current, 5);
  assert.equal(streak.longest, 5);
  assert.equal(streak.freezesUsedThisWeek, 0);
  assert.equal(streak.isAtRisk, false);
});

test("computeStreak absorbs a single missed day as a freeze", () => {
  // 24, 25, 26 logged, 27 missed, 28 (today) logged.
  const days = loggedDays("2026-08-24", "2026-08-25", "2026-08-26", "2026-08-28");
  const now = new Date(2026, 7, 28, 12, 0);
  const streak = computeStreak(days, now);
  assert.equal(streak.current, 4, "the gap didn't reset the streak");
  assert.equal(streak.freezesUsedThisWeek, 1);
});

test("computeStreak breaks on a second gap within the same rolling 7 days", () => {
  // 20, 21 logged, 22 missed (freeze), 23, 24 logged, 25 missed (second gap, 3 days
  // after the first — still inside a rolling 7-day window, so it breaks), 26, 27, 28 logged.
  const days = loggedDays(
    "2026-08-20",
    "2026-08-21",
    "2026-08-23",
    "2026-08-24",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28"
  );
  const now = new Date(2026, 7, 28, 12, 0);
  const streak = computeStreak(days, now);
  assert.equal(streak.current, 3, "only the days since the second gap count");
  assert.equal(streak.longest, 4, "the pre-break run was longer");
});

test("computeStreak: today not yet logged doesn't break the streak, but can flag it as at risk", () => {
  const days = loggedDays("2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27");

  const midday = computeStreak(days, new Date(2026, 7, 28, 10, 0));
  assert.equal(midday.current, 4, "yesterday's streak still stands");
  assert.equal(midday.isAtRisk, false, "not late yet");

  const evening = computeStreak(days, new Date(2026, 7, 28, 21, 0));
  assert.equal(evening.current, 4);
  assert.equal(evening.isAtRisk, true, "late and still not logged");
});

test("computeStreak tracks the longest streak even once the current one is shorter", () => {
  // A 6-day run early on, a full break, then a fresh 2-day run.
  const days = loggedDays(
    "2026-08-01",
    "2026-08-02",
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    // gap of many days, well past any freeze window
    "2026-08-27",
    "2026-08-28"
  );
  const now = new Date(2026, 7, 28, 12, 0);
  const streak = computeStreak(days, now);
  assert.equal(streak.current, 2);
  assert.equal(streak.longest, 6);
});

test("computeStreak on an empty history", () => {
  assert.deepEqual(computeStreak(new Map(), new Date(2026, 7, 28)), {
    current: 0,
    longest: 0,
    freezesUsedThisWeek: 0,
    isAtRisk: false,
  });
});

/* ---------- weekly recap ---------- */

test("weeklyRecap summarizes a 7-day window", () => {
  const days = new Map([
    ["2026-08-24", { slots: paint(blank(), 9, 13, 0), reflection: "" }], // 4h Deep Work, score 100
    ["2026-08-26", { slots: paint(blank(), 9, 10, 5), reflection: "" }], // 1h Distraction, score -100
  ]);
  const recap = weeklyRecap(days, cats, new Date(2026, 7, 24)); // Monday
  assert.equal(recap.trackedMin, 300);
  assert.equal(recap.topCategory.name, "Deep Work");
  assert.equal(recap.bestDay.key, "2026-08-24");
  assert.ok(recap.streak);
});

test("weeklyRecap handles a week with nothing logged", () => {
  const recap = weeklyRecap(new Map(), cats, new Date(2026, 7, 24));
  assert.equal(recap.trackedMin, 0);
  assert.equal(recap.topCategory, null);
  assert.equal(recap.bestDay, null);
});

test("weeklyRecapMessage summarizes tracked time and the top category", () => {
  const days = new Map([["2026-08-24", { slots: paint(blank(), 9, 13, 0), reflection: "" }]]);
  const msg = weeklyRecapMessage(weeklyRecap(days, cats, new Date(2026, 7, 24)));
  assert.match(msg, /4h tracked/);
  assert.match(msg, /Deep Work/);
});

test("weeklyRecapMessage reports a blank week plainly", () => {
  assert.equal(
    weeklyRecapMessage(weeklyRecap(new Map(), cats, new Date(2026, 7, 24))),
    "Nothing logged last week. Worth a fresh start this week?"
  );
});

/* ---------- goals ---------- */

const perCatMin = (stats) => stats.perCat.map((n) => n * SLOT_MIN);

test("goalProgress reports only categories with an active goal", () => {
  const slots = paint(blank(), 9, 10, 0); // 1h Deep Work
  const stats = computeStats(slots, cats);
  const rows = goalProgress(perCatMin(stats), { 0: 120, 5: 30 }, cats);

  assert.equal(rows.length, 2);
  const deepWork = rows.find((r) => r.categoryId === 0);
  assert.equal(deepWork.actualMin, 60);
  assert.equal(deepWork.pct, 50);
  assert.equal(deepWork.met, false);

  const distraction = rows.find((r) => r.categoryId === 5);
  assert.equal(distraction.actualMin, 0);
  assert.equal(distraction.met, false);
});

test("goalProgress marks a goal as met once the target is reached, and caps the bar at 100%", () => {
  const stats = computeStats(paint(blank(), 9, 12, 0), cats); // 3h Deep Work
  const rows = goalProgress(perCatMin(stats), { 0: 90 }, cats);
  assert.equal(rows[0].met, true);
  assert.equal(rows[0].pct, 100, "never exceeds 100%");
});

test("goalProgress skips a disabled category even with a goal set", () => {
  const disabled = cats.map((c, i) => (i === 0 ? { ...c, enabled: false } : c));
  const stats = computeStats(paint(blank(), 9, 10, 0), disabled);
  assert.equal(goalProgress(perCatMin(stats), { 0: 60 }, disabled).length, 0);
});

test("goalProgress works the same way against a week's summed minutes, for weekly goals", () => {
  // A weekly goal check just needs a different perCatMin input — 3h summed
  // across the week, against a 3h/week target.
  const rows = goalProgress([180, 0, 0, 0, 0, 0], { 0: 180 }, cats);
  assert.equal(rows[0].actualMin, 180);
  assert.equal(rows[0].met, true);
});

test("weekPerCatMinutes sums a category's minutes across all 7 days of the week", () => {
  const days = new Map();
  const monday = new Date("2026-08-24T00:00:00"); // a Monday
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    days.set(dateKey(d), { slots: paint(blank(), 9, 10, 0), reflection: "" }); // 1h Deep Work/day
  }
  const totals = weekPerCatMinutes(days, cats, monday);
  assert.equal(totals[0], 7 * 60, "1h/day × 7 days");
  assert.equal(totals[1], 0);
});

test("weekPerCatMinutes treats a day with no entry as fully untracked, not an error", () => {
  const totals = weekPerCatMinutes(new Map(), cats, new Date("2026-08-24T00:00:00"));
  assert.deepEqual(totals, cats.map(() => 0));
});

/* ---------- personal bests ---------- */

test("personalBests finds the longest streak, best score, and most productive day", () => {
  const days = new Map([
    ["2026-08-24", { slots: paint(blank(), 9, 13, 0), reflection: "" }], // 4h productive, score 100
    ["2026-08-25", { slots: paint(blank(), 9, 10, 0), reflection: "" }], // 1h productive, score 100 too, but shorter
    ["2026-08-26", { slots: paint(blank(), 9, 10, 5), reflection: "" }], // 1h distraction, score -100
  ]);
  const bests = personalBests(days, cats, new Date(2026, 7, 26, 12, 0));
  assert.equal(bests.longestStreak, 3);
  assert.equal(bests.bestScore.score, 100);
  assert.equal(bests.mostProductiveDay.key, "2026-08-24", "4h beats 1h");
  assert.equal(bests.mostProductiveDay.productiveMin, 240);
});

test("personalBests on an empty history", () => {
  const bests = personalBests(new Map(), cats, new Date(2026, 7, 28));
  assert.equal(bests.longestStreak, 0);
  assert.equal(bests.bestScore, null);
  assert.equal(bests.mostProductiveDay, null);
});

/* ---------- typed entry ---------- */

test("parseTimeEntry reads 24h ranges", () => {
  const r = parseTimeEntry("9-11 deep work", cats);
  assert.equal(r.ok, true);
  assert.equal(r.startSlot, 36);
  assert.equal(r.endSlot, 44);
  assert.equal(r.categoryId, 0);
});

test("parseTimeEntry reads 24h ranges with minutes and a colon", () => {
  const r = parseTimeEntry("13:30-15 applications", cats);
  assert.equal(r.ok, true);
  assert.equal(r.startSlot, 54);
  assert.equal(r.endSlot, 60);
  assert.equal(r.categoryId, 1);
});

test("parseTimeEntry reads 12h ranges with am/pm", () => {
  const r = parseTimeEntry("9pm-11pm study", cats);
  assert.equal(r.ok, true);
  assert.equal(r.startSlot, 84);
  assert.equal(r.endSlot, 92);
  assert.equal(r.categoryId, 2);
});

test("parseTimeEntry accepts \"to\" as a separator and is case-insensitive", () => {
  const r = parseTimeEntry("9AM to 10AM Admin", cats);
  assert.equal(r.ok, true);
  assert.equal(r.startSlot, 36);
  assert.equal(r.endSlot, 40);
  assert.equal(r.categoryId, 3);
});

test("parseTimeEntry matches a category by partial, case-insensitive name", () => {
  const r = parseTimeEntry("9-10 appl", cats);
  assert.equal(r.ok, true);
  assert.equal(r.categoryId, 1, "matches Applications");
});

test("parseTimeEntry matches a category by a personal alias, not just its own name", () => {
  const withAliases = cats.map((c) => (c.id === 1 ? { ...c, aliases: ["leetcode", "resume"] } : c));
  const r = parseTimeEntry("9-10 leetcode", withAliases);
  assert.equal(r.ok, true);
  assert.equal(r.categoryId, 1, "leetcode is aliased to Applications");
});

test("parseTimeEntry prefers an exact alias match over a partial name match elsewhere", () => {
  // "app" partially matches "Applications" (id 1) by name, but is also an
  // exact alias of Admin (id 3) here — the exact match should win, same as
  // an exact *name* match already does.
  const reAliased = cats.map((c) => (c.id === 3 ? { ...c, aliases: ["app"] } : c));
  const r = parseTimeEntry("9-10 app", reAliased);
  assert.equal(r.ok, true);
  assert.equal(r.categoryId, 3, "exact alias match beats a partial name match");
});

test("parseTimeEntry treats an ambiguous alias the same as an ambiguous name — asks to be more specific", () => {
  const ambiguous = cats.map((c) => {
    if (c.id === 3) return { ...c, aliases: ["chores"] };
    if (c.id === 4) return { ...c, aliases: ["chore time"] };
    return c;
  });
  const r = parseTimeEntry("9-10 chore", ambiguous); // partially matches both aliases, exactly neither
  assert.equal(r.ok, false);
  assert.match(r.error, /be more specific/);
});

test("parseTimeEntry crosses midnight for a short overnight range", () => {
  const r = parseTimeEntry("11pm-1am study", cats);
  assert.equal(r.ok, true);
  assert.equal(r.startSlot, 92);
  assert.equal(r.endSlot, 100, "wraps past slot 96");
});

test("parseTimeEntry rejects an inverted range that isn't a plausible overnight entry", () => {
  const r = parseTimeEntry("15-9 study", cats); // 3pm to 9am — an 18h "wrap", not overnight
  assert.equal(r.ok, false);
  assert.match(r.error, /before the start/);
});

test("parseTimeEntry rejects an unknown category", () => {
  const r = parseTimeEntry("9-10 nonexistent", cats);
  assert.equal(r.ok, false);
  assert.match(r.error, /no category matches/i);
});

test("parseTimeEntry rejects an ambiguous category", () => {
  const overlapping = [
    { id: 0, name: "Study", weight: 1, enabled: true, cls: "cat-0" },
    { id: 1, name: "Study Group", weight: 1, enabled: true, cls: "cat-1" },
  ];
  const r = parseTimeEntry("9-10 stu", overlapping);
  assert.equal(r.ok, false);
  assert.match(r.error, /be more specific/);
});

test("parseTimeEntry rejects unreadable input", () => {
  assert.equal(parseTimeEntry("", cats).ok, false);
  assert.equal(parseTimeEntry("not a time entry at all", cats).ok, false);
  assert.equal(parseTimeEntry("9-11", cats).ok, false, "missing category");
  assert.equal(parseTimeEntry("13pm-14pm study", cats).ok, false, "13pm is not a valid 12h hour");
});

/* ---------- misc ---------- */

test("dayHasEntries distinguishes a painted day from an empty one", () => {
  assert.equal(dayHasEntries({ slots: paint(blank(), 9, 10, 0) }), true);
  assert.equal(dayHasEntries({ slots: blank() }), false);
  assert.equal(dayHasEntries(null), false);
  assert.equal(dayHasEntries({}), false);
});

test("fmtClock switches between 24h and 12h", () => {
  assert.equal(fmtClock(36), "09:00");
  assert.equal(fmtClock(36, "12h"), "9:00am");
  assert.equal(fmtClock(0, "12h"), "12:00am");
  assert.equal(fmtClock(48, "12h"), "12:00pm");
  assert.equal(fmtClock(84, "12h"), "9:00pm");
});

/* ---------- shareable snapshot ---------- */

test("buildShareSvgMarkup renders one wedge per run and includes the date and score", () => {
  const slots = paint(paint(blank(), 9, 11, 0), 11, 12, 5); // deep work then distraction
  const svg = buildShareSvgMarkup(slots, cats, "Friday, August 28");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal((svg.match(/<path /g) ?? []).length, 2, "one wedge per run");
  assert.match(svg, />Friday, August 28</);
  assert.match(svg, />Deep Work led at 2h</);
});

test("buildShareSvgMarkup shows an em dash and no wedges for an untouched day", () => {
  const svg = buildShareSvgMarkup(blank(), cats, "Today");
  assert.equal((svg.match(/<path /g) ?? []).length, 0);
  assert.match(svg, />—</, "no-data score renders as an em dash, not 0");
  assert.match(svg, />Nothing logged yet</);
});

test("buildShareSvgMarkup escapes a category name that contains markup", () => {
  const spicy = cats.map((c, i) => (i === 0 ? { ...c, name: "R&D <script>" } : c));
  const svg = buildShareSvgMarkup(paint(blank(), 9, 10, 0), spicy, "Today");
  assert.match(svg, /R&amp;D &lt;script&gt;/);
  assert.doesNotMatch(svg, /<script>/);
});

test("buildShareSvgMarkup only includes the streak line when asked and streak is running", () => {
  const slots = paint(blank(), 9, 10, 0);
  assert.doesNotMatch(buildShareSvgMarkup(slots, cats, "Today"), /day streak/);
  assert.doesNotMatch(buildShareSvgMarkup(slots, cats, "Today", { current: 0 }), /day streak/);
  assert.match(buildShareSvgMarkup(slots, cats, "Today", { current: 5 }), />🔥 5 day streak</);
});

/* ---------- Google Drive backup ---------- */

test("driveListUrl scopes the search to appDataFolder and this app's filename", () => {
  const url = driveListUrl();
  assert.match(url, /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/);
  assert.match(url, /spaces=appDataFolder/);
  assert.match(decodeURIComponent(url), new RegExp(`name='${DRIVE_BACKUP_FILENAME}'`));
  assert.match(decodeURIComponent(url), /trashed=false/);
});

test("driveParseListResponse finds the file id, or null for a first-ever backup", () => {
  assert.deepEqual(driveParseListResponse({ files: [{ id: "abc123", modifiedTime: "2026-08-28T00:00:00Z" }] }), {
    id: "abc123",
    modifiedTime: "2026-08-28T00:00:00Z",
  });
  assert.equal(driveParseListResponse({ files: [] }), null);
  assert.equal(driveParseListResponse({}), null);
  assert.equal(driveParseListResponse(null), null);
});

test("driveUploadUrl picks PATCH-in-place with an id, multipart create without one", () => {
  assert.match(driveUploadUrl("abc123"), /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\/abc123\?uploadType=media$/);
  assert.match(driveUploadUrl(null), /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=multipart$/);
});

test("driveCreateMultipartBody wraps metadata and content in the given boundary", () => {
  const body = driveCreateMultipartBody('{"days":{}}', "BOUND1");
  assert.match(body, /^--BOUND1\r\n/);
  assert.match(body, /"parents":\["appDataFolder"\]/);
  assert.match(body, new RegExp(`"name":"${DRIVE_BACKUP_FILENAME}"`));
  assert.match(body, /\{"days":\{\}\}/);
  assert.match(body, /--BOUND1--$/);
});

test("driveDownloadUrl requests the raw file content", () => {
  assert.equal(driveDownloadUrl("abc123"), "https://www.googleapis.com/drive/v3/files/abc123?alt=media");
});

test("driveDeleteUrl targets the file itself, not just a query", () => {
  assert.equal(driveDeleteUrl("abc123"), "https://www.googleapis.com/drive/v3/files/abc123");
});

/* ---------- sample data ---------- */

test("buildSampleDays is deterministic and keys every day off the given `now`", () => {
  const now = new Date("2026-08-29T12:00:00");
  const a = buildSampleDays(now);
  const b = buildSampleDays(new Date("2026-08-29T18:45:00")); // same day, different time
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
  assert.ok(a.has("2026-08-29"), "today is included");
  assert.ok(a.has("2026-08-09"), "reaches back roughly three weeks");
});

test("buildSampleDays leaves some days genuinely unlogged, not just low-scoring", () => {
  const days = buildSampleDays(new Date("2026-08-29T12:00:00"));
  assert.ok(days.size < 21, "at least one of the 21 days in range is skipped entirely");
  for (const day of days.values()) assert.ok(dayHasEntries(day), "every included day has at least one painted slot");
});

test("buildSampleDays produces a real, non-trivial current streak", () => {
  const now = new Date("2026-08-29T12:00:00");
  const days = buildSampleDays(now);
  const streak = computeStreak(days, now);
  assert.ok(streak.current >= 3, `expected a real streak, got ${streak.current}`);
});

test("buildSampleDays varies scores instead of every day looking the same", () => {
  const now = new Date("2026-08-29T12:00:00");
  const days = buildSampleDays(now);
  const scores = [...days.values()].map((d) => computeStats(d.slots, DEFAULT_CATEGORIES).score);
  assert.ok(Math.min(...scores) < 0, "at least one rough day");
  assert.ok(Math.max(...scores) > 50, "at least one strong day");
});

test("buildSampleDays includes at least one reflection, for note search to have something to find", () => {
  const days = buildSampleDays(new Date("2026-08-29T12:00:00"));
  assert.ok([...days.values()].some((d) => d.reflection.length > 0));
});

/* ---------- streak across a midnight DST transition ---------- */

test("computeStreak counts today in a timezone where DST springs forward at midnight", () => {
  // America/Havana moves 00:00 -> 01:00 on 2026-03-08. Advancing the cursor
  // with setDate alone left it stuck at 01:00 for the rest of the walk, one
  // hour past a midnight `end`, so the final day was never processed and
  // every streak read one short from then on.
  const logged = new Map();
  const start = new Date(2026, 1, 1); // 2026-02-01 local
  const now = new Date(2026, 2, 9, 12, 0); // 2026-03-09 midday
  let expected = 0;
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    logged.set(dateKey(d), { slots: paint(blank(), 9, 10, 0), reflection: "" });
    expected++;
  }
  const streak = computeStreak(logged, now);
  assert.equal(streak.current, expected, "every logged day up to and including today counts");
});

/* ---------- typed entry: erasing ---------- */

test("parseTimeEntry maps erase words to untracked", () => {
  for (const word of ["erase", "clear", "untracked", "none", "empty"]) {
    const r = parseTimeEntry(`9-11 ${word}`, cats);
    assert.equal(r.ok, true, `"${word}" should parse`);
    assert.equal(r.categoryId, UNTRACKED, `"${word}" should erase`);
    assert.equal(r.startSlot, 36);
    assert.equal(r.endSlot, 44);
  }
});

test("a user's own category beats an erase word of the same name", () => {
  // Renaming a category "Empty" must still get you that category, not a wipe.
  const renamed = cats.map((c, i) => (i === 3 ? { ...c, name: "Empty" } : c));
  const r = parseTimeEntry("9-11 empty", renamed);
  assert.equal(r.ok, true);
  assert.equal(r.categoryId, 3, "the real category wins over the reserved word");
});

/* ---------- day notes and intentions ---------- */

test("normalizeDay keeps well-formed notes and drops broken ones", () => {
  const day = normalizeDay({
    slots: paint(blank(), 9, 11, 0),
    notes: [
      { from: 36, to: 44, text: "sent the mail" },
      { from: 5, to: 2, text: "inverted range" },
      { from: 0, to: 4, text: "   " },
      { from: 0, to: 4 },
      "not an object",
    ],
  });
  assert.deepEqual(day.notes, [{ from: 36, to: 44, text: "sent the mail" }]);
});

test("normalizeDay clamps a note's range into the day and orders notes by start", () => {
  const day = normalizeDay({
    slots: blank(),
    notes: [
      { from: 80, to: 999, text: "late" },
      { from: -5, to: 4, text: "early" },
    ],
  });
  assert.equal(day.notes[0].text, "early", "sorted by start");
  assert.equal(day.notes[0].from, 0, "clamped to the start of the day");
  assert.equal(day.notes[1].to, SLOTS, "clamped to the end of the day");
});

test("normalizeDay keeps intentions with their done state, dropping blanks", () => {
  const day = normalizeDay({
    slots: blank(),
    intents: [{ text: "Leetcode", done: true }, { text: "Mail the prof" }, { text: "  " }],
  });
  assert.deepEqual(day.intents, [
    { text: "Leetcode", done: true },
    { text: "Mail the prof", done: false },
  ]);
});

test("dayHasContent counts a day that only has a note or an intention", () => {
  const onlyNote = normalizeDay({ slots: blank(), notes: [{ from: 0, to: 4, text: "n" }] });
  const onlyIntent = normalizeDay({ slots: blank(), intents: [{ text: "i" }] });
  const empty = normalizeDay(null);

  assert.equal(dayHasContent(onlyNote), true);
  assert.equal(dayHasContent(onlyIntent), true);
  assert.equal(dayHasContent(empty), false);
  assert.equal(dayHasEntries(onlyNote), false, "streaks still need painted time");
});

test("a backup round-trips notes and intentions", () => {
  const days = new Map([
    ["2026-08-26", normalizeDay({
      slots: paint(blank(), 9, 11, 0),
      reflection: "good day",
      notes: [{ from: 36, to: 44, text: "sent the mail" }],
      intents: [{ text: "Leetcode", done: true }],
    })],
  ]);
  const parsed = parseBackup(JSON.stringify(buildBackup(days, cats, DEFAULT_SETTINGS, "1.0.0")));
  assert.equal(parsed.ok, true);
  const back = parsed.data.days.get("2026-08-26");
  assert.deepEqual(back.notes, [{ from: 36, to: 44, text: "sent the mail" }]);
  assert.deepEqual(back.intents, [{ text: "Leetcode", done: true }]);
});

/* ---------- things to avoid ---------- */

test("normalizeDay accepts an avoid list as plain strings or objects", () => {
  const day = normalizeDay({
    slots: blank(),
    avoid: ["Doom-scrolling", { text: "10h of series" }, "   ", 42, null],
  });
  assert.deepEqual(day.avoid, ["Doom-scrolling", "10h of series"]);
  assert.equal(dayHasContent(day), true, "an avoid list alone is worth keeping");
  assert.equal(dayHasEntries(day), false, "but it isn't logged time");
});

/* ---------- named challenge ---------- */

test("challengeProgress counts the start date as day 1", () => {
  const c = normalizeSettings({ challenge: { name: "#100days", startKey: "2026-08-11", targetDays: 100 } }).challenge;
  assert.deepEqual(c, { name: "#100days", startKey: "2026-08-11", targetDays: 100 });

  assert.equal(challengeProgress(c, new Date(2026, 7, 11)).day, 1, "the start date is day 1");
  assert.equal(challengeProgress(c, new Date(2026, 7, 29)).day, 19);
  assert.equal(challengeProgress(c, new Date(2026, 7, 10)), null, "nothing before it starts");
  assert.equal(challengeProgress(null, new Date()), null);
});

test("challengeProgress is unaffected by the time of day", () => {
  const c = normalizeSettings({ challenge: { name: "run", startKey: "2026-08-11" } }).challenge;
  assert.equal(c.targetDays, null, "a target is optional");
  assert.equal(challengeProgress(c, new Date(2026, 7, 20, 0, 5)).day, 10);
  assert.equal(challengeProgress(c, new Date(2026, 7, 20, 23, 55)).day, 10);
});

test("normalizeSettings drops a malformed challenge rather than counting nonsense", () => {
  const bad = [
    { name: "x" },
    { startKey: "2026-08-11" },
    { name: "x", startKey: "not-a-date" },
    { name: "   ", startKey: "2026-08-11" },
    "nope",
  ];
  for (const c of bad) assert.equal(normalizeSettings({ challenge: c }).challenge, null, JSON.stringify(c));
  assert.equal(
    normalizeSettings({ challenge: { name: "x", startKey: "2026-08-11", targetDays: -5 } }).challenge.targetDays,
    null,
    "a nonsensical target is dropped but the challenge survives"
  );
});

/* ---------- weekly review ---------- */

test("weeklyRecap counts how the week's stated intentions went", () => {
  const slots = paint(blank(), 9, 11, 0);
  const days = new Map([
    ["2026-08-24", normalizeDay({ slots, intents: [{ text: "a", done: true }, { text: "b" }] })],
    ["2026-08-25", normalizeDay({ slots, intents: [{ text: "c", done: true }] })],
  ]);
  const recap = weeklyRecap(days, cats, new Date(2026, 7, 24));
  assert.equal(recap.intentsSet, 3);
  assert.equal(recap.intentsDone, 2);
  assert.equal(recap.daysLogged, 2);
});

test("the weekly recap message ends by asking what to adjust", () => {
  const slots = paint(blank(), 9, 11, 0);
  const days = new Map([["2026-08-24", normalizeDay({ slots, intents: [{ text: "a", done: true }] })]]);
  const msg = weeklyRecapMessage(weeklyRecap(days, cats, new Date(2026, 7, 24)));
  assert.match(msg, /1 of 1 intentions/);
  assert.match(msg, /adjust/, "a review should prompt a decision, not just report");

  const empty = weeklyRecapMessage(weeklyRecap(new Map(), cats, new Date(2026, 7, 24)));
  assert.match(empty, /Nothing logged/);
  assert.doesNotMatch(empty, /intentions/, "no intention count when there were none");
});

/* ---------- Drive account email ---------- */

test("driveUserInfoUrl asks for only the email field", () => {
  assert.match(driveUserInfoUrl(), /^https:\/\/www\.googleapis\.com\//);
  assert.match(driveUserInfoUrl(), /[?&]fields=email\b/);
});

test("driveParseUserInfoResponse extracts the email, or null if absent", () => {
  assert.equal(driveParseUserInfoResponse({ email: "a@example.com" }), "a@example.com");
  assert.equal(driveParseUserInfoResponse({}), null, "a token issued before this scope existed");
  assert.equal(driveParseUserInfoResponse({ email: "" }), null);
  assert.equal(driveParseUserInfoResponse(null), null);
});

/* ---------- byte formatting ---------- */

test("fmtBytes scales to the smallest sensible unit", () => {
  assert.equal(fmtBytes(512), "512 B");
  assert.equal(fmtBytes(2048), "2.0 KB");
  assert.equal(fmtBytes(1_500_000), "1.4 MB");
  assert.equal(fmtBytes(null), null);
  assert.equal(fmtBytes(-1), null);
});

/* ---------- pattern detection ---------- */

// Fixed instant every test below is measured against, so nothing here is
// accidentally time-dependent.
const PATTERN_NOW = new Date(2026, 7, 28, 12, 0);

/** A full day object, painted plus whatever fields a test cares about. */
function mkDay(slots, extra = {}) {
  return { slots, reflection: "", notes: [], intents: [], avoid: [], ...extra };
}

/** Builds a days Map from {offset, day} entries — `offset` is calendar days
 *  before `now` (0 = today), matching the detectors' own `recentDays`. */
function daysMap(now, entries) {
  const days = new Map();
  for (const { offset, day } of entries) {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    days.set(dateKey(d), day);
  }
  return days;
}

/** One painted slot, placed well clear of anything a test measures — purely
 *  to push the earliest logged day past MIN_HISTORY_DAYS so the history gate
 *  passes without disturbing the metric under test. */
const historyFiller = (offset) => ({ offset, day: mkDay(paint(blank(), 3, 3.25, 0)) });

test("detectPatterns returns an empty array when there's no history at all", () => {
  assert.deepEqual(detectPatterns(new Map(), cats, DEFAULT_SETTINGS, PATTERN_NOW), []);
});

test("detectPatterns fires all six detectors, in the fixed order, when every condition is met", () => {
  const entries = [];

  // Offsets 0-6: this week's heavy distraction (current window for
  // detectDistractionTrend) and low overall coverage (recent window for
  // detectCoverageDecline). A handful of intentions live here too.
  for (let o = 0; o <= 6; o++) {
    const intents = o <= 4 ? [{ text: `a${o}`, done: o < 2 }, { text: `b${o}`, done: false }] : [];
    entries.push({ offset: o, day: mkDay(paint(blank(), 13, 15, 5), { intents }) }); // 120 min distraction
  }

  // Offsets 7-13: last week's lighter distraction (the trend's baseline),
  // plus a sliver of 09:00 productive time that never reaches "protected".
  for (let o = 7; o <= 13; o++) {
    let slots = paint(blank(), 13, 14.5, 5); // 90 min distraction
    slots = paint(slots, 9, 9.25, 0); // 15 min at the eventual peak hour
    entries.push({ offset: o, day: mkDay(slots) });
  }

  // Offsets 14-20: only detectCoverageDecline's older window reaches this
  // far back, so its heavier logging pulls that average well above the
  // recent one without touching any of the shorter windows above.
  for (let o = 14; o <= 20; o++) {
    entries.push({ offset: o, day: mkDay(paint(blank(), 13, 19, 5)) }); // 360 min
  }

  // Offsets 21-26: 09:00 painted in full — the peak hour, "protected" on
  // exactly these six days out of the window's logged days.
  for (let o = 21; o <= 26; o++) {
    entries.push({ offset: o, day: mkDay(paint(blank(), 9, 10, 0)) });
  }

  const days = daysMap(PATTERN_NOW, entries);
  const observations = detectPatterns(days, cats, DEFAULT_SETTINGS, PATTERN_NOW);

  assert.deepEqual(
    observations.map((o) => o.id),
    ["intentionOvercommit", "noBreaks", "peakHoursUnprotected", "distractionTrend", "coverageDecline", "untrackedLifeArea"]
  );
  for (const o of observations) {
    assert.equal(o.suggestionKey, o.id, "suggestionKey mirrors id for every detector");
    assert.ok(o.headline && o.detail, "every observation has a headline and detail");
  }
});

/* ----- intention overcommit ----- */

test("detectIntentionOvercommit flags overcommitting on intentions within the last 21 days", () => {
  const entries = [
    {
      offset: 0,
      day: mkDay(paint(blank(), 9, 10, 0), {
        intents: [{ text: "a", done: true }, { text: "b", done: false }, { text: "c", done: false }],
      }),
    },
    {
      offset: 3,
      day: mkDay(paint(blank(), 9, 10, 0), {
        intents: [{ text: "d", done: false }, { text: "e", done: false }, { text: "f", done: false }],
      }),
    },
    {
      offset: 6,
      day: mkDay(paint(blank(), 9, 10, 0), { intents: [{ text: "g", done: true }, { text: "h", done: false }] }),
    },
    {
      offset: 9,
      day: mkDay(paint(blank(), 9, 10, 0), { intents: [{ text: "i", done: false }, { text: "j", done: false }] }),
    },
    { offset: 12, day: mkDay(paint(blank(), 9, 10, 0)) },
    { offset: 15, day: mkDay(paint(blank(), 9, 10, 0)) },
    { offset: 18, day: mkDay(paint(blank(), 9, 10, 0)) },
    { offset: OVERCOMMIT_WINDOW_DAYS, day: mkDay(paint(blank(), 9, 10, 0)) },
  ];
  const days = daysMap(PATTERN_NOW, entries);
  const obs = detectIntentionOvercommit(days, PATTERN_NOW);
  assert.ok(obs, "expected an observation");
  assert.equal(obs.id, "intentionOvercommit");
  assert.equal(obs.suggestionKey, "intentionOvercommit");
  assert.match(obs.detail, new RegExp(`^${OVERCOMMIT_MIN_INTENTIONS} intentions set in the last ${OVERCOMMIT_WINDOW_DAYS} days`));
  assert.match(obs.detail, /2 finished/);
});

test("detectIntentionOvercommit does not flag when the done ratio sits exactly at the cutoff", () => {
  const perDay = OVERCOMMIT_MIN_INTENTIONS / 2; // two days' worth reaches the minimum
  const donePerDay = perDay * OVERCOMMIT_MAX_DONE_RATIO; // ratio lands exactly on the cutoff
  const intentsFor = () => Array.from({ length: perDay }, (_, i) => ({ text: `x${i}`, done: i < donePerDay }));
  const entries = [
    { offset: 0, day: mkDay(paint(blank(), 9, 10, 0), { intents: intentsFor() }) },
    { offset: 3, day: mkDay(paint(blank(), 9, 10, 0), { intents: intentsFor() }) },
    { offset: 6, day: mkDay(paint(blank(), 9, 10, 0)) },
    { offset: 9, day: mkDay(paint(blank(), 9, 10, 0)) },
    { offset: 12, day: mkDay(paint(blank(), 9, 10, 0)) },
    { offset: 15, day: mkDay(paint(blank(), 9, 10, 0)) },
    { offset: 18, day: mkDay(paint(blank(), 9, 10, 0)) },
    { offset: OVERCOMMIT_WINDOW_DAYS, day: mkDay(paint(blank(), 9, 10, 0)) },
  ];
  const days = daysMap(PATTERN_NOW, entries);
  assert.equal(
    detectIntentionOvercommit(days, PATTERN_NOW),
    null,
    "4 of 10 (40%) done is exactly the cutoff, not fewer than it"
  );
});

test("detectIntentionOvercommit says nothing without three weeks of history", () => {
  const entries = [
    {
      offset: 0,
      day: mkDay(paint(blank(), 9, 10, 0), {
        intents: [{ text: "a", done: true }, { text: "b", done: false }, { text: "c", done: false }],
      }),
    },
    {
      offset: 3,
      day: mkDay(paint(blank(), 9, 10, 0), {
        intents: [{ text: "d", done: false }, { text: "e", done: false }, { text: "f", done: false }],
      }),
    },
    {
      offset: 6,
      day: mkDay(paint(blank(), 9, 10, 0), { intents: [{ text: "g", done: true }, { text: "h", done: false }] }),
    },
    {
      offset: 9,
      day: mkDay(paint(blank(), 9, 10, 0), { intents: [{ text: "i", done: false }, { text: "j", done: false }] }),
    },
    { offset: 12, day: mkDay(paint(blank(), 9, 10, 0)) },
    { offset: 15, day: mkDay(paint(blank(), 9, 10, 0)) },
    { offset: 18, day: mkDay(paint(blank(), 9, 10, 0)) },
    // No entry 21+ days back — only 18 days have elapsed since the first one.
  ];
  const days = daysMap(PATTERN_NOW, entries);
  assert.equal(detectIntentionOvercommit(days, PATTERN_NOW), null);
});

/* ----- no breaks ----- */

test("detectNoBreaks flags two weeks with no neutral or rest time despite heavy tracked hours", () => {
  const entries = [];
  for (let o = 0; o < NO_BREAKS_WINDOW_DAYS; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 9, 11, 0)) }); // 120 min/day
  entries.push(historyFiller(MIN_HISTORY_DAYS));
  const days = daysMap(PATTERN_NOW, entries);
  const obs = detectNoBreaks(days, cats, PATTERN_NOW);
  assert.ok(obs);
  assert.equal(obs.id, "noBreaks");
  assert.equal(obs.suggestionKey, "noBreaks");
  assert.match(obs.detail, new RegExp(`over the last ${NO_BREAKS_WINDOW_DAYS} days`));
});

test("detectNoBreaks does not flag when total tracked time falls just short of the floor", () => {
  const floorMin = NO_BREAKS_MIN_TRACKED_HOURS * 60;
  const entries = [];
  // 13 days at 90 min plus one day at 15 min lands 15 min under the floor.
  for (let o = 0; o < NO_BREAKS_WINDOW_DAYS - 1; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 9, 10.5, 0)) });
  entries.push({ offset: NO_BREAKS_WINDOW_DAYS - 1, day: mkDay(paint(blank(), 9, 9.25, 0)) });
  entries.push(historyFiller(MIN_HISTORY_DAYS));
  const days = daysMap(PATTERN_NOW, entries);
  const totalMin = (NO_BREAKS_WINDOW_DAYS - 1) * 90 + 15;
  assert.ok(totalMin < floorMin, "test data must actually sit under the floor");
  assert.equal(detectNoBreaks(days, cats, PATTERN_NOW), null);
});

test("detectNoBreaks says nothing without three weeks of history", () => {
  const entries = [];
  for (let o = 0; o < NO_BREAKS_WINDOW_DAYS; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 9, 11, 0)) });
  const days = daysMap(PATTERN_NOW, entries);
  assert.equal(detectNoBreaks(days, cats, PATTERN_NOW), null, "only 13 days have elapsed since the first entry");
});

test("detectNoBreaks says nothing when no category is even configured as neutral", () => {
  const noNeutral = cats.map((c) => (c.weight === 0 ? { ...c, weight: 1 } : c));
  const entries = [];
  for (let o = 0; o < NO_BREAKS_WINDOW_DAYS; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 9, 11, 0)) });
  entries.push(historyFiller(MIN_HISTORY_DAYS));
  const days = daysMap(PATTERN_NOW, entries);
  assert.equal(detectNoBreaks(days, noNeutral, PATTERN_NOW), null);
});

/* ----- distraction trend ----- */

test("detectDistractionTrend flags distraction rising sharply week over week", () => {
  const w = DISTRACTION_TREND_WINDOW_DAYS;
  const entries = [];
  for (let o = 0; o < w; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 9, 15, 5)) }); // 360 min/day
  for (let o = w; o < 2 * w; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 9, 13, 5)) }); // 240 min/day
  entries.push(historyFiller(MIN_HISTORY_DAYS));
  const days = daysMap(PATTERN_NOW, entries);
  const obs = detectDistractionTrend(days, cats, PATTERN_NOW);
  assert.ok(obs);
  assert.equal(obs.id, "distractionTrend");
  assert.equal(obs.suggestionKey, "distractionTrend");
  const currentMin = 360 * w;
  const previousMin = 240 * w;
  assert.ok(currentMin >= DISTRACTION_TREND_MIN_CURRENT_MIN, "test data must clear the floor");
  assert.ok(currentMin >= previousMin * DISTRACTION_TREND_MIN_RATIO, "test data must clear the ratio");
});

test("detectDistractionTrend does not flag a rise that falls just short of the ratio", () => {
  const w = DISTRACTION_TREND_WINDOW_DAYS;
  const previousMinPerDay = 300;
  // Just under the ratio: currentMin sits below previousMin * DISTRACTION_TREND_MIN_RATIO
  // while still clearing DISTRACTION_TREND_MIN_CURRENT_MIN on its own.
  const currentMinPerDay = Math.floor(((previousMinPerDay * DISTRACTION_TREND_MIN_RATIO - 15) / SLOT_MIN)) * SLOT_MIN;
  const entries = [];
  for (let o = 0; o < w; o++) {
    entries.push({ offset: o, day: mkDay(paint(blank(), 9, 9 + currentMinPerDay / 60, 5)) });
  }
  for (let o = w; o < 2 * w; o++) {
    entries.push({ offset: o, day: mkDay(paint(blank(), 9, 9 + previousMinPerDay / 60, 5)) });
  }
  entries.push(historyFiller(MIN_HISTORY_DAYS));
  const days = daysMap(PATTERN_NOW, entries);
  const currentMin = currentMinPerDay * w;
  const previousMin = previousMinPerDay * w;
  assert.ok(currentMin >= DISTRACTION_TREND_MIN_CURRENT_MIN, "test data must still clear the floor on its own");
  assert.ok(currentMin < previousMin * DISTRACTION_TREND_MIN_RATIO, "test data must fall just short of the ratio");
  assert.equal(detectDistractionTrend(days, cats, PATTERN_NOW), null);
});

test("detectDistractionTrend says nothing without three weeks of history", () => {
  const w = DISTRACTION_TREND_WINDOW_DAYS;
  const entries = [];
  for (let o = 0; o < w; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 9, 15, 5)) });
  for (let o = w; o < 2 * w; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 9, 13, 5)) });
  const days = daysMap(PATTERN_NOW, entries);
  assert.equal(detectDistractionTrend(days, cats, PATTERN_NOW), null);
});

/* ----- coverage decline ----- */

test("detectCoverageDecline flags logging dropping off compared to the prior two weeks", () => {
  const recent = COVERAGE_DECLINE_RECENT_DAYS;
  const prior = COVERAGE_DECLINE_PRIOR_DAYS;
  const entries = [];
  for (let o = 0; o < recent; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 7, 8, 0)) }); // 60 min/day
  for (let o = recent; o < recent + prior; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 7, 15, 0)) }); // 480 min/day
  entries.push(historyFiller(MIN_HISTORY_DAYS));
  const days = daysMap(PATTERN_NOW, entries);
  const obs = detectCoverageDecline(days, DEFAULT_SETTINGS, PATTERN_NOW);
  assert.ok(obs);
  assert.equal(obs.id, "coverageDecline");
  assert.equal(obs.suggestionKey, "coverageDecline");
  assert.ok(480 >= COVERAGE_DECLINE_MIN_PRIOR_AVG_MIN, "test data's prior average must clear the floor");
  assert.ok(60 < 480 * COVERAGE_DECLINE_MAX_RATIO, "test data's recent average must fall under the ratio");
});

test("detectCoverageDecline does not flag when the drop sits exactly at the cutoff", () => {
  const recent = COVERAGE_DECLINE_RECENT_DAYS;
  const prior = COVERAGE_DECLINE_PRIOR_DAYS;
  const priorMinPerDay = 450;
  const recentMinPerDay = Math.round(priorMinPerDay * COVERAGE_DECLINE_MAX_RATIO); // exactly the cutoff, not under it
  const entries = [];
  for (let o = 0; o < recent; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 7, 7 + recentMinPerDay / 60, 0)) });
  for (let o = recent; o < recent + prior; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 7, 7 + priorMinPerDay / 60, 0)) });
  entries.push(historyFiller(MIN_HISTORY_DAYS));
  const days = daysMap(PATTERN_NOW, entries);
  assert.equal(
    detectCoverageDecline(days, DEFAULT_SETTINGS, PATTERN_NOW),
    null,
    `${recentMinPerDay} is exactly ${COVERAGE_DECLINE_MAX_RATIO * 100}% of ${priorMinPerDay}, not below it`
  );
});

test("detectCoverageDecline says nothing without three weeks of history", () => {
  const recent = COVERAGE_DECLINE_RECENT_DAYS;
  const prior = COVERAGE_DECLINE_PRIOR_DAYS;
  const entries = [];
  for (let o = 0; o < recent; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 7, 8, 0)) });
  for (let o = recent; o < recent + prior; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 7, 15, 0)) });
  const days = daysMap(PATTERN_NOW, entries);
  assert.equal(detectCoverageDecline(days, DEFAULT_SETTINGS, PATTERN_NOW), null);
});

test("detectCoverageDecline says nothing when the prior average was never really established", () => {
  // Same drop in proportion as the flagging case, but the older window
  // itself never reached COVERAGE_DECLINE_MIN_PRIOR_AVG_MIN.
  const recent = COVERAGE_DECLINE_RECENT_DAYS;
  const prior = COVERAGE_DECLINE_PRIOR_DAYS;
  const priorMinPerDay = COVERAGE_DECLINE_MIN_PRIOR_AVG_MIN - 15;
  const recentMinPerDay = 15;
  const entries = [];
  for (let o = 0; o < recent; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 7, 7 + recentMinPerDay / 60, 0)) });
  for (let o = recent; o < recent + prior; o++) entries.push({ offset: o, day: mkDay(paint(blank(), 7, 7 + priorMinPerDay / 60, 0)) });
  entries.push(historyFiller(MIN_HISTORY_DAYS));
  const days = daysMap(PATTERN_NOW, entries);
  assert.ok(priorMinPerDay < COVERAGE_DECLINE_MIN_PRIOR_AVG_MIN, "test data's prior average must fall short of the floor");
  assert.equal(detectCoverageDecline(days, DEFAULT_SETTINGS, PATTERN_NOW), null);
});

/* ----- peak hours unprotected ----- */

// A "protected" day paints the whole peak hour (all 4 quarter-hour slots,
// well past PEAK_HOURS_DAY_MAJORITY_SLOTS); an "unprotected" day paints
// something else entirely, so it's logged without protecting the hour.
const protectedPeakHourDay = () => {
  assert.ok(4 >= PEAK_HOURS_DAY_MAJORITY_SLOTS, "a full hour must count as protected");
  return mkDay(paint(blank(), 9, 10, 0));
};
const unprotectedLoggedDay = () => mkDay(paint(blank(), 14, 15, 3));

test("detectPeakHoursUnprotected flags a peak hour that's rarely protected", () => {
  const entries = [];
  for (const o of [0, 2, 4]) entries.push({ offset: o, day: protectedPeakHourDay() });
  for (const o of [6, 8, 10, 12, 14, 16, 18, 20, 22]) entries.push({ offset: o, day: unprotectedLoggedDay() });
  assert.ok(22 < PEAK_HOURS_WINDOW_DAYS, "every offset above must fall inside the 28-day window");
  const days = daysMap(PATTERN_NOW, entries);
  const obs = detectPeakHoursUnprotected(days, cats, PATTERN_NOW);
  assert.ok(obs);
  assert.equal(obs.id, "peakHoursUnprotected");
  assert.equal(obs.suggestionKey, "peakHoursUnprotected");
  assert.equal(obs.headline, "09:00 is your most productive hour, on 3 of 12 logged days");
  assert.ok(3 / 12 < PEAK_HOURS_MAX_PROTECTED_RATIO, "test data must fall under the protected-ratio cutoff");
});

test("detectPeakHoursUnprotected does not flag a peak hour protected exactly at the cutoff", () => {
  assert.equal(PEAK_HOURS_MAX_PROTECTED_RATIO, 0.4, "this test is built around a 4-of-10 (40%) boundary");
  const entries = [];
  for (const o of [0, 2, 4, 6]) entries.push({ offset: o, day: protectedPeakHourDay() }); // protected, 4 days
  for (const o of [8, 10, 12, 14, 16, 22]) entries.push({ offset: o, day: unprotectedLoggedDay() }); // 6 days
  const days = daysMap(PATTERN_NOW, entries);
  assert.equal(
    detectPeakHoursUnprotected(days, cats, PATTERN_NOW),
    null,
    "4 of 10 (40%) is exactly the cutoff, not fewer"
  );
});

test("detectPeakHoursUnprotected says nothing without three weeks of history", () => {
  const entries = [];
  for (const o of [0, 2, 4]) entries.push({ offset: o, day: protectedPeakHourDay() });
  for (const o of [6, 8, 10, 12]) entries.push({ offset: o, day: unprotectedLoggedDay() });
  assert.ok(entries.length < MIN_LOGGED_DAYS, "this test also falls short on the logged-day count alone");
  const days = daysMap(PATTERN_NOW, entries);
  assert.equal(detectPeakHoursUnprotected(days, cats, PATTERN_NOW), null);
});

/* ----- untracked life area ----- */

test("detectUntrackedLifeArea flags time concentrated in a few categories with one enabled category unused", () => {
  assert.equal(UNTRACKED_LIFE_AREA_MAX_DISTINCT_CATEGORIES, 3, "this test uses exactly the allowed maximum");
  const rotation = [0, 1, 2]; // exactly UNTRACKED_LIFE_AREA_MAX_DISTINCT_CATEGORIES categories
  const entries = [];
  let i = 0;
  for (let o = 0; o < UNTRACKED_LIFE_AREA_WINDOW_DAYS; o += 2) {
    entries.push({ offset: o, day: mkDay(paint(blank(), 9, 11, rotation[i % rotation.length])) });
    i++;
  }
  entries.push(historyFiller(MIN_HISTORY_DAYS));
  const days = daysMap(PATTERN_NOW, entries);
  const obs = detectUntrackedLifeArea(days, cats, PATTERN_NOW);
  assert.ok(obs);
  assert.equal(obs.id, "untrackedLifeArea");
  assert.equal(obs.suggestionKey, "untrackedLifeArea");
  assert.match(obs.detail, /"Admin"/, "names the first unused enabled category");
});

test("detectUntrackedLifeArea does not flag once a fourth category is in the mix", () => {
  const rotation = [0, 1, 2];
  const entries = [];
  let i = 0;
  for (let o = 0; o < UNTRACKED_LIFE_AREA_WINDOW_DAYS - 2; o += 2) {
    entries.push({ offset: o, day: mkDay(paint(blank(), 9, 11, rotation[i % rotation.length])) });
    i++;
  }
  // A 4th category (Admin) used inside the same window — one more than
  // UNTRACKED_LIFE_AREA_MAX_DISTINCT_CATEGORIES allows.
  entries.push({ offset: UNTRACKED_LIFE_AREA_WINDOW_DAYS - 1, day: mkDay(paint(blank(), 9, 10, 3)) });
  entries.push(historyFiller(MIN_HISTORY_DAYS));
  const days = daysMap(PATTERN_NOW, entries);
  assert.equal(detectUntrackedLifeArea(days, cats, PATTERN_NOW), null, "four distinct categories is one too many");
});

test("detectUntrackedLifeArea says nothing without three weeks of history", () => {
  const rotation = [0, 1, 2];
  const entries = [];
  let i = 0;
  for (let o = 0; o < UNTRACKED_LIFE_AREA_WINDOW_DAYS; o += 2) {
    entries.push({ offset: o, day: mkDay(paint(blank(), 9, 11, rotation[i % rotation.length])) });
    i++;
  }
  const days = daysMap(PATTERN_NOW, entries);
  assert.equal(detectUntrackedLifeArea(days, cats, PATTERN_NOW), null, "only 20 days have elapsed");
});

/* ---------- which week the recap reports ---------- */

test("recapWeekStart reports the week that just finished when the recap lands on its last day", () => {
  // weekStart = Sunday, recap on Saturday. The week Aug 23-29 ends that night,
  // and choosing Saturday is how someone asks to hear about it.
  const start = recapWeekStart(0, new Date(2026, 7, 29, 20, 0));
  assert.equal(dateKey(start), "2026-08-23");
});

test("recapWeekStart reports the previous week on any other day", () => {
  // The default: weekStart and recap day both Sunday. The week containing
  // "now" has only just begun, so the completed one before it is the subject.
  const start = recapWeekStart(0, new Date(2026, 7, 23, 20, 0));
  assert.equal(dateKey(start), "2026-08-16");
});

test("recapWeekStart follows a Monday week start", () => {
  // weekStart = Monday, recap on Sunday — Sunday is that week's last day,
  // so the week Aug 17-23 is the one to report, not Aug 10-16.
  const start = recapWeekStart(1, new Date(2026, 7, 23, 20, 0));
  assert.equal(dateKey(start), "2026-08-17");

  // Mid-week keeps reporting the last complete week.
  assert.equal(dateKey(recapWeekStart(1, new Date(2026, 7, 26, 20, 0))), "2026-08-17");
});

test("recapWeekStart never reports a week more than 7 days stale", () => {
  // The bug it replaces: a window up to a week behind, whose numbers looked
  // current. Whatever the pair of settings, the reported week must end within
  // the last seven days.
  for (const weekStart of [0, 1]) {
    for (let day = 23; day <= 29; day++) {
      const now = new Date(2026, 7, day, 20, 0);
      const start = recapWeekStart(weekStart, now);
      const end = new Date(start);
      end.setDate(end.getDate() + 7); // exclusive
      const daysStale = Math.round((now - end) / 86400000);
      assert.ok(daysStale < 7, `weekStart=${weekStart} on Aug ${day} was ${daysStale} days stale`);
    }
  }
});

/* ---------- opening the dial ---------- */

test("dialUrlSuffix ignores anything that isn't a hash we recognise", () => {
  // chrome.action.onClicked hands its listener the Tab object. Appending that
  // to the URL produced "dial.html[object Object]", which fails to load —
  // every toolbar click was broken by it.
  assert.equal(dialUrlSuffix({ id: 7, url: "chrome://newtab" }), "");
  assert.equal(dialUrlSuffix(undefined), "");
  assert.equal(dialUrlSuffix(null), "");
  assert.equal(dialUrlSuffix(42), "");
  assert.equal(dialUrlSuffix("#nonsense"), "", "an unknown hash is not passed through either");
  assert.equal(dialUrlSuffix("#history"), "#history");
});
