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
/** Whether the first-run welcome overlay has been dismissed. A dedicated flag
 *  rather than inferring from `days.size === 0`, so someone who clears all
 *  their history later doesn't see it again. */
export const ONBOARDING_SEEN_KEY = "onboardingSeen";
/** Exact date keys sample/demo data wrote, so "Clear sample data" can remove
 *  precisely those days — never a blanket wipe — regardless of whatever real
 *  data has been logged since. */
export const SAMPLE_DAY_KEYS_KEY = "sampleDayKeys";

/** Device-local connection bookkeeping for Google Drive backup — deliberately
 *  NOT part of `settings`, since a file id belongs to one Google account's
 *  Drive and would be meaningless (or wrong) if it round-tripped through a
 *  JSON backup onto a different device or account. */
export const DRIVE_FILE_ID_KEY = "driveBackupFileId";
export const DRIVE_LAST_SYNC_KEY = "driveLastSyncAt";
export const DRIVE_BACKUP_SIZE_KEY = "driveBackupSizeBytes";
export const DRIVE_ACCOUNT_EMAIL_KEY = "driveAccountEmail";

/** Google's userinfo endpoint, scoped down to just the one field this app
 *  ever reads — asking for the whole profile back would defeat the point of
 *  requesting the narrow `userinfo.email` scope in the first place. */
export function driveUserInfoUrl() {
  return "https://www.googleapis.com/oauth2/v2/userinfo?fields=email";
}

/** @returns {string|null} the account email, or null if the response didn't
 *  have one — e.g. a token that predates this scope being requested. */
export function driveParseUserInfoResponse(json) {
  return typeof json?.email === "string" && json.email ? json.email : null;
}

/** "42 KB" / "1.3 MB" — matches how a file manager would show it, since this
 *  is standing in for "how much of your Drive quota does this use". */
export function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  // An optional named run with a day counter — "#100days, day 19". A streak
  // measures consecutive days and breaks; this just counts from a start
  // date, which is what a personal challenge actually is.
  challenge: null, // { name: string, startKey: "YYYY-MM-DD", targetDays: number }
  // "Worth noticing" in History. On by default because an observation is
  // arithmetic on the user's own data rather than an opinion — but it is
  // still someone watching your habits and saying so, which not everyone
  // wants, so it gets a single switch rather than only per-item silencing.
  observationsOn: true,
  // Automatic Google Drive backup. Meaningless until Drive is connected by
  // hand, since a background alarm must never raise a sign-in window — see
  // driveConnectSilently.
  autoBackupOn: false,
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

/**
 * Hour and minute suffixes for `fmtDuration`.
 *
 * Module state rather than a parameter, deliberately: `fmtDuration` has
 * thirty call sites across three files, and threading a locale through every
 * one of them would put translation plumbing into functions that are only
 * doing arithmetic. The UI sets this once at boot from the message catalog —
 * it is the only layer that can reach `chrome.i18n` — and the English
 * defaults keep this module working, and testable, entirely on its own.
 */
export const durationUnits = { h: "h", m: "m" };

/** Called once by the UI at boot; no-op in tests, which want the defaults. */
export function setDurationUnits(h, m) {
  durationUnits.h = h;
  durationUnits.m = m;
}

export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m}${durationUnits.m}`;
  if (m === 0) return `${h}${durationUnits.h}`;
  return `${h}${durationUnits.h} ${m}${durationUnits.m}`;
}

/**
 * A piece of text the UI will translate: a message key plus its
 * substitutions. This module decides *what* is worth saying; only the UI can
 * reach `chrome.i18n`, so it decides in which language — which is also why
 * calculation here never has to know about wording.
 *
 * Substitutions are positional, matching `chrome.i18n.getMessage`.
 */
export const msg = (key, ...params) => ({ key, params });

/**
 * The same, for wording that depends on a count.
 *
 * English needs two forms, and a `n === 1 ? … : …` ternary encodes that
 * assumption in a way no translation can undo: Russian needs three forms and
 * Arabic six. The UI picks the right one with `Intl.PluralRules` and looks up
 * `key + "_" + form`, falling back to `key + "_other"`.
 */
export const plural = (key, count, ...params) => ({ key, count, params });

/* ---------- stored shapes ---------- */

export const emptyDay = () => ({ slots: new Array(SLOTS).fill(UNTRACKED), reflection: "", notes: [], intents: [], avoid: [] });

/** Storage is user-editable and survives version changes, so never trust it. */
export const MAX_NOTE_LEN = 500;
export const MAX_NOTES_PER_DAY = 40;
export const MAX_INTENTS_PER_DAY = 20;

/** A note pinned to a stretch of the day: `9-11, "sent the mail"`. Ranges are
 *  clamped into the day and ordered, so a malformed one can't render off the
 *  ring or invert. */
function normalizeNotes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((n) => {
      if (!n || typeof n !== "object") return null;
      const from = Number.isInteger(n.from) ? Math.max(0, Math.min(SLOTS - 1, n.from)) : null;
      const to = Number.isInteger(n.to) ? Math.max(1, Math.min(SLOTS, n.to)) : null;
      const text = typeof n.text === "string" ? n.text.slice(0, MAX_NOTE_LEN) : "";
      if (from === null || to === null || to <= from || !text.trim()) return null;
      return { from, to, text };
    })
    .filter(Boolean)
    .sort((a, b) => a.from - b.from)
    .slice(0, MAX_NOTES_PER_DAY);
}

/** A plain list of short lines: what to steer clear of today. Kept apart
 *  from intentions because it is read differently — these are the things you
 *  want to notice yourself doing, not tick off. */
function normalizeAvoid(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => (typeof a === "string" ? a.slice(0, MAX_NOTE_LEN) : typeof a?.text === "string" ? a.text.slice(0, MAX_NOTE_LEN) : ""))
    .filter((t) => t.trim())
    .slice(0, MAX_INTENTS_PER_DAY);
}

/** The day's intentions, each tickable — the "GOAL:" list at the top of a
 *  journal entry, where the value is seeing later which ones you actually
 *  did. */
function normalizeIntents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((i) => {
      if (!i || typeof i !== "object") return null;
      const text = typeof i.text === "string" ? i.text.slice(0, MAX_NOTE_LEN) : "";
      if (!text.trim()) return null;
      return { text, done: i.done === true };
    })
    .filter(Boolean)
    .slice(0, MAX_INTENTS_PER_DAY);
}

export function normalizeDay(raw) {
  if (!raw || typeof raw !== "object") return emptyDay();
  const slots =
    Array.isArray(raw.slots) && raw.slots.length === SLOTS
      ? raw.slots.map((v) => (Number.isInteger(v) ? v : UNTRACKED))
      : new Array(SLOTS).fill(UNTRACKED);
  return {
    slots,
    reflection: typeof raw.reflection === "string" ? raw.reflection : "",
    notes: normalizeNotes(raw.notes),
    intents: normalizeIntents(raw.intents),
    avoid: normalizeAvoid(raw.avoid),
  };
}

/** A day is worth keeping in the journal if anything at all was recorded —
 *  painted time, a note, an intention, or a reflection. Deliberately wider
 *  than `dayHasEntries`, which gates streaks on painted time alone. */
export const dayHasContent = (day) =>
  !!day &&
  (dayHasEntries(day) ||
    (day.reflection ?? "").trim() !== "" ||
    (day.notes ?? []).length > 0 ||
    (day.intents ?? []).length > 0 ||
    (day.avoid ?? []).length > 0);

/** A day "counts" for streaks/nudges/bests once at least one slot is painted. */
export const dayHasEntries = (day) => !!day && Array.isArray(day.slots) && day.slots.some((v) => v !== UNTRACKED);

/* ---------- day templates ---------- */

export const TEMPLATES_KEY = "templates";
export const MAX_TEMPLATES = 12;
export const MAX_TEMPLATE_NAME = 40;

/**
 * A template is the shape of a day, not its content: painted slots only —
 * never notes, intentions, avoid, or reflection, none of which would still
 * make sense stamped onto a different date. Storage is user-editable and
 * survives version changes, so an entry that doesn't already look right is
 * dropped rather than repaired — a wrong-length slots array painted onto a
 * real day would corrupt it outright.
 */
export function normalizeTemplates(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (out.length >= MAX_TEMPLATES) break;
    if (!t || typeof t !== "object") continue;
    const name = typeof t.name === "string" ? t.name.trim().slice(0, MAX_TEMPLATE_NAME) : "";
    if (!name) continue;
    if (!Array.isArray(t.slots) || t.slots.length !== SLOTS || !t.slots.every((v) => Number.isInteger(v))) continue;
    out.push({ name, slots: [...t.slots] });
  }
  return out;
}

/* ---------- multi-day fill ---------- */

/** Well short of a year: a range this long is far more likely a mistyped
 *  year than an intentional edit, and each day in it is a separate storage
 *  write. */
export const MULTI_DAY_FILL_MAX_DAYS = 92;

/**
 * Every calendar date from startKey to endKey inclusive, both "YYYY-MM-DD" —
 * the day-by-day plan for "I was away Monday to Friday".
 * @returns {{ok:true, keys:string[]} | {ok:false, error:{key:string,params:string[]}}}
 */
export function dateRangeKeys(startKey, endKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(endKey ?? "")) {
    return { ok: false, error: msg("errPickDates") };
  }
  const start = new Date(startKey + "T00:00:00");
  const end = new Date(endKey + "T00:00:00");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, error: msg("errPickDates") };
  }
  if (end < start) return { ok: false, error: msg("errEndDateBeforeStart") };

  const count = Math.round((end - start) / 86400000) + 1;
  if (count > MULTI_DAY_FILL_MAX_DAYS) {
    return { ok: false, error: msg("errRangeTooLong", String(count), String(MULTI_DAY_FILL_MAX_DAYS)) };
  }

  const keys = [];
  const cursor = new Date(start);
  for (let i = 0; i < count; i++) {
    keys.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return { ok: true, keys };
}

/**
 * Optional "HH:MM" from/to inputs for a multi-day fill, defaulting to the
 * whole day when left blank — "I was away Monday to Friday" is the common
 * case, not a partial-day one. Rounds to the nearest slot, same as
 * `parseTimeEntry`.
 * @returns {{ok:true, fromSlot:number, toSlot:number} | {ok:false, error:{key:string,params:string[]}}}
 */
export function multiDayFillSlotRange(fromTime, toTime) {
  if (fromTime && !isValidTime(fromTime)) return { ok: false, error: msg("errBadStartTime") };
  if (toTime && !isValidTime(toTime)) return { ok: false, error: msg("errBadEndTime") };
  const fromSlot = fromTime ? Math.round(hmToMinutes(fromTime) / SLOT_MIN) : 0;
  const toSlot = toTime ? Math.round(hmToMinutes(toTime) / SLOT_MIN) : SLOTS;
  if (toSlot <= fromSlot) return { ok: false, error: msg("errEndTimeBeforeStart") };
  return { ok: true, fromSlot, toSlot };
}

/** Returns a new slots array with [fromSlot, toSlot) set to `cat`. Unlike
 *  `fillRange` this never wraps — a multi-day fill names an explicit slot
 *  window, not a drag around the ring, so there's no "short way round" to
 *  choose between. */
export function fillSlotWindow(slots, fromSlot, toSlot, cat) {
  const next = [...slots];
  for (let i = fromSlot; i < toSlot; i++) next[i] = cat;
  return next;
}

/**
 * Counts for the multi-day fill confirm step: how many days are in the
 * range, and how many of those already have something painted in the slot
 * window about to be overwritten — never the whole day, since a narrow
 * time-of-day fill shouldn't warn about blocks outside it.
 */
export function summarizeMultiDayFill(days, keys, fromSlot, toSlot) {
  let paintedCount = 0;
  for (const key of keys) {
    const slots = days.get(key)?.slots;
    if (!slots) continue;
    for (let i = fromSlot; i < toSlot; i++) {
      if (slots[i] !== UNTRACKED) {
        paintedCount++;
        break;
      }
    }
  }
  return { dayCount: keys.length, paintedCount };
}

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
 *  history.
 *  @param {Array} saved
 *  @param {(key: string) => string} [translate] supplies localized default
 *    names; omitted in tests and anywhere the English defaults are wanted. */
export function normalizeCategories(saved, translate = null) {
  // The default *names* are UI text on a fresh install — a new Spanish user
  // should not be handed six English categories. But a saved name always
  // wins, and one is saved the moment anything is edited, so this never
  // renames a category someone already has data recorded against.
  const defaults = DEFAULT_CATEGORIES.map((c) => ({
    ...c,
    name: (translate && translate(`defaultCategory${c.id}`)) || c.name,
  }));
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

export const MAX_CHALLENGE_NAME = 40;

/** Never trusts stored input: a bad date or a silly length is dropped rather
 *  than allowed to produce a nonsense day number. */
function normalizeChallenge(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_CHALLENGE_NAME) : "";
  const startKey = typeof raw.startKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.startKey) ? raw.startKey : null;
  if (!name || !startKey || Number.isNaN(new Date(startKey + "T00:00:00").getTime())) return null;
  const targetDays =
    Number.isInteger(raw.targetDays) && raw.targetDays > 0 && raw.targetDays <= 3650 ? raw.targetDays : null;
  return { name, startKey, targetDays };
}

/**
 * Which day of the challenge `now` falls on, counting the start date as
 * day 1. Null before it starts.
 * @returns {{day:number, targetDays:number|null, name:string}|null}
 */
export function challengeProgress(challenge, now = new Date()) {
  if (!challenge) return null;
  const start = new Date(challenge.startKey + "T00:00:00");
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = Math.floor((today - start) / 86400000) + 1;
  if (day < 1) return null;
  return { day, targetDays: challenge.targetDays, name: challenge.name };
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
  const challenge = normalizeChallenge(saved?.challenge);
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
    challenge,
    observationsOn: saved?.observationsOn !== false,
    autoBackupOn: saved?.autoBackupOn === true,
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
/**
 * The whole day as one ordered sequence, gaps included — every slot from
 * midnight to midnight belongs to exactly one entry.
 *
 * `computeRuns` deliberately skips untracked time, which is right for drawing
 * wedges and wrong for reviewing a day: the hours you *didn't* log are the
 * ones worth being shown. Each entry is `{cat, start, end}` with `cat` set to
 * UNTRACKED for a gap.
 *
 * @param {number[]} slots
 * @returns {{cat:number, start:number, end:number}[]}
 */
export function computeDaySpans(slots) {
  const n = slots.length;
  const spans = [];
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && slots[j] === slots[i]) j++;
    spans.push({ cat: slots[i], start: i, end: j });
    i = j;
  }
  return spans;
}

/**
 * Which note belongs to a stretch, matched by the note's midpoint rather than
 * an exact range. Repainting shifts a block's boundaries; matching exactly
 * would orphan the note the moment its stretch grew or shrank by a slot.
 *
 * @returns {number[]} indices into `notes`, in order
 */
export function noteIndicesForSpan(notes, start, end) {
  const out = [];
  (notes ?? []).forEach((note, i) => {
    const mid = (note.from + note.to) / 2;
    if (mid >= start && mid < end) out.push(i);
  });
  return out;
}

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

/**
 * Below this much logged time, the score is arithmetic on too little to mean
 * anything. Thirty minutes of Deep Work and nothing else divides 30 by 30 and
 * reads +100 — the same as a flawless twelve-hour day, and better than an
 * honest one with a bad hour in it.
 */
export const MIN_TRACKED_FOR_SCORE = 120;

/**
 * @param {number|null} score
 * @param {number} [trackedMin] When given, a day with less than
 *   `MIN_TRACKED_FOR_SCORE` logged is reported as provisional rather than
 *   being labelled confidently. The score itself is still returned and still
 *   stored — this governs how it is presented, not what it is.
 * @returns {{labelKey:string, tone:string, provisional?:boolean}}
 */
export function scoreBucket(score, trackedMin) {
  if (score === null) return { labelKey: "scoreNoData", tone: "muted" };
  if (trackedMin !== undefined && trackedMin < MIN_TRACKED_FOR_SCORE) {
    return { labelKey: "scoreTooLittle", tone: "muted", provisional: true };
  }
  if (score >= 40) return { labelKey: "scoreLockedIn", tone: "good" };
  if (score >= 10) return { labelKey: "scoreSolid", tone: "good" };
  if (score >= -15) return { labelKey: "scoreMixedBag", tone: "warning" };
  return { labelKey: "scoreOffTrack", tone: "critical" };
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
 * The day in a sentence or two, as message descriptors for the UI to
 * translate and join.
 *
 * Whole sentences, not fragments. The English version could be assembled from
 * pieces — "X led the day", " at ", "7h 45m" — because English puts the verb
 * in the middle. Hindi puts it last and Japanese puts it last too, so a
 * translator handed the pieces separately cannot produce a correct sentence
 * at any price. Each message here owns its whole sentence, including where
 * the `<b>` emphasis falls, so word order is the translator's to decide.
 *
 * The messages contain `<b>`; every substituted value must be escaped by the
 * caller before it goes in, since one of them is a user-named category.
 */
export function buildInsight(stats, categories) {
  if (stats.trackedMin === 0) return [msg("insightNothingLogged")];

  const ranked = categories
    .map((c, i) => ({ cat: c, min: stats.perCat[i] * SLOT_MIN }))
    .filter((r) => r.min > 0)
    .sort((a, b) => b.min - a.min);

  const parts = [msg("insightProductivePct", String(stats.productivePct))];

  if (stats.distractionMin > 0 && stats.distractionMin >= stats.productiveMin) {
    parts.push(msg("insightMostlyDrain", fmtDuration(stats.distractionMin)));
  } else if (ranked[0]) {
    parts.push(msg("insightTopCategory", ranked[0].cat.name, fmtDuration(ranked[0].min)));
  }

  if (stats.productiveMin >= 60 && stats.longestFocusMin < 45) {
    parts.push(msg("insightFragmented", fmtDuration(stats.longestFocusMin)));
  } else if (stats.longestFocusMin >= 90) {
    parts.push(msg("insightLongStretch", fmtDuration(stats.longestFocusMin)));
  }

  // Restricted to the caller's waking-hours window (via computeStats'
  // dayWindow), so sleeping hours don't inflate this into a false nag.
  if (stats.untrackedInWindowMin >= 6 * 60) {
    parts.push(msg("insightStillUnlogged", fmtDuration(stats.untrackedInWindowMin)));
  }

  return parts;
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
    // Re-anchor to local midnight. Where DST springs forward *at* midnight
    // (Havana, Santiago) that hour doesn't exist, so the cursor normalizes to
    // 01:00 and stays there — permanently one hour past `end`, which is a
    // midnight. The final day then never gets processed, and every streak in
    // those timezones reads one short forever after the transition.
    cursor.setHours(0, 0, 0, 0);
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
  let intentsSet = 0;
  let intentsDone = 0;
  let daysLogged = 0;

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = dateKey(d);
    const day = days.get(key);
    const slots = day?.slots ?? new Array(SLOTS).fill(UNTRACKED);
    const stats = computeStats(slots, categories);

    trackedMin += stats.trackedMin;
    productiveMin += stats.productiveMin;
    stats.perCat.forEach((n, idx) => (perCatMin[idx] += n * SLOT_MIN));
    if (dayHasEntries(day)) daysLogged++;
    // How the week's stated intentions actually went — the half of a weekly
    // review that a time total can't answer.
    for (const intent of day?.intents ?? []) {
      intentsSet++;
      if (intent.done) intentsDone++;
    }
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
    daysLogged,
    productivePct: trackedMin > 0 ? Math.round((productiveMin / trackedMin) * 100) : 0,
    topCategory,
    bestDay,
    intentsSet,
    intentsDone,
    streak: computeStreak(days, weekEnd),
  };
}

/**
 * Short line for the notification itself; the dial shows the rest.
 *
 * Ends on a question rather than a summary. A recap that only reports
 * numbers is read and forgotten; the point of a weekly look back is to
 * decide whether anything needs changing, so it asks.
 */
export function weeklyRecapMessage(recap) {
  if (recap.trackedMin === 0) return [msg("recapNothingLogged")];
  const parts = [msg("recapTrackedProductive", fmtDuration(recap.trackedMin), String(recap.productivePct))];
  if (recap.topCategory) parts.push(msg("recapTopCategory", recap.topCategory.name));
  if (recap.intentsSet > 0) parts.push(plural("recapIntentions", recap.intentsSet, String(recap.intentsDone), String(recap.intentsSet)));
  parts.push(msg("recapAskAdjust"));
  return parts;
}

/* ---------- asking for a review ---------- */

/** Storage key for what has been asked and answered. Its own key rather than
 *  a setting: it is a record of two events, not a preference, and it has no
 *  business travelling in a backup to another device. */
export const REVIEW_ASK_KEY = "reviewAsk";

export const REVIEW_FIRST_ASK_DAYS = 7;
export const REVIEW_SECOND_ASK_GAP = 60;
export const REVIEW_MAX_ASKS = 2;

/**
 * Whether to ask for a review, given what has been asked before.
 *
 * Two asks, ever, and the second only after another two months of actual
 * use. The first waits a week of logged days rather than a week of calendar
 * time, so it lands on someone who has used the thing rather than someone
 * who installed it and forgot. Following the link — or a second dismissal —
 * ends it permanently.
 *
 * `state` is `{ asks, lastAskAtDays, done }`, all optional.
 */
export function shouldAskForReview(state, loggedDays) {
  const asks = Number.isInteger(state?.asks) ? state.asks : 0;
  const lastAt = Number.isInteger(state?.lastAskAtDays) ? state.lastAskAtDays : 0;
  if (state?.done || asks >= REVIEW_MAX_ASKS) return false;
  if (asks === 0) return loggedDays >= REVIEW_FIRST_ASK_DAYS;
  return loggedDays >= lastAt + REVIEW_SECOND_ASK_GAP;
}

/** The state to store once an ask has been shown. */
export const noteReviewAsked = (state, loggedDays) => ({
  asks: (Number.isInteger(state?.asks) ? state.asks : 0) + 1,
  lastAskAtDays: loggedDays,
  done: false,
});

/** The state to store once it should never ask again — the link was followed,
 *  or the last permitted ask was dismissed. */
export const noteReviewDone = (state) => ({ ...(state ?? {}), done: true });

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

/* ---------- pattern detection ---------- */

/**
 * Daily Dial states patterns it notices in a user's own data as plain facts
 * — never advice, never a judgment. "What to do about it" lives entirely in
 * suggestions.js, addressed by `suggestionKey`; nothing here should ever
 * read as "you should...".
 *
 * @typedef {{id:string, headline:{key:string,params:string[]},
 *   detail:{key:string,params:string[]}, suggestionKey:string}} Observation
 */

/** Below this much history, a detector says nothing — a good or bad run of a
 *  few days looks identical to a real pattern. Elapsed time matters as much
 *  as day count: a week of data backfilled in one sitting isn't three weeks
 *  of lived pattern, so both are required. Applied identically by every
 *  detector below regardless of how far back its own window looks — one
 *  that only ever examines the last 7 days still says nothing until three
 *  weeks of history exist to judge it against. */
export const MIN_HISTORY_DAYS = 21;
export const MIN_LOGGED_DAYS = 8;

function hasEnoughHistory(days, now) {
  const loggedKeys = [...days.entries()].filter(([, day]) => dayHasEntries(day)).map(([key]) => key);
  if (loggedKeys.length < MIN_LOGGED_DAYS) return false;
  const earliest = new Date(loggedKeys.sort()[0] + "T00:00:00");
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const elapsedDays = Math.round((today - earliest) / 86400000);
  return elapsedDays >= MIN_HISTORY_DAYS;
}

/** The `count` calendar days ending `offset` days before today (offset 0 =
 *  today itself), oldest-window-first callers get by increasing `offset` —
 *  e.g. `recentDays(days, now, 7, 7)` is the 7 days *before* the most recent
 *  7. Local time throughout, via `dateKey`; never touches `now` itself. */
function recentDays(days, now, count, offset = 0) {
  const out = [];
  for (let i = offset; i < offset + count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(days.get(dateKey(d)) ?? null);
  }
  return out;
}

/** Minutes actually painted in a day, independent of category — plain
 *  "coverage" — restricted to the user's own waking-hours window so a
 *  quieter night's sleep doesn't read as coverage dropping off, mirroring
 *  how `buildInsight`'s unlogged-time nag is scoped to `dayWindow`. */
function trackedMinutesInWindow(day, dayWindow) {
  if (!day || !Array.isArray(day.slots)) return 0;
  const startSlot = Math.max(0, Math.round(hmToMinutes(dayWindow.start) / SLOT_MIN));
  const endSlot = Math.min(SLOTS, Math.round(hmToMinutes(dayWindow.end) / SLOT_MIN));
  let n = 0;
  for (let i = startSlot; i < endSlot; i++) if (day.slots[i] !== UNTRACKED) n++;
  return n * SLOT_MIN;
}

const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

export const OVERCOMMIT_WINDOW_DAYS = 21;
export const OVERCOMMIT_MIN_INTENTIONS = 10;
export const OVERCOMMIT_MAX_DONE_RATIO = 0.4;

/**
 * Over the last `OVERCOMMIT_WINDOW_DAYS` days: at least
 * `OVERCOMMIT_MIN_INTENTIONS` intentions were set, and fewer than
 * `OVERCOMMIT_MAX_DONE_RATIO` of them got ticked done. This is about setting
 * too many, not about trying harder, so the headline never mentions effort.
 * @returns {Observation|null}
 */
export function detectIntentionOvercommit(days, now) {
  if (!hasEnoughHistory(days, now)) return null;

  let set = 0;
  let done = 0;
  for (const day of recentDays(days, now, OVERCOMMIT_WINDOW_DAYS)) {
    for (const intent of day?.intents ?? []) {
      set++;
      if (intent.done) done++;
    }
  }
  if (set < OVERCOMMIT_MIN_INTENTIONS) return null;
  if (done / set >= OVERCOMMIT_MAX_DONE_RATIO) return null;

  return {
    id: "intentionOvercommit",
    headline: msg("obsOvercommitHeadline"),
    detail: msg("obsOvercommitDetail", String(set), String(OVERCOMMIT_WINDOW_DAYS), String(done)),
    suggestionKey: "intentionOvercommit",
  };
}

export const NO_BREAKS_WINDOW_DAYS = 14;
export const NO_BREAKS_MIN_TRACKED_HOURS = 20;

/**
 * Over the last `NO_BREAKS_WINDOW_DAYS` days: zero minutes logged in any
 * category with `weight === 0`, while total tracked time is at least
 * `NO_BREAKS_MIN_TRACKED_HOURS` hours. Says nothing if no category is even
 * configured as neutral — there'd be nowhere for a break to be logged.
 * @returns {Observation|null}
 */
export function detectNoBreaks(days, categories, now) {
  if (!hasEnoughHistory(days, now)) return null;

  const neutralIdx = categories.map((c, i) => (c.weight === 0 ? i : -1)).filter((i) => i >= 0);
  if (neutralIdx.length === 0) return null;

  let trackedMin = 0;
  let neutralMin = 0;
  for (const day of recentDays(days, now, NO_BREAKS_WINDOW_DAYS)) {
    if (!day) continue;
    const stats = computeStats(day.slots, categories);
    trackedMin += stats.trackedMin;
    for (const i of neutralIdx) neutralMin += stats.perCat[i] * SLOT_MIN;
  }
  if (trackedMin < NO_BREAKS_MIN_TRACKED_HOURS * 60) return null;
  if (neutralMin > 0) return null;

  return {
    id: "noBreaks",
    headline: msg("obsNoBreaksHeadline", String(NO_BREAKS_WINDOW_DAYS)),
    detail: msg("obsNoBreaksDetail", fmtDuration(trackedMin), String(NO_BREAKS_WINDOW_DAYS)),
    suggestionKey: "noBreaks",
  };
}

export const DISTRACTION_TREND_WINDOW_DAYS = 7;
export const DISTRACTION_TREND_MIN_RATIO = 1.3;
export const DISTRACTION_TREND_MIN_CURRENT_MIN = 300;

/**
 * Minutes in `weight === -1` categories over the last
 * `DISTRACTION_TREND_WINDOW_DAYS` days vs. the same number of days before
 * that: flags when the current window is at least `DISTRACTION_TREND_MIN_RATIO`
 * times the previous one, and at least `DISTRACTION_TREND_MIN_CURRENT_MIN`
 * minutes on its own (so two near-zero windows can't trip a "1.3x" trend).
 * @returns {Observation|null}
 */
export function detectDistractionTrend(days, categories, now) {
  if (!hasEnoughHistory(days, now)) return null;

  const distractionMin = (day) => (day ? computeStats(day.slots, categories).distractionMin : 0);
  const currentMin = recentDays(days, now, DISTRACTION_TREND_WINDOW_DAYS, 0).reduce(
    (sum, day) => sum + distractionMin(day),
    0
  );
  const previousMin = recentDays(days, now, DISTRACTION_TREND_WINDOW_DAYS, DISTRACTION_TREND_WINDOW_DAYS).reduce(
    (sum, day) => sum + distractionMin(day),
    0
  );

  if (currentMin < DISTRACTION_TREND_MIN_CURRENT_MIN) return null;
  if (currentMin < previousMin * DISTRACTION_TREND_MIN_RATIO) return null;

  return {
    id: "distractionTrend",
    headline: msg("obsDistractionHeadline", String(DISTRACTION_TREND_WINDOW_DAYS)),
    detail: msg("obsDistractionDetail", fmtDuration(currentMin), String(DISTRACTION_TREND_WINDOW_DAYS), fmtDuration(previousMin)),
    suggestionKey: "distractionTrend",
  };
}

export const COVERAGE_DECLINE_RECENT_DAYS = 7;
export const COVERAGE_DECLINE_PRIOR_DAYS = 14;
export const COVERAGE_DECLINE_MAX_RATIO = 0.6;
export const COVERAGE_DECLINE_MIN_PRIOR_AVG_MIN = 120;

/**
 * Average tracked minutes/day, within the user's waking-hours window
 * (`settings.dayWindow`), over the last `COVERAGE_DECLINE_RECENT_DAYS` days
 * vs. the `COVERAGE_DECLINE_PRIOR_DAYS` days before that: flags when the
 * recent average is under `COVERAGE_DECLINE_MAX_RATIO` of the older one, and
 * the older average was itself at least `COVERAGE_DECLINE_MIN_PRIOR_AVG_MIN`
 * minutes/day — so a habit that was never really established can't read as
 * one that "declined".
 * @returns {Observation|null}
 */
export function detectCoverageDecline(days, settings, now) {
  if (!hasEnoughHistory(days, now)) return null;

  const recentAvg = avg(
    recentDays(days, now, COVERAGE_DECLINE_RECENT_DAYS, 0).map((d) => trackedMinutesInWindow(d, settings.dayWindow))
  );
  const priorAvg = avg(
    recentDays(days, now, COVERAGE_DECLINE_PRIOR_DAYS, COVERAGE_DECLINE_RECENT_DAYS).map((d) =>
      trackedMinutesInWindow(d, settings.dayWindow)
    )
  );

  if (priorAvg < COVERAGE_DECLINE_MIN_PRIOR_AVG_MIN) return null;
  if (recentAvg >= priorAvg * COVERAGE_DECLINE_MAX_RATIO) return null;

  return {
    id: "coverageDecline",
    headline: msg("obsCoverageHeadline", String(COVERAGE_DECLINE_PRIOR_DAYS)),
    detail: msg("obsCoverageDetail", fmtDuration(Math.round(recentAvg)), String(COVERAGE_DECLINE_RECENT_DAYS), fmtDuration(Math.round(priorAvg)), String(COVERAGE_DECLINE_PRIOR_DAYS)),
    suggestionKey: "coverageDecline",
  };
}

export const PEAK_HOURS_WINDOW_DAYS = 28;
/** An hour counts as "protected" on a given day once at least half its
 *  15-minute slots are painted with a `weight === 1` category. */
export const PEAK_HOURS_DAY_MAJORITY_SLOTS = 2;
export const PEAK_HOURS_MAX_PROTECTED_RATIO = 0.4;

/**
 * Across the last `PEAK_HOURS_WINDOW_DAYS` days, buckets slots by hour of day
 * (0–23) and finds the hour that accumulated the most `weight === 1` time in
 * total. Flags when that hour was only "protected" (see
 * `PEAK_HOURS_DAY_MAJORITY_SLOTS`) on fewer than `PEAK_HOURS_MAX_PROTECTED_RATIO`
 * of the days that had any entries at all.
 * @returns {Observation|null}
 */
export function detectPeakHoursUnprotected(days, categories, now) {
  if (!hasEnoughHistory(days, now)) return null;

  const window = recentDays(days, now, PEAK_HOURS_WINDOW_DAYS);
  const loggedDays = window.filter((day) => dayHasEntries(day));
  if (loggedDays.length === 0) return null;

  const slotsPerHour = SLOTS / 24;
  const productiveMinPerHour = new Array(24).fill(0);
  for (const day of window) {
    if (!day) continue;
    for (let s = 0; s < SLOTS; s++) {
      if (categories[day.slots[s]]?.weight === 1) productiveMinPerHour[Math.floor(s / slotsPerHour)] += SLOT_MIN;
    }
  }

  const peakHour = productiveMinPerHour.reduce((best, min, h) => (min > productiveMinPerHour[best] ? h : best), 0);
  if (productiveMinPerHour[peakHour] === 0) return null; // nothing productive logged at all

  let protectedDays = 0;
  for (const day of loggedDays) {
    let weight1Slots = 0;
    for (let s = peakHour * slotsPerHour; s < (peakHour + 1) * slotsPerHour; s++) {
      if (categories[day.slots[s]]?.weight === 1) weight1Slots++;
    }
    if (weight1Slots >= PEAK_HOURS_DAY_MAJORITY_SLOTS) protectedDays++;
  }

  if (protectedDays / loggedDays.length >= PEAK_HOURS_MAX_PROTECTED_RATIO) return null;

  const hourLabel = `${pad2(peakHour)}:00`;
  return {
    id: "peakHoursUnprotected",
    headline: plural("obsPeakHourHeadline", loggedDays.length, hourLabel, String(protectedDays), String(loggedDays.length)),
    detail: plural("obsPeakHourDetail", loggedDays.length, String(PEAK_HOURS_WINDOW_DAYS), hourLabel, String(protectedDays), String(loggedDays.length)),
    suggestionKey: "peakHoursUnprotected",
  };
}

export const UNTRACKED_LIFE_AREA_WINDOW_DAYS = 21;
export const UNTRACKED_LIFE_AREA_MAX_DISTINCT_CATEGORIES = 3;

/**
 * Over the last `UNTRACKED_LIFE_AREA_WINDOW_DAYS` days: all logged time falls
 * into at most `UNTRACKED_LIFE_AREA_MAX_DISTINCT_CATEGORIES` distinct
 * categories, and at least one *enabled* category logged zero minutes.
 * Categories are a hard-capped six slots, so the wording — and the detail,
 * which names the unused one — points at repurposing it, never at adding a
 * new one, which the app has no way to do.
 * @returns {Observation|null}
 */
export function detectUntrackedLifeArea(days, categories, now) {
  if (!hasEnoughHistory(days, now)) return null;

  const perCatMin = categories.map(() => 0);
  for (const day of recentDays(days, now, UNTRACKED_LIFE_AREA_WINDOW_DAYS)) {
    if (!day) continue;
    computeStats(day.slots, categories).perCat.forEach((n, i) => (perCatMin[i] += n * SLOT_MIN));
  }

  const usedCount = perCatMin.filter((m) => m > 0).length;
  if (usedCount === 0 || usedCount > UNTRACKED_LIFE_AREA_MAX_DISTINCT_CATEGORIES) return null;

  const unusedIdx = categories.findIndex((c, i) => c.enabled && perCatMin[i] === 0);
  if (unusedIdx === -1) return null;
  const unused = categories[unusedIdx];

  return {
    id: "untrackedLifeArea",
    headline: plural("obsUntrackedAreaHeadline", usedCount, String(UNTRACKED_LIFE_AREA_WINDOW_DAYS), String(usedCount)),
    detail: msg("obsUntrackedAreaDetail", unused.name),
    suggestionKey: "untrackedLifeArea",
  };
}

/**
 * Runs every detector and returns whichever fired, dropping the rest. Order
 * is fixed (not sorted by severity or recency) so the list reads the same
 * way from one run to the next.
 * @returns {Observation[]}
 */
export function detectPatterns(days, categories, settings, now = new Date()) {
  return [
    detectIntentionOvercommit(days, now),
    detectNoBreaks(days, categories, now),
    detectPeakHoursUnprotected(days, categories, now),
    detectDistractionTrend(days, categories, now),
    detectCoverageDecline(days, settings, now),
    detectUntrackedLifeArea(days, categories, now),
  ].filter(Boolean);
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
 * @returns {{ok:true, startSlot:number, endSlot:number, categoryId:number} | {ok:false, error:{key:string,params:string[]}}}
 */
/** Words that clear a range instead of naming a category. */
const ERASE_WORDS = ["erase", "clear", "untracked", "none", "empty"];

export function parseTimeEntry(text, categories) {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: msg("errTryExample") };
  }

  const m = text
    .trim()
    .match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(.+)$/i);
  if (!m) return { ok: false, error: msg("errUnreadableEntry") };

  const [, startTok, endTok, catText] = m;
  const startMin = parseClockToken(startTok);
  const endMin = parseClockToken(endTok);
  if (startMin === null || endMin === null) {
    return { ok: false, error: msg("errUnreadableTime") };
  }

  const startSlot = Math.round(startMin / SLOT_MIN);
  let endSlot = Math.round(endMin / SLOT_MIN);
  if (endSlot <= startSlot) {
    const wrapped = endSlot + SLOTS;
    // Allow a short wrap past midnight (an evening session); a long "wrap"
    // is almost always a typo'd inverted range, so reject it instead.
    if (wrapped - startSlot <= SLOTS / 2) endSlot = wrapped;
    else return { ok: false, error: msg("errEndTimeBeforeStart") };
  }

  const wanted = catText.trim().toLowerCase();
  if (!wanted) return { ok: false, error: msg("errNoCategoryGiven") };


  // A category matches by its own name or by any of its aliases (personal
  // vocabulary a user has linked to it, e.g. "leetcode" → Applications).
  const labelsOf = (c) => [c.name.toLowerCase(), ...(c.aliases ?? [])];
  const enabled = categories.filter((c) => c.enabled);
  const exact = enabled.find((c) => labelsOf(c).includes(wanted));
  const matches = exact ? [exact] : enabled.filter((c) => labelsOf(c).some((label) => label.includes(wanted)));

  // Typed entry could add a block but never remove one, so the only way for
  // someone working without a pointer to fix a mistake was Clear day, which
  // wipes all 24 hours. These words erase instead — checked only after a
  // real category has failed to match, so renaming a category "Empty"
  // still gets you that category rather than a wipe.
  if (matches.length === 0 && ERASE_WORDS.includes(wanted)) {
    return { ok: true, startSlot, endSlot, categoryId: UNTRACKED };
  }
  if (matches.length === 0) return { ok: false, error: msg("errNoCategoryMatch", catText.trim()) };
  if (matches.length > 1) {
    return {
      ok: false,
      error: msg("errCategoryAmbiguous", catText.trim(), matches.map((c) => c.name).join(", ")),
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
  // Deliberately never translated. This is a file format, not UI: a CSV
  // exported on a Hindi install has to import cleanly on an English one, and
  // `parseCsvImport` below matches these exact strings. Translating them
  // would make every export readable only by the locale that wrote it.
  const rows = [[...CSV_HEADER]];

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

/**
 * A prompt someone can paste into any assistant, along with whatever their
 * old records look like, to get a file this importer will accept.
 *
 * Built here rather than written as a fixed string in the UI because it has
 * to name *this* user's categories: the importer matches them by exact name,
 * so a prompt listing the defaults would produce a file that fails for
 * anyone who renamed one. Generating it also means it cannot drift from the
 * parser — both read CSV_HEADER, and a test asserts a prompt-shaped example
 * survives a round trip through parseCsv.
 *
 * Deliberately not a network feature. It copies text to the clipboard; where
 * that text goes next is the user's business, and nothing about their day is
 * in it — only the format and their category names.
 */
export function buildImportPrompt(categories) {
  const names = categories.filter((c) => c.enabled).map((c) => c.name);
  return [
    "I have some records of how I spent my time. Convert them into a CSV file",
    "for a time-tracking app, following these rules exactly.",
    "",
    "Output the header line first, exactly this and nothing else:",
    CSV_HEADER.join(","),
    "",
    "Then one row per block of time. Rules:",
    "",
    `- Date: YYYY-MM-DD, e.g. ${dateKey(new Date())}`,
    "- Start and End: 24-hour HH:MM, e.g. 09:00 and 11:30",
    `- Start and End must fall on ${SLOT_MIN}-minute boundaries (:00, :15, :30, :45)`,
    `- Each block must be at least ${SLOT_MIN} minutes long; End must be after Start`,
    "- A block ending at midnight is written as 00:00",
    "- Blocks on the same date must not overlap each other",
    "- Category: must be exactly one of these, copied character for character:",
    ...names.map((n) => `    ${n}`),
    "- If something does not fit a category, choose the closest one rather than inventing a new name",
    '- "Duration (min)" and "Weight": leave both empty. They are ignored on import.',
    "- Note: optional. It becomes that day's single one-line reflection, so use it",
    "  on at most one row per date — a second note for the same date replaces the first.",
    "  If it contains a comma, wrap it in double quotes.",
    "",
    "Output only the CSV. No explanation, no code fence, no extra columns,",
    "no blank rows between records. If a record is too vague to place, leave",
    "it out rather than guessing at a time.",
    "",
    "Here are my records:",
    "",
  ].join("\n");
}

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

/** Rounds to the nearest slot, exactly as `parseTimeEntry` does. Without the
 *  rounding a time off the 15-minute grid (09:07 — anything that has been
 *  through a spreadsheet, or came from a 10-minute tracker) produced a
 *  fractional array index: the row imported as nothing at all, while the
 *  import still reported success and counted the day. */
const hmToSlot = (hm) => {
  const [h, m] = hm.split(":").map(Number);
  return Math.round((h * 60 + m) / SLOT_MIN);
};

/**
 * Parses the exact shape `buildCsv` emits. Matches categories by exact name
 * against the caller's current category list — never trust the file.
 * @returns {{ok:true, data:Map<string,{slots:number[],reflection:string}>} | {ok:false, error:{key:string,params:string[]}}}
 */
export function parseCsv(text, categories) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: msg("errFileEmpty") };

  const rows = parseCsvRows(text.replace(/^\uFEFF/, "")).filter((r) => !(r.length === 1 && r[0] === ""));
  if (rows.length === 0) return { ok: false, error: msg("errFileEmpty") };

  const header = rows[0].map((h) => h.trim());
  if (header.length !== CSV_HEADER.length || header.some((h, i) => h !== CSV_HEADER[i])) {
    return { ok: false, error: msg("errNotDailyDialCsv") };
  }

  const days = new Map();
  for (let r = 1; r < rows.length; r++) {
    const [dateStr, startStr, endStr, , catName, , note] = rows[r];
    if (rows[r].length === 1 && !rows[r][0]) continue; // stray blank line

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr ?? "")) return { ok: false, error: msg("errCsvBadDate", String(r + 1), String(dateStr)) };
    if (!isValidTime(startStr)) return { ok: false, error: msg("errCsvBadStartTime", String(r + 1), String(startStr)) };
    if (!isValidTime(endStr) && endStr !== "00:00") {
      return { ok: false, error: msg("errCsvBadEndTime", String(r + 1), String(endStr)) };
    }

    const cat = categories.find((c) => c.name === catName);
    if (!cat) return { ok: false, error: msg("errCsvUnknownCategory", String(r + 1), String(catName)) };

    const startSlot = hmToSlot(startStr);
    const endSlot = endStr === "00:00" ? SLOTS : hmToSlot(endStr);
    if (endSlot <= startSlot) {
      // Distinguish a genuinely inverted range from one that's simply too
      // short to represent, so a rounded-away block says why.
      const rawStart = hmToMinutes(startStr);
      const rawEnd = endStr === "00:00" ? SLOTS * SLOT_MIN : hmToMinutes(endStr);
      return rawEnd > rawStart
        ? { ok: false, error: msg("errCsvBlockTooShort", String(r + 1), String(SLOT_MIN)) }
        : { ok: false, error: msg("errCsvEndNotAfterStart", String(r + 1)) };
    }

    if (!days.has(dateStr)) days.set(dateStr, emptyDay());
    const day = days.get(dateStr);
    for (let i = startSlot; i < endSlot; i++) day.slots[i] = cat.id;
    if (note) day.reflection = note;
  }

  return { ok: true, data: days };
}

/* ---------- backup (import / export) ---------- */

/**
 * Returns `days` without the given keys; the original is left untouched.
 * Used to keep demo-mode sample days out of backups. A backup is a copy of
 * *your* history, and fabricated days carry no marker of their own — once
 * they land in an export file there is nothing left to tell them apart from
 * real days on the way back in.
 * @param {Map<string, object>} days
 * @param {string[]} keys
 * @returns {Map<string, object>}
 */
export function excludeDays(days, keys) {
  if (!keys || keys.length === 0) return days;
  const drop = new Set(keys);
  const out = new Map();
  for (const [key, day] of days) if (!drop.has(key)) out.set(key, day);
  return out;
}

/** Full-fidelity snapshot: every day, category, and setting. */
export function buildBackup(days, categories, settings, appVersion, now = new Date()) {
  const daysObj = {};
  for (const [key, day] of days) {
    daysObj[key] = {
      slots: day.slots,
      reflection: day.reflection,
      notes: day.notes ?? [],
      intents: day.intents ?? [],
      avoid: day.avoid ?? [],
    };
  }
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
 * @returns {{ok:true, data:{categories, settings, days:Map, exportedAt:string|null}} | {ok:false, error:{key:string,params:string[]}}}
 */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: msg("errNotValidJson") };
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: msg("errNotDailyDialBackup") };
  }
  if (!Number.isInteger(obj.schemaVersion)) {
    return { ok: false, error: msg("errMissingSchemaVersion") };
  }
  if (obj.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error: msg("errBackupTooNew", String(obj.schemaVersion)),
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
  if (index !== 1) return msg("promptMorning");
  return untrackedMin > 0
    ? msg("promptEveningUnlogged", fmtDuration(untrackedMin))
    : msg("promptEveningComplete");
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

/**
 * Which week a recap firing at `now` should actually summarise.
 *
 * The recap is scheduled on `weeklyRecapDay` but the window used to be
 * derived from `weekStart` alone — "the last fully complete aligned week" —
 * so the two disagreed the moment either setting moved off its default.
 * Setting the recap to Saturday evening reported the week *before* the one
 * just lived through, up to seven days stale, which is worse than no recap:
 * the numbers look current and aren't.
 *
 * The rule: report the most recent aligned week that has ended — and count
 * the current week as ended when the recap fires on its final day, since
 * choosing that day is exactly how someone asks to hear about the week they
 * just finished. Leaves the default (recap on the same day the week starts)
 * behaving as it always did.
 *
 * @param {number} weekStart 0 = Sunday, 1 = Monday
 * @returns {Date} local midnight on the first day of the week to summarise
 */
export function recapWeekStart(weekStart, now = new Date()) {
  const start = mostRecentWeekStart(weekStart, now);
  const dayWithinWeek = (now.getDay() - weekStart + 7) % 7;
  if (dayWithinWeek !== 6) start.setDate(start.getDate() - 7);
  return start;
}

/**
 * The URL fragment to open the dial at, from whatever a caller passed.
 *
 * `chrome.action.onClicked` hands its listener the Tab object, so wiring it
 * straight to a function taking an optional hash appended "[object Object]"
 * to the extension URL and broke every toolbar click. Anything that isn't a
 * hash string we recognise resolves to none.
 *
 * @returns {""|"#history"}
 */
export function dialUrlSuffix(hash) {
  return hash === "#history" ? "#history" : "";
}

/* ---------- shareable snapshot ---------- */

/** Fixed hex values for the "Share as image" card. Deliberately not the
 *  live CSS custom properties: the rendered SVG is rasterized outside the
 *  page's cascade (via an <img> src), so var(--cat-0) etc. wouldn't resolve
 *  there. Matches this project's dark theme, which is also what every store
 *  screenshot uses, so a share always looks the same regardless of the
 *  sharer's own theme setting. */
const SHARE_CAT_HEX = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];
const SHARE_TONE_HEX = { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b", muted: "#7c8590" };

const escapeXml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** English fallbacks for the share card's words, so this module stays
 *  runnable and testable without a message catalog. */
const SHARE_LABELS = {
  score: "score",
  bucket: "",
  nothingLogged: "Nothing logged yet",
  tracked: "",
  led: "",
  streak: "",
};

/**
 * A self-contained 1000×560 SVG string — a full day's dial plus its score,
 * for the "Share as image" button. Pure and DOM-free like the rest of this
 * file, so the whole layout is unit-testable; dial.js only has to rasterize
 * the string it gets back.
 *
 * The words arrive already translated and already formatted, rather than
 * being assembled here. A shared PNG is the one output that leaves the
 * device, so it should read in the language the sharer is using — and this
 * function has no way to reach a message catalog.
 *
 * @param {number[]} slots
 * @param {Array} categories
 * @param {string} dateLabel already-formatted, e.g. "Friday, August 28"
 * @param {{current:number}|null} [streak] omit to leave the streak line out
 *   entirely — e.g. when sharing a day other than today.
 * @param {Partial<typeof SHARE_LABELS>} [labels] finished strings for the
 *   right-hand column; English is used for anything not supplied.
 */
export function buildShareSvgMarkup(slots, categories, dateLabel, streak = null, labels = {}) {
  const L = { ...SHARE_LABELS, ...labels };
  const W = 1000;
  const H = 560;
  const stats = computeStats(slots, categories);
  const bucket = scoreBucket(stats.score);
  const toneHex = SHARE_TONE_HEX[bucket.tone];
  const scoreText = stats.score === null ? "—" : `${stats.score > 0 ? "+" : ""}${stats.score}`;

  const wedges = computeRuns(slots)
    .map((run) => {
      const a0 = run.start * (360 / SLOTS);
      const a1 = run.end * (360 / SLOTS);
      const gap = Math.min(0.55, (a1 - a0) * 0.3);
      const fill = SHARE_CAT_HEX[run.cat] ?? "#7c8590";
      return `<path d="${wedgePath(R_IN, R_OUT, a0 + gap, a1 - gap)}" fill="${fill}"/>`;
    })
    .join("");

  const ticks = [];
  for (let h = 0; h < 24; h++) {
    const angle = h * 15;
    const major = h % 3 === 0;
    const len = major ? 13 : 6;
    const p1 = polar(R_OUT + 3, angle);
    const p2 = polar(R_OUT + 3 + len, angle);
    ticks.push(
      `<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke="#7c8590" stroke-opacity="0.5"/>`
    );
    if (major) {
      const lp = polar(R_OUT + 3 + len + 12, angle);
      ticks.push(
        `<text x="${lp.x.toFixed(2)}" y="${(lp.y + 4).toFixed(2)}" text-anchor="middle" font-family="monospace" font-size="11" fill="#7c8590">${pad2(h)}</text>`
      );
    }
  }

  const ranked = categories
    .map((c, i) => ({ name: c.name, min: stats.perCat[i] * SLOT_MIN }))
    .filter((r) => r.min > 0)
    .sort((a, b) => b.min - a.min);

  const rightX = 560;
  let y = 90;
  const text = (x, size, weight, fill, str, family = "ui-sans-serif,system-ui,sans-serif") =>
    `<text x="${x}" y="${y}" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${fill}">${escapeXml(str)}</text>`;

  const parts = [text(rightX, 30, 800, "#e7ebee", dateLabel)];
  y += 64;
  parts.push(text(rightX, 54, 700, toneHex, scoreText, "monospace"));
  parts.push(
    `<text x="${rightX + 120}" y="${y - 22}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="14" fill="#aeb6bf">${escapeXml(L.score)}</text>`
  );
  parts.push(
    `<text x="${rightX + 120}" y="${y}" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="700" font-size="15" fill="${toneHex}">${escapeXml(L.bucket)}</text>`
  );
  y += 46;
  if (stats.trackedMin === 0) {
    parts.push(text(rightX, 16, 400, "#e7ebee", L.nothingLogged));
  } else {
    parts.push(text(rightX, 16, 400, "#e7ebee", L.tracked || `${fmtDuration(stats.trackedMin)} tracked · ${stats.productivePct}% productive`));
    y += 30;
    parts.push(text(rightX, 16, 400, "#e7ebee", L.led || `${ranked[0].name} led at ${fmtDuration(ranked[0].min)}`));
  }
  if (streak && streak.current > 0) {
    y += 30;
    parts.push(text(rightX, 16, 400, "#e7ebee", L.streak || `🔥 ${streak.current} day streak`));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" rx="20" fill="#171c24"/>
    <g transform="translate(50,50)">
      <circle cx="230" cy="230" r="154" fill="none" stroke="rgba(231,235,238,0.08)" stroke-width="72"/>
      ${wedges}
      ${ticks.join("")}
    </g>
    ${parts.join("\n    ")}
    <text x="${rightX}" y="${H - 34}" font-family="monospace" font-size="12" fill="#7c8590">Daily Dial · github.com/pranav083/daily-dial-extension</text>
  </svg>`;
}

/* ---------- Google Drive backup (appDataFolder) ---------- */

/**
 * Request/response shaping for Drive v3, kept pure and DOM-free like the
 * rest of this file: no fetch, no chrome.identity — drive.js does the
 * actual network calls and imports these. appDataFolder is Google's own
 * sandboxed per-app storage space, invisible in the user's normal Drive UI
 * and inaccessible to any other app, so this never touches the rest of
 * their Drive.
 */
export const DRIVE_BACKUP_FILENAME = "daily-dial-backup.json";

/** Finds this app's one backup file, if it's ever written one from this
 *  Google account. `trashed=false` so a deleted-then-recreated file doesn't
 *  collide with the trash. */
export function driveListUrl() {
  const q = encodeURIComponent(`name='${DRIVE_BACKUP_FILENAME}' and trashed=false`);
  return `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&pageSize=1`;
}

/** @returns {{id:string, modifiedTime:string}|null} null when this account
 *  has never backed up before. */
export function driveParseListResponse(json) {
  const file = json?.files?.[0];
  return file && typeof file.id === "string" ? { id: file.id, modifiedTime: file.modifiedTime ?? null } : null;
}

/** A known file id updates in place (plain media PATCH); no id means this is
 *  the very first backup from this account, which Drive requires a
 *  multipart create for (metadata + content in one request). */
export function driveUploadUrl(fileId) {
  return fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
}

/** multipart/related body for the first-ever backup from an account: Drive
 *  needs the {name, parents} metadata part and the file content part
 *  together in one request, since there's no file id yet to PATCH. */
export function driveCreateMultipartBody(jsonText, boundary) {
  const metadata = JSON.stringify({ name: DRIVE_BACKUP_FILENAME, parents: ["appDataFolder"] });
  return (
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n${jsonText}\r\n` +
    `--${boundary}--`
  );
}

export function driveDownloadUrl(fileId) {
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
}

/** Permanently removes the backup file itself — not just disconnecting the
 *  account. appDataFolder files don't show up in the user's regular Drive UI
 *  at all, so this DELETE call is the only way to actually get rid of one;
 *  revoking OAuth access alone leaves the file sitting there. */
export function driveDeleteUrl(fileId) {
  return `https://www.googleapis.com/drive/v3/files/${fileId}`;
}

/* ---------- sample data (demo mode) ---------- */

/** Builds one day's slot array from `[startHour, endHour, categoryId]`
 *  segments — fractional hours are fine (`15.5` = 15:30). */
function sampleDay(segments, reflectionKey = "") {
  const slots = new Array(SLOTS).fill(UNTRACKED);
  for (const [startH, endH, cat] of segments) {
    for (let i = Math.round(startH * 4); i < Math.round(endH * 4); i++) slots[i] = cat;
  }
  return { slots, reflectionKey };
}

/**
 * Three realistic, varied weeks ending today — for exploring History,
 * streaks, and goals on a genuinely empty install, before there's any real
 * data to look at. A handful of days are deliberately left unlogged (not
 * every day is a good day, and the heatmap should show that distinction),
 * and scores range from strong to rough rather than all looking the same.
 *
 * Pure and deterministic given `now`, so it's fully unit-testable; dial.js
 * only writes the result to storage and remembers which keys it used.
 *
 * @returns {Map<string, {slots:number[], reflection:string}>}
 */
export function buildSampleDays(now = new Date(), translate = (k) => k) {
  // Category ids: 0 Deep Work, 1 Applications, 2 Study, 3 Admin, 4 Break, 5 Distraction.
  // `offset` is days before today (0 = today); `null` = left unlogged on purpose.
  const plan = [
    { offset: 0, day: sampleDay([[7, 9, 0], [9, 11, 2], [13, 15.5, 1], [16, 18, 0], [18, 19, 4]], "sampleReflectionGoodFocus") },
    { offset: -1, day: sampleDay([[8, 10, 2], [10, 11, 3], [13, 16, 0], [19, 20, 4]]) },
    { offset: -2, day: sampleDay([[9, 10, 3], [14, 15, 1], [20, 22, 5]], "sampleReflectionDistracted") },
    { offset: -3, day: sampleDay([[7, 9, 0], [9, 12, 2], [13, 17, 1]]) },
    { offset: -4, day: sampleDay([[10, 12, 0], [15, 16, 4], [16, 18, 2]]) },
    { offset: -5, day: sampleDay([[9, 11, 1], [11, 12, 3], [20, 21, 5]]) },
    { offset: -6, day: null },
    { offset: -7, day: sampleDay([[8, 10, 0], [10, 13, 2], [14, 16, 1]]) },
    { offset: -8, day: sampleDay([[9, 11, 0], [13, 14, 4], [14, 17, 0]]) },
    { offset: -9, day: sampleDay([[11, 12, 3], [19, 22, 5]], "sampleReflectionRough") },
    { offset: -10, day: sampleDay([[7, 9, 2], [9, 11, 0], [13, 16, 1]]) },
    { offset: -11, day: null },
    { offset: -12, day: sampleDay([[8, 11, 0], [11, 13, 2], [15, 17, 1]]) },
    { offset: -13, day: sampleDay([[10, 12, 1], [14, 15, 4]]) },
    { offset: -14, day: null },
    { offset: -15, day: sampleDay([[7, 10, 0], [10, 12, 2], [13, 17, 1], [18, 19, 4]]) },
    { offset: -16, day: sampleDay([[9, 12, 0], [13, 14, 3]]) },
    { offset: -17, day: sampleDay([[9, 10, 4], [10, 13, 2], [20, 22, 5]]) },
    { offset: -18, day: null },
    { offset: -19, day: sampleDay([[8, 11, 0], [11, 14, 1], [15, 17, 2]]) },
    { offset: -20, day: sampleDay([[9, 11, 2], [13, 16, 0]]) },
  ];

  const days = new Map();
  for (const { offset, day } of plan) {
    if (!day) continue;
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    // The reflections are demo prose the user reads, so they get translated
    // like anything else — but they are written into storage as finished
    // text, because from the moment sample data lands it is an ordinary day
    // the user can edit. `translate` defaults to identity so tests, which
    // care about slots rather than wording, need not supply one.
    days.set(dateKey(d), { slots: day.slots, reflection: day.reflectionKey ? translate(day.reflectionKey) : "" });
  }
  return days;
}
