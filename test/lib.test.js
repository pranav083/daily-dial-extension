import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CATEGORIES,
  SLOTS,
  UNTRACKED,
  buildCsv,
  buildInsight,
  computeRuns,
  computeStats,
  dateKey,
  fillRange,
  fmtDuration,
  fmtHM,
  csvCell,
  isValidTime,
  nextOccurrence,
  normalizeCategories,
  normalizeDay,
  normalizeSettings,
  runAt,
  scoreBucket,
  slotFromAngle,
  angleAt,
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

test("normalizeSettings validates reminder times", () => {
  assert.deepEqual(normalizeSettings(null), { remindersOn: false, times: ["13:00", "21:00"] });
  assert.deepEqual(normalizeSettings({ remindersOn: true, times: ["07:30", "19:45"] }).times, ["07:30", "19:45"]);
  assert.deepEqual(normalizeSettings({ times: ["25:00", "19:45"] }).times, ["13:00", "21:00"], "bad hour rejected");
  assert.equal(normalizeSettings({ remindersOn: "yes" }).remindersOn, false, "only true enables");
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
