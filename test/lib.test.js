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
  buildCsv,
  buildInsight,
  computeRuns,
  computeStats,
  computeStreak,
  dateKey,
  dayHasEntries,
  fillRange,
  fmtClock,
  fmtDuration,
  fmtHM,
  csvCell,
  goalProgress,
  isValidTime,
  mergeDayMaps,
  mostRecentWeekStart,
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
  weekPerCatMinutes,
  weeklyRecap,
  weeklyRecapMessage,
  weightLabel,
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
  assert.deepEqual(normalizeDay(good), good);
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
  assert.deepEqual(result.data.get("2026-08-26"), { slots: paint(blank(), 9, 11, 0), reflection: "earlier, with a comma" });
  assert.deepEqual(result.data.get("2026-08-27"), { slots: paint(blank(), 14, 15, 1), reflection: "later day" });
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
  assert.deepEqual(result.data.days.get("2026-08-26"), { slots: paint(blank(), 9, 10, 0), reflection: "note" });
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
  assert.equal(weeklyRecapMessage(weeklyRecap(new Map(), cats, new Date(2026, 7, 24))), "No time logged last week.");
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
