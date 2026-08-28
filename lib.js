/**
 * Pure logic for Daily Dial — no DOM, no chrome.* APIs.
 *
 * Everything here is a plain function over plain data so it can be unit tested
 * under node. Anything that touches the page or extension APIs lives in
 * dial.js / background.js.
 */

/** A day is 96 slots of 15 minutes. */
export const SLOTS = 96;
export const SLOT_MIN = 15;
export const UNTRACKED = -1;
export const DEG_PER_SLOT = 360 / SLOTS;

/** Dial geometry, in the SVG's 460×460 user space. */
export const CX = 230;
export const CY = 230;
export const R_OUT = 190;
export const R_IN = 118;

export const DAY_PREFIX = "day:";
export const CATEGORIES_KEY = "categories";
export const SETTINGS_KEY = "settings";
export const SCHEMA_VERSION_KEY = "schemaVersion";

/** Bumped when the shape of a backup file changes in a way older code can't
 *  read. Stored alongside the data and stamped into every export. */
export const SCHEMA_VERSION = 1;

// `aliases` are extra words the typed-entry parser matches against a
// category besides its own name — e.g. "leetcode" or "mock interview" both
// resolving to Applications — without needing a 7th category slot.
export const DEFAULT_CATEGORIES = [
  { id: 0, name: "Deep Work", weight: 1, enabled: true, cls: "cat-0", aliases: [] },
  { id: 1, name: "Applications", weight: 1, enabled: true, cls: "cat-1", aliases: [] },
  { id: 2, name: "Study", weight: 1, enabled: true, cls: "cat-2", aliases: [] },
  { id: 3, name: "Admin", weight: 0, enabled: true, cls: "cat-3", aliases: [] },
  { id: 4, name: "Break", weight: 0, enabled: true, cls: "cat-4", aliases: [] },
  { id: 5, name: "Distraction", weight: -1, enabled: true, cls: "cat-5", aliases: [] },
];

export const DEFAULT_SETTINGS = {
  remindersOn: false,
  times: ["13:00", "21:00"],
  theme: "system", // "system" | "light" | "dark"
  timeFormat: "24h", // "24h" | "12h"
  dialMode: "24h", // "24h" | "ampm" | "ampm-toggle" — one 24-hour ring, two 12-hour
  // rings side by side, or one 12-hour ring with a switch between AM and PM
  weekStart: 0, // 0 = Sunday, 1 = Monday
  goals: {}, // { [categoryId]: targetMinutesPerDay }
  weeklyRecapOn: false,
  weeklyRecapDay: 0, // 0 = Sunday .. 6 = Saturday
  weeklyRecapTime: "20:00",
  lastExportAt: null, // epoch ms, or null if never exported
  weeklyGoals: {}, // { [categoryId]: targetMinutesPerWeek } — separate from goals (per-day)
  // Waking hours: the "still unlogged" nag in the day's insight only counts
  // untracked time in this window, so overnight sleep isn't mistaken for a
  // gap in logging.
  dayWindow: { start: "07:00", end: "23:00" },
};
export const WEIGHT_GLYPH = { 1: "+", 0: "·", "-1": "–" };

/* ---------- dates & formatting ---------- */

export const pad2 = (n) => String(n).padStart(2, "0");

/** Local-time YYYY-MM-DD. Deliberately not toISOString(), which is UTC and
 *  would put late-evening entries on the wrong day. */
export const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const sameDay = (a, b) => dateKey(a) === dateKey(b);

/** "HH:MM" for a slot boundary; slot 96 reads as 00:00 (midnight, end of day). */
export function fmtHM(slotIdx) {
  const total = slotIdx * SLOT_MIN;
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
}

/** "HH:MM" (24h) or "H:MMam/pm" (12h) for a slot boundary, per the user's format setting. */
export function fmtClock(slotIdx, format = "24h") {
  if (format !== "12h") return fmtHM(slotIdx);
  const total = slotIdx * SLOT_MIN;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)}${suffix}`;
}

export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/* ---------- stored shapes ---------- */

export const emptyDay = () => ({ slots: new Array(SLOTS).fill(UNTRACKED), reflection: "" });

/** Storage is user-editable and survives version changes, so never trust it. */
export function normalizeDay(raw) {
  if (!raw || typeof raw !== "object") return emptyDay();
  const slots =
    Array.isArray(raw.slots) && raw.slots.length === SLOTS
      ? raw.slots.map((v) => (Number.isInteger(v) ? v : UNTRACKED))
      : new Array(SLOTS).fill(UNTRACKED);
  return { slots, reflection: typeof raw.reflection === "string" ? raw.reflection : "" };
}

/** A day "counts" for streaks/nudges/bests once at least one slot is painted. */
export const dayHasEntries = (day) => !!day && Array.isArray(day.slots) && day.slots.some((v) => v !== UNTRACKED);

const MAX_ALIASES = 8;

/** Extra match words for a category, beyond its own name — lowercased,
 *  trimmed, deduped, capped in count and length so a stray paste can't
 *  balloon storage. */
export function normalizeAliases(saved) {
  if (!Array.isArray(saved)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of saved) {
    if (typeof raw !== "string") continue;
    const alias = raw.trim().toLowerCase().slice(0, 24);
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    out.push(alias);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

/** Categories are six fixed colour slots; only name/weight/enabled/aliases
 *  are editable. Days store the slot index, so renaming never rewrites
 *  history. */
export function normalizeCategories(saved) {
  const defaults = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  if (!Array.isArray(saved)) return defaults;
  return defaults.map((base, i) => {
    const s = saved[i];
    if (!s || typeof s !== "object") return base;
    const name = typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 24) : base.name;
    const weight = s.weight === 1 || s.weight === 0 || s.weight === -1 ? s.weight : base.weight;
    return { id: base.id, cls: base.cls, name, weight, enabled: s.enabled !== false, aliases: normalizeAliases(s.aliases) };
  });
}

const THEMES = ["system", "light", "dark"];
const DIAL_MODES = ["24h", "ampm", "ampm-toggle"];

/** Goals are keyed by category id (0–5); only positive integer minute targets survive. */
function normalizeGoals(saved) {
  const out = {};
  if (!saved || typeof saved !== "object") return out;
  for (const [k, v] of Object.entries(saved)) {
    const id = Number(k);
    if (!Number.isInteger(id) || id < 0 || id >= DEFAULT_CATEGORIES.length) continue;
    if (Number.isFinite(v) && v > 0) out[id] = Math.round(v);
  }
  return out;
}

export function normalizeSettings(saved) {
  const times =
    Array.isArray(saved?.times) && saved.times.length === 2 && saved.times.every(isValidTime)
      ? [...saved.times]
      : [...DEFAULT_SETTINGS.times];
  const theme = THEMES.includes(saved?.theme) ? saved.theme : DEFAULT_SETTINGS.theme;
  const timeFormat = saved?.timeFormat === "12h" ? "12h" : "24h";
  const dialMode = DIAL_MODES.includes(saved?.dialMode) ? saved.dialMode : DEFAULT_SETTINGS.dialMode;
  const weekStart = saved?.weekStart === 1 ? 1 : 0;
  const weeklyRecapDay =
    Number.isInteger(saved?.weeklyRecapDay) && saved.weeklyRecapDay >= 0 && saved.weeklyRecapDay <= 6
      ? saved.weeklyRecapDay
      : DEFAULT_SETTINGS.weeklyRecapDay;
  const weeklyRecapTime = isValidTime(saved?.weeklyRecapTime) ? saved.weeklyRecapTime : DEFAULT_SETTINGS.weeklyRecapTime;
  const lastExportAt = Number.isFinite(saved?.lastExportAt) ? saved.lastExportAt : null;
  const dayWindow = {
    start: isValidTime(saved?.dayWindow?.start) ? saved.dayWindow.start : DEFAULT_SETTINGS.dayWindow.start,
    end: isValidTime(saved?.dayWindow?.end) ? saved.dayWindow.end : DEFAULT_SETTINGS.dayWindow.end,
  };

  return {
    remindersOn: saved?.remindersOn === true,
    times,
    theme,
    timeFormat,
    dialMode,
    weekStart,
    goals: normalizeGoals(saved?.goals),
    weeklyGoals: normalizeGoals(saved?.weeklyGoals),
    weeklyRecapOn: saved?.weeklyRecapOn === true,
    weeklyRecapDay,
    weeklyRecapTime,
    lastExportAt,
    dayWindow,
  };
}

export const isValidTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** "07:00" → 420. Assumes an already-validated "HH:MM" string. */
export const hmToMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/* ---------- geometry ---------- */

/** Polar → cartesian with 0° at midnight (top), running clockwise. */
export function polar(r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.sin(rad), y: CY - r * Math.cos(rad) };
}

/** SVG path for an annular sector between two angles. */
export function wedgePath(rInner, rOuter, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const p1 = polar(rOuter, a0);
  const p2 = polar(rOuter, a1);
  const p3 = polar(rInner, a1);
  const p4 = polar(rInner, a0);
  return (
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}` +
    ` A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}` +
    ` L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}` +
    ` A ${rInner} ${rInner} 0 ${large} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)} Z`
  );
}

/** Angle (deg, 0 = midnight) and distance from centre for a point in SVG space. */
export function angleAt(x, y) {
  const dx = x - CX;
  const dy = y - CY;
  const raw = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { angle: (((raw + 90) % 360) + 360) % 360, dist: Math.hypot(dx, dy) };
}

/** `slotsInView` lets the same math drive a 48-slot half-dial (AM/PM mode)
 *  as well as the default 96-slot full dial. */
export const slotFromAngle = (angle, slotsInView = SLOTS) =>
  Math.min(slotsInView - 1, Math.floor(angle / (360 / slotsInView)));

/** Collapse consecutive same-category slots into runs, one wedge per run.
 *  Operates on whatever array it's given — the full day, or a 48-slot half —
 *  so the caller decides what window it represents. */
export function computeRuns(slots) {
  const n = slots.length;
  const runs = [];
  let i = 0;
  while (i < n) {
    if (slots[i] === UNTRACKED) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && slots[j] === slots[i]) j++;
    runs.push({ cat: slots[i], start: i, end: j });
    i = j;
  }
  return runs;
}

/** The run covering a slot, or null when it's untracked. */
export function runAt(slots, idx) {
  if (slots[idx] === UNTRACKED) return null;
  const cat = slots[idx];
  let s = idx;
  let e = idx;
  while (s > 0 && slots[s - 1] === cat) s--;
  while (e < slots.length - 1 && slots[e + 1] === cat) e++;
  return { cat, start: s, end: e + 1 };
}

/** Paint from→to the short way round, so a drag across midnight (or across a
 *  half-dial's own 12-hour wrap point) fills the stretch you dragged over
 *  rather than the long way round. Wraps within `slots.length`, so a 48-slot
 *  half fed in stays confined to its own half. Returns a new array; the
 *  caller decides whether to keep it. */
export function fillRange(slots, from, to, cat) {
  const n = slots.length;
  const next = [...slots];
  const forward = (to - from + n) % n;
  const backward = n - forward;
  if (forward <= backward) {
    for (let i = 0; i <= forward; i++) next[(from + i) % n] = cat;
  } else {
    for (let i = 0; i <= backward; i++) next[((from - i) % n + n) % n] = cat;
  }
  return next;
}

/* ---------- stats ---------- */

/**
 * @param {{startMin:number, endMin:number}|null} [dayWindow] Restricts
 *   `untrackedInWindowMin` to this range (minutes since midnight) — the
 *   waking-hours window the insight nags within, so overnight sleep doesn't
 *   count as "still unlogged". Omit for the whole day.
 * @returns {{perCat:number[], untrackedSlots:number, untrackedInWindowMin:number,
 *   trackedMin:number, productiveMin:number, distractionMin:number,
 *   productivePct:number, longestFocusMin:number, score:number|null}}
 *   `score` is null when nothing is logged — distinct from a score of 0.
 */
export function computeStats(slots, categories, dayWindow = null) {
  const perCat = categories.map(() => 0);
  let untrackedSlots = 0;

  for (const v of slots) {
    if (v === UNTRACKED) untrackedSlots++;
    else if (perCat[v] !== undefined) perCat[v]++;
  }

  let untrackedInWindowMin;
  if (dayWindow) {
    const startSlot = Math.max(0, Math.round(dayWindow.startMin / SLOT_MIN));
    const endSlot = Math.min(SLOTS, Math.round(dayWindow.endMin / SLOT_MIN));
    let n = 0;
    for (let i = startSlot; i < endSlot; i++) if (slots[i] === UNTRACKED) n++;
    untrackedInWindowMin = n * SLOT_MIN;
  } else {
    untrackedInWindowMin = untrackedSlots * SLOT_MIN;
  }

  const trackedMin = (SLOTS - untrackedSlots) * SLOT_MIN;
  let productiveMin = 0;
  let distractionMin = 0;
  categories.forEach((c, i) => {
    if (c.weight === 1) productiveMin += perCat[i] * SLOT_MIN;
    else if (c.weight === -1) distractionMin += perCat[i] * SLOT_MIN;
  });

  // Longest unbroken run of productive time, across category changes.
  let longestFocusMin = 0;
  let current = 0;
  for (const v of slots) {
    if (v !== UNTRACKED && categories[v]?.weight === 1) {
      current += SLOT_MIN;
      longestFocusMin = Math.max(longestFocusMin, current);
    } else {
      current = 0;
    }
  }

  return {
    perCat,
    untrackedSlots,
    untrackedInWindowMin,
    trackedMin,
    productiveMin,
    distractionMin,
    productivePct: trackedMin > 0 ? Math.round((productiveMin / trackedMin) * 100) : 0,
    longestFocusMin,
    score: trackedMin > 0 ? Math.round(((productiveMin - distractionMin) / trackedMin) * 100) : null,
  };
}

export function scoreBucket(score) {
  if (score === null) return { label: "No data yet", tone: "muted" };
  if (score >= 40) return { label: "Locked in", tone: "good" };
  if (score >= 10) return { label: "Solid", tone: "good" };
  if (score >= -15) return { label: "Mixed bag", tone: "warning" };
  return { label: "Off track", tone: "critical" };
}

export const toneVar = (tone) =>
  tone === "good"
    ? "--status-good"
    : tone === "warning"
      ? "--status-warning"
      : tone === "critical"
        ? "--status-critical"
        : "--ink-muted";

/**
 * The day in a sentence or two. Returns HTML — the only markup is <b>, and
 * every interpolated value is a number or a category name that the caller
 * escapes before rendering.
 */
export function buildInsight(stats, categories) {
  if (stats.trackedMin === 0) {
    return "Nothing logged yet. Pick a category and drag around the ring to paint your first block.";
  }

  const ranked = categories
    .map((c, i) => ({ cat: c, min: stats.perCat[i] * SLOT_MIN }))
    .filter((r) => r.min > 0)
    .sort((a, b) => b.min - a.min);

  const parts = [`<b>${stats.productivePct}%</b> of your tracked time was productive.`];

  if (stats.distractionMin > 0 && stats.distractionMin >= stats.productiveMin) {
    parts.push(
      `<b>${fmtDuration(stats.distractionMin)}</b> went to time you marked as a drain — more than you spent moving forward.`
    );
  } else if (ranked[0]) {
    parts.push(`<b>${ranked[0].cat.name}</b> led the day at <b>${fmtDuration(ranked[0].min)}</b>.`);
  }

  if (stats.productiveMin >= 60 && stats.longestFocusMin < 45) {
    parts.push(
      `It came in short pieces though — your longest unbroken stretch was only ${fmtDuration(stats.longestFocusMin)}.`
    );
  } else if (stats.longestFocusMin >= 90) {
    parts.push(`Your longest unbroken stretch was <b>${fmtDuration(stats.longestFocusMin)}</b>.`);
  }

  // Restricted to the caller's waking-hours window (via computeStats'
  // dayWindow), so sleeping hours don't inflate this into a false nag.
  if (stats.untrackedInWindowMin >= 6 * 60) {
    parts.push(`${fmtDuration(stats.untrackedInWindowMin)} is still unlogged.`);
  }

  return parts.join(" ");
}

/* ---------- streaks ---------- */

/**
 * Consecutive-day logging streak, with a once-per-rolling-7-days freeze so a
 * single missed day doesn't zero out weeks of history — unforgiving streaks
 * make people quit for good after the first slip.
 *
 * Walks every calendar day from the first logged day through `now`. A missed
 * day consumes a freeze if one hasn't been used in the trailing 7 days
 * *as of that missed day*; otherwise the streak breaks there. Today not yet
 * being logged never breaks anything — it's simply not counted yet.
 *
 * @param {Map<string, {slots:number[]}>} days
 * @param {Date} now
 * @param {{freezesPerWeek?: number}} [opts]
 * @returns {{current:number, longest:number, freezesUsedThisWeek:number, isAtRisk:boolean}}
 */
export function computeStreak(days, now = new Date(), { freezesPerWeek = 1 } = {}) {
  const loggedKeys = [...days.entries()].filter(([, day]) => dayHasEntries(day)).map(([key]) => key);

  if (loggedKeys.length === 0) {
    return { current: 0, longest: 0, freezesUsedThisWeek: 0, isAtRisk: false };
  }

  const loggedSet = new Set(loggedKeys);
  const todayKey = dateKey(now);
  const todayLogged = loggedSet.has(todayKey);

  const cursor = new Date([...loggedKeys].sort()[0] + "T00:00:00");
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);

  let streak = 0;
  let longest = 0;
  let dayIndex = 0;
  const freezeIndices = []; // day indices (relative to the walk) that consumed a freeze

  while (cursor.getTime() <= end.getTime()) {
    const key = dateKey(cursor);
    if (loggedSet.has(key)) {
      streak++;
    } else if (key !== todayKey) {
      // Drop freezes that fall outside the 7 days trailing this missed day.
      while (freezeIndices.length && dayIndex - freezeIndices[0] >= 7) freezeIndices.shift();
      if (freezeIndices.length < freezesPerWeek) {
        freezeIndices.push(dayIndex);
        // Streak survives the gap but doesn't grow on the missed day itself.
      } else {
        longest = Math.max(longest, streak);
        streak = 0;
      }
    }
    // Today not yet logged: neither increments nor resets — just not counted yet.
    longest = Math.max(longest, streak);
    cursor.setDate(cursor.getDate() + 1);
    dayIndex++;
  }

  while (freezeIndices.length && dayIndex - 1 - freezeIndices[0] >= 7) freezeIndices.shift();

  return {
    current: streak,
    longest,
    freezesUsedThisWeek: freezeIndices.length,
    isAtRisk: !todayLogged && now.getHours() >= 20,
  };
}

/* ---------- weekly recap ---------- */

/**
 * Summary of a 7-day window starting `weekStartDate`, for the optional weekly
 * recap notification. `streak` is evaluated as of the end of that window so
 * the function stays pure (no implicit "current time").
 */
export function weeklyRecap(days, categories, weekStartDate) {
  const start = new Date(weekStartDate);
  start.setHours(0, 0, 0, 0);

  let trackedMin = 0;
  let productiveMin = 0;
  const perCatMin = categories.map(() => 0);
  let bestDay = null;

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = dateKey(d);
    const slots = days.get(key)?.slots ?? new Array(SLOTS).fill(UNTRACKED);
    const stats = computeStats(slots, categories);

    trackedMin += stats.trackedMin;
    productiveMin += stats.productiveMin;
    stats.perCat.forEach((n, idx) => (perCatMin[idx] += n * SLOT_MIN));
    if (stats.score !== null && (bestDay === null || stats.score > bestDay.score)) {
      bestDay = { key, score: stats.score };
    }
  }

  const topIdx = perCatMin.reduce((best, m, i) => (m > perCatMin[best] ? i : best), 0);
  const topCategory = perCatMin[topIdx] > 0 ? { name: categories[topIdx].name, min: perCatMin[topIdx] } : null;

  const weekEnd = new Date(start);
  weekEnd.setDate(weekEnd.getDate() + 7);

  return {
    trackedMin,
    productivePct: trackedMin > 0 ? Math.round((productiveMin / trackedMin) * 100) : 0,
    topCategory,
    bestDay,
    streak: computeStreak(days, weekEnd),
  };
}

/** Short line for the notification itself; the dial shows the rest. */
export function weeklyRecapMessage(recap) {
  if (recap.trackedMin === 0) return "No time logged last week.";
  const parts = [`${fmtDuration(recap.trackedMin)} tracked, ${recap.productivePct}% productive.`];
  if (recap.topCategory) parts.push(`Most of it went to ${recap.topCategory.name}.`);
  return parts.join(" ");
}

/* ---------- goals ---------- */

/**
 * Takes plain per-category minutes rather than a computeStats() result, so
 * the same function drives both a single day's goals (pass
 * `stats.perCat.map(n => n * SLOT_MIN)`) and a week's (pass minutes summed
 * across 7 days — see `weekPerCatMinutes`).
 * @param {number[]} perCatMin minutes per category index
 * @param {Record<number, number>} goals category id → target minutes
 * @returns {Array<{categoryId:number, name:string, cls:string, targetMin:number,
 *   actualMin:number, pct:number, met:boolean}>} one row per category with an active goal
 */
export function goalProgress(perCatMin, goals, categories) {
  const rows = [];
  categories.forEach((c, i) => {
    const target = goals?.[c.id];
    if (!c.enabled || !Number.isFinite(target) || target <= 0) return;
    const actualMin = perCatMin[i];
    rows.push({
      categoryId: c.id,
      name: c.name,
      cls: c.cls,
      targetMin: target,
      actualMin,
      pct: Math.min(100, Math.round((actualMin / target) * 100)),
      met: actualMin >= target,
    });
  });
  return rows;
}

/** Per-category minutes summed across the 7 days starting weekStartDate —
 *  the input weekly goalProgress() checks a week's total against. */
export function weekPerCatMinutes(days, categories, weekStartDate) {
  const start = new Date(weekStartDate);
  start.setHours(0, 0, 0, 0);
  const perCatMin = categories.map(() => 0);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const slots = days.get(dateKey(d))?.slots ?? new Array(SLOTS).fill(UNTRACKED);
    computeStats(slots, categories).perCat.forEach((n, idx) => (perCatMin[idx] += n * SLOT_MIN));
  }
  return perCatMin;
}

/* ---------- personal bests ---------- */

/**
 * @returns {{longestStreak:number, bestScore:{key:string,score:number}|null,
 *   mostProductiveDay:{key:string,productiveMin:number}|null}}
 */
export function personalBests(days, categories, now = new Date()) {
  let bestScore = null;
  let mostProductiveDay = null;

  for (const [key, day] of days) {
    const stats = computeStats(day.slots, categories);
    if (stats.score !== null && (bestScore === null || stats.score > bestScore.score)) {
      bestScore = { key, score: stats.score };
    }
    if (stats.productiveMin > 0 && (mostProductiveDay === null || stats.productiveMin > mostProductiveDay.productiveMin)) {
      mostProductiveDay = { key, productiveMin: stats.productiveMin };
    }
  }

  return { longestStreak: computeStreak(days, now).longest, bestScore, mostProductiveDay };
}

/* ---------- typed entry ---------- */

/** "9", "9:30", "9am", "9:30pm", "13:30" → minutes since midnight, or null. */
function parseClockToken(raw) {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (min > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = meridiem === "am" ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
  } else {
    if (hour === 24 && min === 0) return 24 * 60; // "24:00" — end-of-day boundary
    if (hour > 23) return null;
  }
  return hour * 60 + min;
}

/**
 * Forgiving one-line time entry: "9-11 deep work", "13:30-15 applications",
 * "9pm-11pm study". Accepts "-" or "to" as the separator, 24h or 12h clock
 * (12h only when am/pm is present), and case-insensitive partial category
 * matching. Never touches state — the caller applies the result.
 *
 * @returns {{ok:true, startSlot:number, endSlot:number, categoryId:number} | {ok:false, error:string}}
 */
export function parseTimeEntry(text, categories) {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: 'Try something like "9-11 deep work".' };
  }

  const m = text
    .trim()
    .match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(.+)$/i);
  if (!m) return { ok: false, error: 'Couldn\'t read that. Try "9-11 deep work" or "9pm-11pm study".' };

  const [, startTok, endTok, catText] = m;
  const startMin = parseClockToken(startTok);
  const endMin = parseClockToken(endTok);
  if (startMin === null || endMin === null) {
    return { ok: false, error: "Couldn't read the time — use 24h (13:30) or 12h (1:30pm)." };
  }

  const startSlot = Math.round(startMin / SLOT_MIN);
  let endSlot = Math.round(endMin / SLOT_MIN);
  if (endSlot <= startSlot) {
    const wrapped = endSlot + SLOTS;
    // Allow a short wrap past midnight (an evening session); a long "wrap"
    // is almost always a typo'd inverted range, so reject it instead.
    if (wrapped - startSlot <= SLOTS / 2) endSlot = wrapped;
    else return { ok: false, error: "End time is before the start time." };
  }

  const wanted = catText.trim().toLowerCase();
  if (!wanted) return { ok: false, error: 'Add a category, like "9-11 deep work".' };

  // A category matches by its own name or by any of its aliases (personal
  // vocabulary a user has linked to it, e.g. "leetcode" → Applications).
  const labelsOf = (c) => [c.name.toLowerCase(), ...(c.aliases ?? [])];
  const enabled = categories.filter((c) => c.enabled);
  const exact = enabled.find((c) => labelsOf(c).includes(wanted));
  const matches = exact ? [exact] : enabled.filter((c) => labelsOf(c).some((label) => label.includes(wanted)));

  if (matches.length === 0) return { ok: false, error: `No category matches "${catText.trim()}".` };
  if (matches.length > 1) {
    return {
      ok: false,
      error: `"${catText.trim()}" matches ${matches.map((c) => c.name).join(", ")} — be more specific.`,
    };
  }

  return { ok: true, startSlot, endSlot, categoryId: matches[0].id };
}

/* ---------- CSV ---------- */

export function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const weightLabel = (weight) =>
  weight === 1 ? "productive" : weight === -1 ? "distraction" : "neutral";

/**
 * One row per painted block, shaped for a spreadsheet pivot.
 * @param {Map<string, {slots:number[], reflection:string}>} days
 * @returns {string|null} null when nothing is logged.
 */
export function buildCsv(days, categories) {
  const rows = [["Date", "Start", "End", "Duration (min)", "Category", "Weight", "Note"]];

  for (const key of [...days.keys()].sort()) {
    const day = days.get(key);
    for (const run of computeRuns(day.slots)) {
      const cat = categories[run.cat];
      if (!cat) continue;
      rows.push([
        key,
        fmtHM(run.start),
        fmtHM(run.end),
        (run.end - run.start) * SLOT_MIN,
        cat.name,
        weightLabel(cat.weight),
        day.reflection,
      ]);
    }
  }

  if (rows.length === 1) return null;
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

const CSV_HEADER = ["Date", "Start", "End", "Duration (min)", "Category", "Weight", "Note"];

/** RFC-4180-ish parse: quoted fields, "" escaping, embedded commas/newlines. */
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") continue;
    else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const hmToSlot = (hm) => {
  const [h, m] = hm.split(":").map(Number);
  return (h * 60 + m) / SLOT_MIN;
};

/**
 * Parses the exact shape `buildCsv` emits. Matches categories by exact name
 * against the caller's current category list — never trust the file.
 * @returns {{ok:true, data:Map<string,{slots:number[],reflection:string}>} | {ok:false, error:string}}
 */
export function parseCsv(text, categories) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "That file is empty." };

  const rows = parseCsvRows(text.replace(/^\uFEFF/, "")).filter((r) => !(r.length === 1 && r[0] === ""));
  if (rows.length === 0) return { ok: false, error: "That file is empty." };

  const header = rows[0].map((h) => h.trim());
  if (header.length !== CSV_HEADER.length || header.some((h, i) => h !== CSV_HEADER[i])) {
    return { ok: false, error: "That doesn't look like a Daily Dial CSV export." };
  }

  const days = new Map();
  for (let r = 1; r < rows.length; r++) {
    const [dateStr, startStr, endStr, , catName, , note] = rows[r];
    if (rows[r].length === 1 && !rows[r][0]) continue; // stray blank line

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr ?? "")) return { ok: false, error: `Row ${r + 1}: bad date "${dateStr}".` };
    if (!isValidTime(startStr)) return { ok: false, error: `Row ${r + 1}: bad start time "${startStr}".` };
    if (!isValidTime(endStr) && endStr !== "00:00") {
      return { ok: false, error: `Row ${r + 1}: bad end time "${endStr}".` };
    }

    const cat = categories.find((c) => c.name === catName);
    if (!cat) return { ok: false, error: `Row ${r + 1}: unknown category "${catName}".` };

    const startSlot = hmToSlot(startStr);
    const endSlot = endStr === "00:00" ? SLOTS : hmToSlot(endStr);
    if (endSlot <= startSlot) return { ok: false, error: `Row ${r + 1}: end is not after start.` };

    if (!days.has(dateStr)) days.set(dateStr, emptyDay());
    const day = days.get(dateStr);
    for (let i = startSlot; i < endSlot; i++) day.slots[i] = cat.id;
    if (note) day.reflection = note;
  }

  return { ok: true, data: days };
}

/* ---------- backup (import / export) ---------- */

/** Full-fidelity snapshot: every day, category, and setting. */
export function buildBackup(days, categories, settings, appVersion, now = new Date()) {
  const daysObj = {};
  for (const [key, day] of days) daysObj[key] = { slots: day.slots, reflection: day.reflection };
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    appVersion,
    categories: categories.map(({ name, weight, enabled, aliases }) => ({ name, weight, enabled, aliases })),
    settings: { ...settings },
    days: daysObj,
  };
}

/**
 * Validates and normalizes a backup file's text. Never trusts the contents —
 * every field routes through the same `normalize*` functions storage does.
 * @returns {{ok:true, data:{categories, settings, days:Map, exportedAt:string|null}} | {ok:false, error:string}}
 */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "That doesn't look like a Daily Dial backup." };
  }
  if (!Number.isInteger(obj.schemaVersion)) {
    return { ok: false, error: "Missing schema version — this doesn't look like a Daily Dial backup." };
  }
  if (obj.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This backup was made by a newer version of Daily Dial (schema ${obj.schemaVersion}). Update the extension first.`,
    };
  }

  const days = new Map();
  if (obj.days && typeof obj.days === "object") {
    for (const [key, raw] of Object.entries(obj.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      days.set(key, normalizeDay(raw));
    }
  }

  return {
    ok: true,
    data: {
      categories: normalizeCategories(obj.categories),
      settings: normalizeSettings(obj.settings),
      days,
      exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : null,
    },
  };
}

/** Counts for the import confirm step: how many days would change under each mode. */
export function summarizeImport(existingDays, incomingDays) {
  const incomingKeys = [...incomingDays.keys()];
  const overlapping = incomingKeys.filter((k) => existingDays.has(k)).length;
  return {
    incomingCount: incomingKeys.length,
    overlapping,
    newCount: incomingKeys.length - overlapping,
    existingCount: existingDays.size,
  };
}

/** Merge keeps existing days on conflict and adds missing ones; replace discards
 *  existing days entirely and restores exactly what the backup had. Returns a
 *  new Map — the caller decides whether/how to persist it. */
export function mergeDayMaps(existing, incoming, mode) {
  const result = new Map(mode === "replace" ? [] : existing);
  for (const [key, day] of incoming) {
    if (mode === "replace" || !result.has(key)) result.set(key, day);
  }
  return result;
}

/** Nudge to export a backup once there's real history and it's been a while. */
export function shouldNudgeBackup(lastExportAt, dayCount, now = new Date()) {
  if (dayCount < 7) return false;
  if (!lastExportAt) return true;
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
  return now.getTime() - lastExportAt > FOURTEEN_DAYS_MS;
}

/* ---------- reminders ---------- */

/** Next local occurrence of "HH:MM" as epoch ms; tomorrow if already past. */
export function nextOccurrence(hhmm, now = new Date()) {
  const [h, m] = hhmm.split(":").map(Number);
  const when = new Date(now);
  when.setHours(h, m, 0, 0);
  if (when.getTime() <= now.getTime()) when.setDate(when.getDate() + 1);
  return when.getTime();
}

export function reminderMessage(index, untrackedMin) {
  if (index !== 1) return "How did your morning go? Paint it in while you still remember.";
  return untrackedMin > 0
    ? `${fmtDuration(untrackedMin)} of today isn't logged yet. Close it out and add your one-line why.`
    : "Today is fully logged. Add your one-line why while it's fresh.";
}

/** Next local occurrence of a weekday (0=Sun..6=Sat) at "HH:MM" as epoch ms;
 *  next week if that slot has already passed. Used for the weekly recap alarm. */
export function nextWeeklyOccurrence(dayOfWeek, hhmm, now = new Date()) {
  const [h, m] = hhmm.split(":").map(Number);
  const when = new Date(now);
  when.setHours(h, m, 0, 0);
  let diff = (dayOfWeek - when.getDay() + 7) % 7;
  if (diff === 0 && when.getTime() <= now.getTime()) diff = 7;
  when.setDate(when.getDate() + diff);
  return when.getTime();
}

/** Most recent occurrence of `weekStart` (0=Sun..6=Sat) on/before `now`, at
 *  midnight local time — the start of the week a recap should cover. */
export function mostRecentWeekStart(weekStart, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}
