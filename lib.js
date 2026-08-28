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

export const DEFAULT_CATEGORIES = [
  { id: 0, name: "Deep Work", weight: 1, enabled: true, cls: "cat-0" },
  { id: 1, name: "Applications", weight: 1, enabled: true, cls: "cat-1" },
  { id: 2, name: "Study", weight: 1, enabled: true, cls: "cat-2" },
  { id: 3, name: "Admin", weight: 0, enabled: true, cls: "cat-3" },
  { id: 4, name: "Break", weight: 0, enabled: true, cls: "cat-4" },
  { id: 5, name: "Distraction", weight: -1, enabled: true, cls: "cat-5" },
];

export const DEFAULT_SETTINGS = { remindersOn: false, times: ["13:00", "21:00"] };
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

/** Categories are six fixed colour slots; only name/weight/enabled are editable.
 *  Days store the slot index, so renaming never rewrites history. */
export function normalizeCategories(saved) {
  const defaults = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  if (!Array.isArray(saved)) return defaults;
  return defaults.map((base, i) => {
    const s = saved[i];
    if (!s || typeof s !== "object") return base;
    const name = typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 24) : base.name;
    const weight = s.weight === 1 || s.weight === 0 || s.weight === -1 ? s.weight : base.weight;
    return { id: base.id, cls: base.cls, name, weight, enabled: s.enabled !== false };
  });
}

export function normalizeSettings(saved) {
  const times =
    Array.isArray(saved?.times) && saved.times.length === 2 && saved.times.every(isValidTime)
      ? [...saved.times]
      : [...DEFAULT_SETTINGS.times];
  return { remindersOn: saved?.remindersOn === true, times };
}

export const isValidTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

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

export const slotFromAngle = (angle) => Math.min(SLOTS - 1, Math.floor(angle / DEG_PER_SLOT));

/** Collapse consecutive same-category slots into runs, one wedge per run. */
export function computeRuns(slots) {
  const runs = [];
  let i = 0;
  while (i < SLOTS) {
    if (slots[i] === UNTRACKED) {
      i++;
      continue;
    }
    let j = i;
    while (j < SLOTS && slots[j] === slots[i]) j++;
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
  while (e < SLOTS - 1 && slots[e + 1] === cat) e++;
  return { cat, start: s, end: e + 1 };
}

/** Paint from→to the short way round, so a drag across midnight fills the
 *  stretch you dragged over rather than the 22 hours the other way. Returns a
 *  new array; the caller decides whether to keep it. */
export function fillRange(slots, from, to, cat) {
  const next = [...slots];
  const forward = (to - from + SLOTS) % SLOTS;
  const backward = SLOTS - forward;
  if (forward <= backward) {
    for (let i = 0; i <= forward; i++) next[(from + i) % SLOTS] = cat;
  } else {
    for (let i = 0; i <= backward; i++) next[((from - i) % SLOTS + SLOTS) % SLOTS] = cat;
  }
  return next;
}

/* ---------- stats ---------- */

/**
 * @returns {{perCat:number[], untrackedSlots:number, trackedMin:number,
 *   productiveMin:number, distractionMin:number, productivePct:number,
 *   longestFocusMin:number, score:number|null}}
 *   `score` is null when nothing is logged — distinct from a score of 0.
 */
export function computeStats(slots, categories) {
  const perCat = categories.map(() => 0);
  let untrackedSlots = 0;

  for (const v of slots) {
    if (v === UNTRACKED) untrackedSlots++;
    else if (perCat[v] !== undefined) perCat[v]++;
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

  const untrackedMin = stats.untrackedSlots * SLOT_MIN;
  if (untrackedMin >= 6 * 60) parts.push(`${fmtDuration(untrackedMin)} is still unlogged.`);

  return parts.join(" ");
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
