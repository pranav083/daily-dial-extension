/**
 * Pure logic for the History view — no DOM, no chrome.* APIs.
 *
 * Mirrors the split in lib.js: everything here is a function from plain data
 * (the `days` Map, `categories`) to plain data, so it can be unit tested
 * under node. Rendering lives in history.js.
 */

import { SLOT_MIN, computeStats, dateKey, dayHasContent, dayHasEntries, mostRecentWeekStart } from "./lib.js";

/** Number of days in a local-time month (month is 0-indexed, matching Date). */
export const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

/**
 * One heatmap cell's worth of stats for a single day. `logged` is the
 * heatmap's load-bearing distinction: a day with `logged: false` must read
 * as visibly absent, never as a bad score of `null`.
 * `logged` means time was painted; `written` means the day carries notes,
 * intentions or a reflection but no painted time. They are mutually
 * exclusive, and a cell that is neither is genuinely empty.
 * @typedef {{key:string, date:Date, day:number, inMonth:boolean, logged:boolean,
 *   written:boolean, score:number|null, trackedMin:number, productivePct:number,\n *   topCat:number|null}} DayCell
 */

/**
 * Calendar grid for one month: full weeks (7 cells) starting on `weekStart`,
 * padded with adjacent-month days so every row is complete — the same shape
 * a `<table>` calendar needs. Padding cells carry real stats too (so, e.g.,
 * a Sunday-start grid still shows Saturday's score truthfully) but are
 * flagged `inMonth: false` so the view can dim them.
 *
 * @param {number} year
 * @param {number} month 0-indexed, matching Date
 * @param {Map<string, {slots:number[], reflection:string}>} days
 * @param {Array} categories
 * @param {number} [weekStart] 0=Sunday, 1=Monday
 * @returns {DayCell[][]} weeks, each an array of 7 DayCell
 */
/** Which category a day held most of, or null if it held none. */
function topCategoryOf(perCat) {
  let best = -1;
  perCat.forEach((slots, i) => {
    if (slots > 0 && (best === -1 || slots > perCat[best])) best = i;
  });
  return best === -1 ? null : best;
}

export function buildMonthGrid(year, month, days, categories, weekStart = 0) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() - weekStart + 7) % 7;

  const cells = [];
  const cursor = new Date(year, month, 1 - startOffset);
  do {
    const key = dateKey(cursor);
    const day = days.get(key);
    const logged = dayHasEntries(day);
    // A day can hold notes, intentions or a reflection without any painted
    // time — an imported journal is entirely made of those. Without this the
    // calendar showed months of writing as blank, which reads as "I did
    // nothing here" about days the user demonstrably wrote up.
    const written = !logged && dayHasContent(day);
    const stats = logged ? computeStats(day.slots, categories) : null;

    cells.push({
      key,
      date: new Date(cursor),
      day: cursor.getDate(),
      inMonth: cursor.getMonth() === month,
      logged,
      written,
      score: stats ? stats.score : null,
      trackedMin: stats ? stats.trackedMin : 0,
      productivePct: stats ? stats.productivePct : 0,
      // The category the day held most of, so a month can be coloured by what
      // it was actually spent on rather than only by how it scored. Null when
      // nothing was painted; ties go to the earlier slot, which keeps the
      // colouring stable instead of flickering between two equal halves.
      topCat: stats ? topCategoryOf(stats.perCat) : null,
    });
    cursor.setDate(cursor.getDate() + 1);
    // Keep going past month-end until the last week is full, same as a
    // paper calendar's trailing days.
  } while (cursor.getMonth() === month || cells.length % 7 !== 0);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Roll-up stats for one calendar month. Averages (`avgScore`,
 * `avgProductivePct`) are over logged days only — an unlogged day doesn't
 * drag the average toward zero, it's simply not counted, matching how a
 * single day's `score` is `null` rather than 0 when nothing was logged.
 *
 * `currentStreak`/`longestStreak` are scoped to *this month only* (they
 * don't borrow days from the month before or after) — `computeStreak` in
 * lib.js is what answers the whole-history question.
 *
 * @returns {{daysLogged:number, totalTrackedMin:number, avgScore:number|null,
 *   avgProductivePct:number|null, bestDay:{key:string,score:number}|null,
 *   currentStreak:number, longestStreak:number}}
 */
export function monthSummary(year, month, days, categories, now = new Date()) {
  const totalDays = daysInMonth(year, month);
  // For the month in progress, the run that matters is the one ending today,
  // not the one ending on the 31st — days that haven't happened yet are not
  // missed days. Walking to the end of the calendar month made "current"
  // read 0 for virtually every in-progress month, while the streak card on
  // the Day view, two clicks away, showed the real number.
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
  const lastDay = isCurrentMonth ? Math.min(totalDays, now.getDate()) : totalDays;

  let daysLogged = 0;
  let totalTrackedMin = 0;
  let scoreSum = 0;
  let pctSum = 0;
  let scoredDays = 0;
  let bestDay = null;
  let running = 0;
  let currentStreak = 0;
  let longestStreak = 0;

  for (let d = 1; d <= lastDay; d++) {
    const key = dateKey(new Date(year, month, d));
    const day = days.get(key);
    const logged = dayHasEntries(day);

    if (logged) {
      daysLogged++;
      running++;
      const stats = computeStats(day.slots, categories);
      totalTrackedMin += stats.trackedMin;
      if (stats.score !== null) {
        scoreSum += stats.score;
        pctSum += stats.productivePct;
        scoredDays++;
        if (bestDay === null || stats.score > bestDay.score) bestDay = { key, score: stats.score };
      }
    } else if (!(isCurrentMonth && d === now.getDate())) {
      // Today not logged *yet* doesn't break the run, matching computeStreak.
      running = 0;
    }
    longestStreak = Math.max(longestStreak, running);
    currentStreak = running; // holds the run ending on the last day processed
  }

  return {
    daysLogged,
    totalTrackedMin,
    avgScore: scoredDays ? Math.round(scoreSum / scoredDays) : null,
    avgProductivePct: scoredDays ? Math.round(pctSum / scoredDays) : null,
    bestDay,
    currentStreak,
    longestStreak,
  };
}

/**
 * Minutes per category, bucketed by calendar week within the visible month.
 * Reuses `buildMonthGrid` so week boundaries always match the heatmap rows;
 * out-of-month padding days are excluded from the sums.
 *
 * @returns {{weekStartKey:string, perCatMin:number[]}[]}
 */
export function categoryTrendsByWeek(year, month, days, categories, weekStart = 0) {
  const weeks = buildMonthGrid(year, month, days, categories, weekStart);
  return weeks.map((week) => {
    const perCatMin = categories.map(() => 0);
    for (const cell of week) {
      if (!cell.inMonth) continue;
      const day = days.get(cell.key);
      if (!dayHasEntries(day)) continue;
      const stats = computeStats(day.slots, categories);
      stats.perCat.forEach((n, i) => (perCatMin[i] += n * SLOT_MIN));
    }
    return { weekStartKey: week[0].key, perCatMin };
  });
}

/**
 * "Is this going up or down": compares a category's first vs. last week in
 * the visible range. Deliberately endpoint-to-endpoint rather than a
 * regression — with 4-5 points a slope is noise, but "more than it used to
 * be" is a fact.
 * @returns {"up"|"down"|"flat"}
 */
export function categoryTrendDirection(weeks, catIndex) {
  if (weeks.length === 0) return "flat";
  const first = weeks[0].perCatMin[catIndex] ?? 0;
  const last = weeks[weeks.length - 1].perCatMin[catIndex] ?? 0;
  return deltaDirection(last - first);
}

/**
 * Aggregate stats for the 7 days starting `weekStartDate` (local midnight).
 * Shared shape for the current/previous halves of `weekOverWeek`.
 * @returns {{trackedMin:number, daysLogged:number, avgScore:number|null, avgProductivePct:number|null}}
 */
export function weekStats(days, categories, weekStartDate) {
  let trackedMin = 0;
  let daysLogged = 0;
  let scoreSum = 0;
  let pctSum = 0;
  let scoredDays = 0;

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() + i);
    const day = days.get(dateKey(d));
    if (!dayHasEntries(day)) continue;

    daysLogged++;
    const stats = computeStats(day.slots, categories);
    trackedMin += stats.trackedMin;
    if (stats.score !== null) {
      scoreSum += stats.score;
      pctSum += stats.productivePct;
      scoredDays++;
    }
  }

  return {
    trackedMin,
    daysLogged,
    avgScore: scoredDays ? Math.round(scoreSum / scoredDays) : null,
    avgProductivePct: scoredDays ? Math.round(pctSum / scoredDays) : null,
  };
}

/**
 * This week vs. last week, both anchored to `weekStart` via
 * `mostRecentWeekStart`, so week boundaries here line up with the heatmap
 * rows and the weekly goals.
 *
 * The weekly recap deliberately uses `recapWeekStart` instead: it reports a
 * week that has *finished*, whereas "this week" here is the one in progress.
 *
 * @returns {{currentStart:string, previousStart:string,
 *   current:ReturnType<typeof weekStats>, previous:ReturnType<typeof weekStats>,
 *   deltas:{trackedMin:number, avgScore:number|null, avgProductivePct:number|null}}}
 */
export function weekOverWeek(days, categories, weekStart, now = new Date()) {
  const currentStart = mostRecentWeekStart(weekStart, now);
  const previousStart = new Date(currentStart);
  previousStart.setDate(previousStart.getDate() - 7);

  const current = weekStats(days, categories, currentStart);
  const previous = weekStats(days, categories, previousStart);

  return {
    currentStart: dateKey(currentStart),
    previousStart: dateKey(previousStart),
    current,
    previous,
    deltas: {
      // `null` when there is no previous week to compare against, matching
      // how the score and percent rows already behave. Subtracting from an
      // absent week produced a confident green "▲ 5h" in someone's first
      // week — growth measured against nothing.
      trackedMin: previous.daysLogged > 0 ? current.trackedMin - previous.trackedMin : null,
      avgScore:
        current.avgScore !== null && previous.avgScore !== null ? current.avgScore - previous.avgScore : null,
      avgProductivePct:
        current.avgProductivePct !== null && previous.avgProductivePct !== null
          ? current.avgProductivePct - previous.avgProductivePct
          : null,
    },
  };
}

/**
 * Direction of a delta, for pairing with a ▲/▼ glyph so comparisons don't
 * rely on colour alone. `null`/`undefined` (nothing to compare against)
 * reads as "flat" rather than throwing.
 * @returns {"up"|"down"|"flat"}
 */
export function deltaDirection(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "flat";
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}

/** Snippet of `text` centred on the first match of `query`, so a search
 *  result reads like a search result rather than a wall of reflection text. */
function buildSnippet(text, matchIndex, matchLen, radius = 40) {
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + matchLen + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end).trim() + suffix;
}

/**
 * Days whose reflection text contains `query` (case-insensitive substring),
 * most recent first.
 * @returns {{key:string, snippet:string}[]}
 */
export function searchNotes(days, query) {
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!q) return [];

  const out = [];
  for (const [key, day] of days) {
    const text = day?.reflection ?? "";
    if (!text) continue;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) continue;
    out.push({ key, snippet: buildSnippet(text, idx, q.length) });
  }
  return out.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}
