/**
 * Daily Dial — page controller.
 *
 * Owns the DOM and chrome.storage; all calculation lives in lib.js.
 *
 * Storage note: chrome.storage is async but the dial redraws on every pointer
 * move, so reads must be synchronous. Everything is loaded into `days` once at
 * boot; reads hit that map, writes update it and persist in the background.
 */

import {
  LANGUAGE_KEY,
  SUPPORTED_LANGUAGES,
  applyDocumentDirection,
  dateFmt,
  fmtFullDate,
  initDurationUnits,
  shortWeekdayNames,
  storedLanguage,
  t,
  tm,
  tp,
} from "./i18n.js";
export { t };

import { SILENCED_KEY } from "./suggestions.js";
import {
  CATEGORIES_KEY,
  DAY_PREFIX,
  DEFAULT_CATEGORIES,
  DRIVE_FILE_ID_KEY,
  DRIVE_LAST_SYNC_KEY,
  DRIVE_BACKUP_SIZE_KEY,
  DRIVE_ACCOUNT_EMAIL_KEY,
  fmtBytes,
  ONBOARDING_SEEN_KEY,
  R_IN,
  R_OUT,
  SAMPLE_DAY_KEYS_KEY,
  SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  SETTINGS_KEY,
  SLOTS,
  SLOT_MIN,
  UNTRACKED,
  WEIGHT_GLYPH,
  angleAt,
  buildBackup,
  excludeDays,
  buildCsv,
  buildInsight,
  buildSampleDays,
  challengeProgress,
  buildShareSvgMarkup,
  computeRuns,
  computeDaySpans,
  noteIndicesForSpan,
  computeStats,
  computeStreak,
  dateKey,
  dateRangeKeys,
  dayHasEntries,
  emptyDay,
  MAX_NOTE_LEN,
  MAX_NOTES_PER_DAY,
  MAX_INTENTS_PER_DAY,
  MAX_TEMPLATES,
  MAX_TEMPLATE_NAME,
  MULTI_DAY_FILL_MAX_DAYS,
  fillRange,
  fillSlotWindow,
  fmtClock,
  fmtDuration,
  goalProgress,
  hmToMinutes,
  isValidTime,
  mergeDayMaps,
  mostRecentWeekStart,
  multiDayFillSlotRange,
  normalizeAliases,
  normalizeCategories,
  normalizeDay,
  normalizeSettings,
  normalizeTemplates,
  pad2,
  parseBackup,
  parseCsv,
  parseTimeEntry,
  personalBests,
  polar,
  runAt,
  sameDay,
  scoreBucket,
  shouldNudgeBackup,
  slotFromAngle,
  summarizeImport,
  summarizeMultiDayFill,
  TEMPLATES_KEY,
  toneVar,
  wedgePath,
  weekPerCatMinutes,
} from "./lib.js";
import { renderHistory } from "./history.js";
import {
  driveConnect,
  driveDeleteBackup,
  driveDisconnect,
  driveDownloadBackup,
  driveFetchAccountEmail,
  driveFindBackupFile,
  driveUploadBackup,
} from "./drive.js";

const $ = (id) => document.getElementById(id);
const isToday = (d) => sameDay(d, new Date());

/* ---------- i18n ----------
   Chrome substitutes __MSG_KEY__ in manifest.json and CSS automatically, but
   never in HTML — dial.html keeps its data-i18n attributes and its English
   text side by side, and applyStaticI18n() below is what actually fills them
   in from _locales/en/messages.json. It has to run before anything else reads
   text out of the DOM, in particular before the dial engines further down
   capture their base aria-label at module-eval time — hence the call right
   here, rather than inside boot(). */

/** Fills every data-i18n(-title|-label|-placeholder) element from the static
 *  markup. Values are looked up once at load; nothing here changes at
 *  runtime, since the app has no in-page language switcher. */
function applyStaticI18n() {
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll("[data-i18n-label]")) el.setAttribute("aria-label", t(el.dataset.i18nLabel));
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
}
// Order matters: the direction and the duration suffixes must be in place
// before any static text is filled in or any duration is formatted, and
// applyStaticI18n() itself has to run before the dial engines below capture
// their base aria-label at module-eval time.
applyDocumentDirection();
initDurationUnits();
applyStaticI18n();

/** @type {Map<string, {slots:number[], reflection:string}>} */
const days = new Map();
let categories = normalizeCategories(null, t);
let settings = normalizeSettings(null);
/** Device-local Google Drive connection bookkeeping — see DRIVE_FILE_ID_KEY. */
let driveFileId = null;
let driveLastSyncAt = null;
let driveBackupSizeBytes = null;
let driveAccountEmail = null;
let silencedObservations = [];
let onboardingSeen = false;
/** Exact date keys the currently-loaded sample data (if any) wrote — see
 *  SAMPLE_DAY_KEYS_KEY. Empty when sample data has never been loaded, or has
 *  already been cleared. */
let sampleDayKeys = [];
/** Saved day templates — painted time only, stamped onto whatever day is on
 *  screen. See TEMPLATES_KEY. */
let templates = [];

/** Remembers whichever pen (a category id, or UNTRACKED for the eraser) was
 *  last active, so the dial opens on the pen actually in use rather than
 *  always defaulting back to category 0. Lives here rather than in lib.js —
 *  it's UI state, not something any calculation reads. */
const lastPenKey = "lastPen";

const state = {
  viewDate: new Date(),
  slots: new Array(SLOTS).fill(UNTRACKED),
  reflection: "",
  activePen: 0,
  reflectTimer: null,
  // Which half the "ampm-toggle" dial layout shows. Starts on whichever half
  // holds the current time; not persisted, so it resets to that each visit.
  toggleHalf: new Date().getHours() < 12 ? "am" : "pm",
};

/* ---------- storage ---------- */

async function loadAll() {
  const all = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(DAY_PREFIX)) days.set(key.slice(DAY_PREFIX.length), normalizeDay(value));
  }
  categories = normalizeCategories(all[CATEGORIES_KEY], t);
  settings = normalizeSettings(all[SETTINGS_KEY]);
  driveFileId = typeof all[DRIVE_FILE_ID_KEY] === "string" ? all[DRIVE_FILE_ID_KEY] : null;
  driveLastSyncAt = Number.isFinite(all[DRIVE_LAST_SYNC_KEY]) ? all[DRIVE_LAST_SYNC_KEY] : null;
  driveBackupSizeBytes = Number.isFinite(all[DRIVE_BACKUP_SIZE_KEY]) ? all[DRIVE_BACKUP_SIZE_KEY] : null;
  driveAccountEmail = typeof all[DRIVE_ACCOUNT_EMAIL_KEY] === "string" ? all[DRIVE_ACCOUNT_EMAIL_KEY] : null;
  silencedObservations = Array.isArray(all[SILENCED_KEY]) ? all[SILENCED_KEY].filter((v) => typeof v === "string") : [];
  // Anyone with logged history already predates this feature entirely —
  // never show a first-run "welcome" to someone mid-way through real use,
  // even though the flag itself was never explicitly set for them.
  onboardingSeen = all[ONBOARDING_SEEN_KEY] === true || days.size > 0;
  sampleDayKeys = Array.isArray(all[SAMPLE_DAY_KEYS_KEY]) ? all[SAMPLE_DAY_KEYS_KEY] : [];
  templates = normalizeTemplates(all[TEMPLATES_KEY]);
  // reconcileActivePen() runs after boot loads this and falls back to the
  // first enabled category (or the eraser) if this one has since been
  // hidden, so no validation is needed here beyond "is it a number".
  if (Number.isInteger(all[lastPenKey])) state.activePen = all[lastPenKey];

  if (all[SCHEMA_VERSION_KEY] !== SCHEMA_VERSION) {
    saveLocal({ [SCHEMA_VERSION_KEY]: SCHEMA_VERSION }).catch(() => {
      // Non-critical bookkeeping; a retry next boot is fine.
    });
  }
}

const getDay = (key) => days.get(key) ?? emptyDay();

/* ---------- stale tab guard ----------
   Everything is read into memory once at load and written back a whole day
   (or a whole settings object) at a time. A second copy of the dial that
   loaded earlier therefore holds a snapshot that predates anything done
   here, and its next write — a stroke, a debounced reflection, even closing
   with a pending note — replaces the newer data outright. Nothing errors:
   the write succeeds, and the losing tab keeps showing work that no longer
   exists anywhere. Two tabs is not exotic either; a restored pinned tab or
   a Ctrl+Shift+T is enough. So once another copy writes, this one stops
   writing entirely rather than trying to merge snapshots it can't
   reconcile. */
let tabIsStale = false;

function markTabStale(what) {
  if (tabIsStale) return;
  tabIsStale = true;
  console.warn("Daily Dial: another tab changed", what, "— editing paused here.");
  $("stale-banner-headline").textContent = t("staleBannerHeadline", [what]);
  $("stale-banner").hidden = false;
  document.body.classList.add("is-stale");
  closeSettings();
}

/**
 * Every value this tab writes, remembered until its own change event comes
 * back. Comparing the event against *live* state instead was wrong: a day's
 * `slots` array is shared by reference with `state.slots`, so painting again
 * before the first event arrived made our own write look foreign and froze
 * the tab mid-edit. Matching against what was actually written has no such
 * race.
 */
const ownWrites = new Map();

const REMOVED = "\u0000removed";

/** Key-order-independent serialization. Plain JSON.stringify would call two
 *  structurally identical objects different if their keys were inserted in a
 *  different order — a difference that means nothing here, and which would
 *  surface as a phantom conflict. */
function stableStringify(v) {
  if (v === undefined) return REMOVED;
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

const serializeValue = stableStringify;

function recordOwnWrite(keys, removal = false) {
  const entries = removal
    ? (Array.isArray(keys) ? keys : [keys]).map((k) => [k, undefined])
    : Object.entries(keys);
  for (const [key, value] of entries) {
    const list = ownWrites.get(key) ?? [];
    list.push(serializeValue(value));
    ownWrites.set(key, list);
  }
}

/** Every write goes through these two so the change event can be recognised
 *  as ours when it echoes back. */
function saveLocal(obj) {
  recordOwnWrite(obj);
  return chrome.storage.local.set(obj);
}

function removeLocal(keys) {
  recordOwnWrite(keys, true);
  return chrome.storage.local.remove(keys);
}

/** True when this change is one of our own writes echoing back. Consumes the
 *  match, along with anything staler for that key — events arrive in write
 *  order, so earlier entries will never be matched now. */
function isOwnWrite(key, newValue) {
  const list = ownWrites.get(key);
  if (!list) return false;
  const i = list.indexOf(serializeValue(newValue));
  if (i === -1) return false;
  list.splice(0, i + 1);
  if (list.length === 0) ownWrites.delete(key);
  return true;
}

/** Whether our in-memory copy already agrees with what landed. A second
 *  signal on top of the write log: if the value matches what we hold, there
 *  is nothing to lose regardless of who wrote it, so it can never be worth
 *  freezing over. */
function alreadyMatchesMemory(key, newValue) {
  let mine;
  if (key.startsWith(DAY_PREFIX)) mine = days.get(key.slice(DAY_PREFIX.length));
  else if (key === CATEGORIES_KEY) mine = categories.map(({ name, weight, enabled, aliases }) => ({ name, weight, enabled, aliases }));
  else if (key === SETTINGS_KEY) mine = settings;
  else if (key === SAMPLE_DAY_KEYS_KEY) mine = sampleDayKeys;
  else if (key === TEMPLATES_KEY) mine = templates;
  else return false;
  return serializeValue(newValue) === serializeValue(mine);
}

/**
 * Freezing on *any* write from elsewhere was far too blunt: it stopped the
 * tab over changes that couldn't cost anything, and any write path that
 * slipped past the log froze a perfectly healthy tab mid-edit.
 *
 * Only a few things can actually be lost here, because they're the only
 * things this tab writes wholesale: the day currently on screen, and the
 * shared settings/categories/templates. A change to any *other* day is
 * simply adopted — two tabs sitting on different days now work rather than
 * fighting.
 */
function onStorageChanged(changes, area) {
  if (area !== "local" || tabIsStale) return;
  const viewedKey = DAY_PREFIX + dateKey(state.viewDate);
  let adopted = false;
  let conflict = null;

  for (const [key, { newValue }] of Object.entries(changes)) {
    if (isOwnWrite(key, newValue) || alreadyMatchesMemory(key, newValue)) continue;

    if (key.startsWith(DAY_PREFIX)) {
      if (key === viewedKey) {
        conflict = t("staleWhatViewedDay");
        continue;
      }
      const dayKey = key.slice(DAY_PREFIX.length);
      if (newValue === undefined) days.delete(dayKey);
      else days.set(dayKey, normalizeDay(newValue));
      adopted = true;
      continue;
    }
    if (key === CATEGORIES_KEY) conflict = t("staleWhatCategories");
    else if (key === SETTINGS_KEY) conflict = t("staleWhatSettings");
    else if (key === SAMPLE_DAY_KEYS_KEY) conflict = t("staleWhatDemoMode");
    else if (key === TEMPLATES_KEY) conflict = t("staleWhatTemplates");
    // Anything else is bookkeeping this tab can't clobber — ignore it.
  }

  if (adopted && !conflict) {
    renderStrip();
    renderStreak();
    renderAboutBests();
    refreshCurrentView();
  }
  if (conflict) markTabStale(conflict);
}

function watchForOtherTabs() {
  chrome.storage.onChanged.addListener(onStorageChanged);
}

function persistDay() {
  if (tabIsStale) return;
  const key = dateKey(state.viewDate);
  const data = {
    slots: state.slots,
    reflection: state.reflection,
    notes: state.notes ?? [],
    intents: state.intents ?? [],
    avoid: state.avoid ?? [],
  };
  const wasEmpty = days.size === 0;
  days.set(key, data);
  saveLocal({ [DAY_PREFIX + key]: data }).catch(reportStorageFailure);
  // Editing a demo day makes it yours. Without this it stays on the sample
  // list, and leaving demo mode would delete the day you just worked on.
  const sampleIdx = sampleDayKeys.indexOf(key);
  if (sampleIdx !== -1) {
    sampleDayKeys.splice(sampleIdx, 1);
    saveLocal({ [SAMPLE_DAY_KEYS_KEY]: sampleDayKeys }).catch(reportStorageFailure);
    renderSampleDataUI();
  }
  // The first block painted is when the hint stops being true. Only re-check
  // while it's actually on screen, so the common case stays a cheap boolean
  // read instead of a scan of every day on every commit.
  if (wasEmpty || !$("first-run-hint").hidden) renderFirstRunHint();
}

const persistCategories = () =>
  tabIsStale
    ? undefined
    : saveLocal({ [CATEGORIES_KEY]: categories.map(({ name, weight, enabled, aliases }) => ({ name, weight, enabled, aliases })) })
        .catch(reportStorageFailure);

const persistSettings = () =>
  tabIsStale ? undefined : saveLocal({ [SETTINGS_KEY]: settings }).catch(reportStorageFailure);

const persistTemplates = () =>
  tabIsStale ? undefined : saveLocal({ [TEMPLATES_KEY]: templates }).catch(reportStorageFailure);

/** Losing this write costs nothing worse than opening on the default pen
 *  next time, so it's fire-and-forget rather than routed through
 *  reportStorageFailure like the persistors above. */
const persistActivePen = () =>
  tabIsStale
    ? undefined
    : saveLocal({ [lastPenKey]: state.activePen }).catch(() => {});

function reportStorageFailure(err) {
  console.error("Daily Dial: could not save", err);
  toast(t("saveFailedToast"));
}

/* ---------- theme ---------- */

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === "light" || settings.theme === "dark") root.dataset.theme = settings.theme;
  else delete root.dataset.theme;
}

/* ---------- SVG scaffolding ---------- */

const NS = "http://www.w3.org/2000/svg";
const tooltip = $("tooltip");

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Static hour ticks for one dial face. Ticks never depend on painted data,
 *  so this runs once at boot for each physical SVG, not on every render. */
function renderTicksInto(tickLayer, hourCount, labelFor) {
  tickLayer.replaceChildren();
  for (let h = 0; h < hourCount; h++) {
    const angle = (h / hourCount) * 360;
    const major = hourCount <= 12 || h % 3 === 0;
    const len = major ? 13 : 6;
    const p1 = polar(R_OUT + 3, angle);
    const p2 = polar(R_OUT + 3 + len, angle);
    tickLayer.appendChild(
      svgEl("line", {
        class: "tick-line",
        x1: p1.x.toFixed(2), y1: p1.y.toFixed(2),
        x2: p2.x.toFixed(2), y2: p2.y.toFixed(2),
      })
    );
    if (major) {
      const lp = polar(R_OUT + 3 + len + 12, angle);
      const label = svgEl("text", {
        class: "tick-label",
        x: lp.x.toFixed(2), y: (lp.y + 4).toFixed(2),
        "text-anchor": "middle",
      });
      label.textContent = labelFor(h);
      tickLayer.appendChild(label);
    }
  }
}

/** Hairline gap between adjacent wedges so neighbouring blocks stay distinct. */
const WEDGE_GAP_DEG = 0.55;

/* ---------- tooltip ---------- */

const fmtSlotClock = (i) => fmtClock(i, settings.timeFormat);

/** "09:00–11:15 · Deep Work · 2h 15m" for whatever block covers `idx`. */
function describeSlot(idx) {
  const run = runAt(state.slots, idx);
  const [start, end, name] = run
    ? [run.start, run.end, categories[run.cat].name]
    : [idx, idx + 1, t("untrackedLower")];
  return `${fmtSlotClock(start)}–${fmtSlotClock(end)}  ·  ${name}  ·  ${fmtDuration((end - start) * SLOT_MIN)}`;
}

function showTooltipText(evt, text) {
  tooltip.textContent = text;
  tooltip.classList.add("show");
  tooltip.style.left = `${evt.clientX}px`;
  tooltip.style.top = `${evt.clientY}px`;
}

function showTooltip(evt, idx) {
  showTooltipText(evt, describeSlot(idx));
}

/** Speaks to screen readers. Painting and score changes were previously
 *  silent: the toast is the app's only live region and it fires for
 *  messages, never for the edit itself. */
function announce(message) {
  $("dial-live").textContent = message;
}

/** A readable summary of the whole day, kept on each dial's own label so
 *  the timeline is enumerable rather than an unlabelled shape. */
function dayLabelText(base, from, count) {
  const runs = computeRuns(state.slots).filter((r) => r.end > from && r.start < from + count);
  if (runs.length === 0) return `${base} ${t("dialAriaNothingLoggedSuffix")}`;
  const parts = runs.map(
    (r) => t("dialAriaRangePart", [fmtSlotClock(r.start), fmtSlotClock(r.end), categories[r.cat].name])
  );
  return `${base} ${parts.join(", ")}.`;
}

const hideTooltip = () => tooltip.classList.remove("show");

/* ---------- undo / redo ---------- */

/**
 * One stack per day, rather than one shared stack filtered by date.
 *
 * The shared stack popped entries until it found one for the current day —
 * so painting Monday, switching to Tuesday and painting, then coming back to
 * Monday and pressing undo discarded the Tuesday entry on the way past. The
 * stroke was still on screen but no longer undoable, with nothing said about
 * it. Keyed stacks leave each day's history alone.
 */
const undoStacks = new Map();
const redoStacks = new Map();
const UNDO_LIMIT = 30;

const stackFor = (map, key) => {
  if (!map.has(key)) map.set(key, []);
  return map.get(key);
};

function pushUndo() {
  const key = dateKey(state.viewDate);
  const stack = stackFor(undoStacks, key);
  stack.push([...state.slots]);
  if (stack.length > UNDO_LIMIT) stack.shift();
  redoStacks.delete(key); // a new stroke ends this day's redo line
}

function stepHistory(fromMap, toMap, doneWord, emptyWord) {
  const key = dateKey(state.viewDate);
  const from = stackFor(fromMap, key);
  const slots = from.pop();
  if (!slots) {
    toast(emptyWord);
    return;
  }
  const to = stackFor(toMap, key);
  to.push([...state.slots]);
  if (to.length > UNDO_LIMIT) to.shift();
  state.slots = slots;
  persistDay();
  renderAll();
  toast(doneWord);
}

const undo = () => stepHistory(undoStacks, redoStacks, t("undoDone"), t("undoEmpty"));
const redo = () => stepHistory(redoStacks, undoStacks, t("redoDone"), t("redoEmpty"));

/* ---------- painting ---------- */

/** Runs once when any dial's pointer gesture ends, regardless of which
 *  physical SVG (or which half, in AM/PM mode) it happened on — the data is
 *  already written into state.slots by then. */
function onStrokeEnd() {
  persistDay();
  renderSide();
  renderStrip();
  renderStreak();
  renderBackupStatus();
  // The breakdown is a view of the slots just painted and sits directly
  // below the dial, so leaving it until the next full redraw meant painting
  // a block and watching the table under it not change.
  renderBreakdown();
}

/**
 * One engine drives one physical SVG. `slotOffset`/`slotsInView` define the
 * window into state.slots it reads and paints: the whole day (0, 96) for the
 * single 24-hour dial, or one 12-hour half (0, 48) / (48, 48) in AM/PM mode.
 * Geometry (CX/CY/R_IN/R_OUT) is identical across every dial — each SVG is
 * its own 460×460 coordinate space, just displayed at a different size — so
 * the only thing that differs between instances is which slots they own.
 */
function createDialEngine({ svgId, segId, needleId, centerTimeId, centerSubId, slotOffset, slotsInView }) {
  const svgNode = $(svgId);
  const segLayer = $(segId);
  const needleLayer = $(needleId);
  const centerTimeEl = $(centerTimeId);
  const centerSubEl = $(centerSubId);
  const minutesInView = slotsInView * SLOT_MIN;
  // Added last so the seam handle draws above the wedges and the needle.
  const handleLayer = svgEl("g", { class: "edge-layer" });
  svgNode.appendChild(handleLayer);
  const caretLayer = svgEl("g", { class: "caret-layer" });
  svgNode.appendChild(caretLayer);
  const noteLayer = svgEl("g", { class: "note-layer" });
  svgNode.appendChild(noteLayer);
  const baseLabel = svgNode.getAttribute("aria-label");

  let isPaintingLocal = false;
  let lastLocal = null;
  let strokeFrom = null;

  const localSlice = () => state.slots.slice(slotOffset, slotOffset + slotsInView);
  const writeSlice = (sub) => {
    for (let i = 0; i < slotsInView; i++) state.slots[slotOffset + i] = sub[i];
  };

  /* ---- edge dragging ----
     Repainting was the only way to change where one block ended and the next
     began, and starting that stroke a slot early silently ate into the block
     you meant to keep. Grabbing the seam between two blocks moves just that
     seam: one side gives up exactly what the other takes, and no third block
     is touched. */

  /** How close (in slots) the cursor must be to a seam to grab it. ~7 min. */
  const EDGE_GRAB = 0.45;

  /** Where the cursor sits in slot space, unrounded — seams live at integers. */
  const fractionalSlot = (angle) => (angle / 360) * slotsInView;

  let dragEdge = null;

  /** The seam nearest the cursor, or null if none is within grabbing range. */
  function edgeNear(angle) {
    const f = fractionalSlot(angle);
    const sub = localSlice();
    let best = null;
    for (let i = 1; i < slotsInView; i++) {
      if (sub[i] === sub[i - 1]) continue;
      const dist = Math.abs(f - i);
      if (dist <= EDGE_GRAB && (best === null || dist < best.dist)) best = { index: i, dist };
    }
    return best;
  }

  /** The span the two blocks either side of a seam occupy, so a drag can
   *  collapse one of them but never reach past into a third. */
  function edgeSpan(sub, index) {
    const left = sub[index - 1];
    const right = sub[index];
    let from = index - 1;
    while (from > 0 && sub[from - 1] === left) from--;
    let to = index;
    while (to < slotsInView - 1 && sub[to + 1] === right) to++;
    return { left, right, from, to: to + 1 };
  }

  const nameOf = (cat) => (cat === UNTRACKED ? t("untrackedLower") : categories[cat].name);

  /** Both sides of the seam at once — the point is seeing the trade. */
  function edgeTooltipText(at) {
    const g = (i) => fmtSlotClock(slotOffset + i);
    const { from, to, left, right } = dragEdge;
    const leftPart = at > from ? t("edgeRangeLabel", [g(from), g(at), nameOf(left)]) : t("edgeGoneLabel", [nameOf(left)]);
    const rightPart = at < to ? t("edgeRangeLabel", [g(at), g(to), nameOf(right)]) : t("edgeGoneLabel", [nameOf(right)]);
    return `${leftPart}   |   ${rightPart}`;
  }

  /** A tick outside the ring wherever a note is pinned. */
  function renderNoteMarks() {
    noteLayer.replaceChildren();
    for (const note of state.notes ?? []) {
      const from = note.from - slotOffset;
      const to = note.to - slotOffset;
      if (to <= 0 || from >= slotsInView) continue;
      const per = 360 / slotsInView;
      const a0 = Math.max(0, from) * per;
      const a1 = Math.min(slotsInView, to) * per;
      noteLayer.appendChild(
        svgEl("path", { class: "note-mark", d: wedgePath(R_OUT + 5, R_OUT + 8, a0, a1) })
      );
    }
  }

  function renderEdgeHandle(index) {
    handleLayer.replaceChildren();
    if (index === null) return;
    const angle = index * (360 / slotsInView);
    const p1 = polar(R_IN - 6, angle);
    const p2 = polar(R_OUT + 6, angle);
    handleLayer.appendChild(
      svgEl("line", {
        class: "edge-handle",
        x1: p1.x.toFixed(2), y1: p1.y.toFixed(2),
        x2: p2.x.toFixed(2), y2: p2.y.toFixed(2),
      })
    );
  }

  /* ---- keyboard painting ----
     The dial was pointer-only: no tabindex, no key handling, so anyone who
     can't use a mouse could not log time at all. Typed entry was the only
     way in, and it can't erase — so the only way to remove a wrong block
     was to wipe the whole day. This gives the ring a cursor: arrows move
     it, Shift+arrows extend a selection, Enter paints it with the active
     pen, Delete clears it. It reuses the same fillRange/onStrokeEnd path
     the pointer uses, so the two can't drift apart. */

  let caret = null;      // slot the cursor sits on, local to this view
  let caretAnchor = null; // where a Shift-selection started

  /**
   * The cursor wraps rather than stopping at midnight: the ring is a circle,
   * so hitting an invisible wall at the top read as the cursor being stuck.
   * Arrows now run round and round in either direction.
   *
   * A wrapped selection is expressed as a start plus a length rather than
   * from/to, since `to` can be less than `from` once it crosses the top.
   * Which way round a Shift-selection goes is decided the same way the mouse
   * decides it — the shorter arc — so both input methods behave alike.
   */
  function caretRange() {
    if (caret === null) return null;
    const anchor = caretAnchor ?? caret;
    const n = slotsInView;
    const forward = (caret - anchor + n) % n;
    const backward = (anchor - caret + n) % n;
    return forward <= backward
      ? { from: anchor, len: forward + 1 }
      : { from: caret, len: backward + 1 };
  }

  const rangeSlots = (range) =>
    Array.from({ length: range.len }, (_, k) => (range.from + k) % slotsInView);

  function renderCaret() {
    caretLayer.replaceChildren();
    const range = caretRange();
    if (range === null) return;
    const per = 360 / slotsInView;
    const end = range.from + range.len;
    // Drawn as two arcs when it crosses the top, since one path can't.
    const spans = end <= slotsInView
      ? [[range.from, end]]
      : [[range.from, slotsInView], [0, end - slotsInView]];
    for (const [a, b] of spans) {
      caretLayer.appendChild(
        svgEl("path", { class: "caret-band", d: wedgePath(R_IN - 3, R_OUT + 3, a * per, b * per) })
      );
    }
  }

  function announceCaret() {
    const range = caretRange();
    if (!range) return;
    const g = (i) => fmtSlotClock(slotOffset + (i % slotsInView));
    const sub = localSlice();
    const slots = rangeSlots(range);
    const cat = sub[slots[0]];
    const what = slots.every((i) => sub[i] === cat) ? nameOf(cat) : t("caretMixedLabel");
    announce(t("caretAnnounce", [g(range.from), g(range.from + range.len), what]));
  }

  function moveCaret(delta, extend) {
    const n = slotsInView;
    if (caret === null) caret = n > 48 ? 32 : 0; // 08:00 on the full ring
    else caret = ((caret + delta) % n + n) % n;
    if (!extend) caretAnchor = caret;
    else if (caretAnchor === null) caretAnchor = caret;
    renderCaret();
    announceCaret();
  }

  function commitCaret(cat) {
    const range = caretRange();
    if (!range) return;
    if (tabIsStale) return;
    checkDayRollover();
    pushUndo();
    const sub = localSlice();
    let skipped = 0;
    for (const i of rangeSlots(range)) {
      if (cat !== UNTRACKED && isFutureSlot(slotOffset + i)) { skipped++; continue; }
      sub[i] = cat;
    }
    writeSlice(sub);
    if (skipped) toast(t("futureNotLogged"));
    render();
    renderCaret();
    onStrokeEnd();
    const g = (i) => fmtSlotClock(slotOffset + (i % slotsInView));
    announce(t("caretCommitAnnounce", [nameOf(cat), g(range.from), g(range.from + range.len)]));
  }

  svgNode.addEventListener("focus", () => {
    // Only for keyboard focus. Clicking the ring focuses it too, and showing
    // the cursor then put a stray box on the dial during ordinary painting.
    if (!svgNode.matches(":focus-visible")) return;
    if (caret === null) moveCaret(0, false);
    else renderCaret();
  });
  // A click means the pointer is driving; retire the cursor until a key is
  // pressed again.
  svgNode.addEventListener("pointerdown", () => caretLayer.replaceChildren());
  svgNode.addEventListener("blur", () => {
    caretLayer.replaceChildren();
  });

  svgNode.addEventListener("keydown", (evt) => {
    if (caretLayer.childElementCount === 0 && caret !== null) renderCaret();
    const step = evt.key === "ArrowRight" || evt.key === "ArrowDown" ? 1
      : evt.key === "ArrowLeft" || evt.key === "ArrowUp" ? -1
        : 0;
    if (step !== 0) {
      evt.preventDefault();
      moveCaret(caret === null ? 0 : step * (evt.altKey ? 4 : 1), evt.shiftKey);
      return;
    }
    if (evt.key === "Home" || evt.key === "End") {
      evt.preventDefault();
      caret = evt.key === "Home" ? 0 : slotsInView - 1;
      if (!evt.shiftKey) caretAnchor = caret;
      renderCaret();
      announceCaret();
      return;
    }
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      commitCaret(state.activePen === null ? UNTRACKED : state.activePen);
      return;
    }
    if (evt.key === "Delete" || evt.key === "Backspace") {
      evt.preventDefault();
      commitCaret(UNTRACKED);
    }
  });

  function renderSegments() {
    segLayer.replaceChildren();
    for (const run of computeRuns(localSlice())) {
      const a0 = run.start * (360 / slotsInView);
      const a1 = run.end * (360 / slotsInView);
      const gap = Math.min(WEDGE_GAP_DEG, (a1 - a0) * 0.3);
      segLayer.appendChild(
        svgEl("path", {
          class: `seg ${categories[run.cat].cls}`,
          d: wedgePath(R_IN, R_OUT, a0 + gap, a1 - gap),
        })
      );
    }
  }

  /** Minutes into this window if wall-clock "now" falls inside it, else null.
   *  Independent of which day is being viewed — same as the single 24-hour
   *  dial's centre clock always having read live regardless of viewDate.
   *  Shared by the needle (which additionally only draws on today) and the
   *  centre clock (so the PM face doesn't also claim "10:30am" just because
   *  its AM twin does). */
  function nowLocalMinutes() {
    const now = new Date();
    const localMin = now.getHours() * 60 + now.getMinutes() - slotOffset * SLOT_MIN;
    return localMin >= 0 && localMin < minutesInView ? localMin : null;
  }

  function renderNeedle() {
    needleLayer.replaceChildren();
    if (!isToday(state.viewDate)) return;
    const localMin = nowLocalMinutes();
    if (localMin === null) return;
    const angle = (localMin / minutesInView) * 360;
    const p1 = polar(R_IN - 8, angle);
    const p2 = polar(R_OUT + 10, angle);
    needleLayer.appendChild(
      svgEl("line", {
        class: "needle-line",
        x1: p1.x.toFixed(2), y1: p1.y.toFixed(2),
        x2: p2.x.toFixed(2), y2: p2.y.toFixed(2),
      })
    );
    needleLayer.appendChild(svgEl("circle", { class: "needle-dot", cx: p2.x.toFixed(2), cy: p2.y.toFixed(2), r: 4 }));
  }

  function renderCenter() {
    const localMin = nowLocalMinutes();
    const now = new Date();
    // Only the half actually containing "now" gets a live clock reading —
    // the other one isn't 10:30am just because this half's twin is. It used
    // to show a dead "--:--"; its own logged total is far more useful there,
    // and it ticks up live as you paint into that half.
    if (localMin === null) {
      const trackedMin = localSlice().reduce((n, v) => n + (v !== UNTRACKED ? 1 : 0), 0) * SLOT_MIN;
      centerTimeEl.textContent = fmtDuration(trackedMin);
      centerTimeEl.title = t("dialTimeLoggedTooltip");
    } else {
      centerTimeEl.textContent = fmtClock(
        Math.round((now.getHours() * 60 + now.getMinutes()) / SLOT_MIN),
        settings.timeFormat
      );
      centerTimeEl.title = t("dialCurrentTimeTooltip");
    }
    const pen = categories[state.activePen];
    centerSubEl.textContent = pen ? t("dialPenLabel", [pen.name]) : t("dialEraserLabel");
  }

  function render() {
    renderSegments();
    renderNoteMarks();
    renderNeedle();
    renderCenter();
    svgNode.setAttribute("aria-label", dayLabelText(baseLabel, slotOffset, slotsInView));
  }

  function svgPointFromEvent(evt) {
    const pt = svgNode.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svgNode.getScreenCTM().inverse());
  }

  function paintAtLocal(localIdx) {
    const cat = state.activePen === null ? UNTRACKED : state.activePen;
    // Erasing the future is always fine — it can only remove something that
    // shouldn't be there. Painting it is what gets refused.
    const paintable = (local) => cat === UNTRACKED || !isFutureSlot(slotOffset + local);

    if (lastLocal === null) {
      if (!paintable(localIdx)) return;
      const sub = localSlice();
      sub[localIdx] = cat;
      writeSlice(sub);
    } else {
      const filled = fillRange(localSlice(), lastLocal, localIdx, cat);
      const sub = localSlice();
      // Keep only the part of the stroke that has already happened, rather
      // than rejecting the whole drag — dragging across "now" should paint
      // up to it, not do nothing.
      for (let i = 0; i < slotsInView; i++) if (paintable(i)) sub[i] = filled[i];
      writeSlice(sub);
    }
    lastLocal = localIdx;
  }

  function endPaintLocal() {
    if (dragEdge) {
      dragEdge = null;
      renderEdgeHandle(null);
      onStrokeEnd();
      return;
    }
    if (!isPaintingLocal) return;
    isPaintingLocal = false;
    if (strokeFrom !== null && lastLocal !== null) {
      const a = Math.min(strokeFrom, lastLocal);
      const b = Math.max(strokeFrom, lastLocal) + 1;
      showJustPainted(slotOffset + a, slotOffset + b);
    }
    lastLocal = null;
    onStrokeEnd();
  }

  svgNode.addEventListener("pointerdown", (evt) => {
    if (evt.button !== 0) return;
    const p = svgPointFromEvent(evt);
    const { angle, dist } = angleAt(p.x, p.y);
    if (dist < R_IN - 14 || dist > R_OUT + 18) return;

    // Checked here as well as on the 30s tick: a stroke started inside that
    // window would otherwise still be written against yesterday's date.
    checkDayRollover();

    // A seam under the cursor means "adjust this edge", not "paint over it".
    const edge = edgeNear(angle);
    if (edge) {
      pushUndo();
      const sub = localSlice();
      dragEdge = { base: sub, at: edge.index, ...edgeSpan(sub, edge.index) };
      try {
        svgNode.setPointerCapture(evt.pointerId);
      } catch {
        // Synthetic pointers can't be captured; dragging still works.
      }
      renderEdgeHandle(edge.index);
      showTooltipText(evt, edgeTooltipText(edge.index));
      return;
    }

    pushUndo();
    isPaintingLocal = true;
    lastLocal = null;
    try {
      svgNode.setPointerCapture(evt.pointerId);
    } catch {
      // Synthetic or already-released pointers can't be captured; painting still works.
    }
    const idx = slotFromAngle(angle, slotsInView);
    strokeFrom = idx;
    paintAtLocal(idx);
    render();
    showTooltip(evt, slotOffset + idx);
  });

  svgNode.addEventListener("pointermove", (evt) => {
    const p = svgPointFromEvent(evt);
    const { angle, dist } = angleAt(p.x, p.y);

    if (dragEdge) {
      // Clamped to the two blocks involved: either can be squeezed to nothing,
      // but neither can push past into whatever lies beyond.
      const at = Math.max(dragEdge.from, Math.min(dragEdge.to, Math.round(fractionalSlot(angle))));
      const sub = [...dragEdge.base];
      for (let i = dragEdge.from; i < at; i++) sub[i] = dragEdge.left;
      for (let i = at; i < dragEdge.to; i++) sub[i] = dragEdge.right;
      writeSlice(sub);
      dragEdge.at = at;
      render();
      renderEdgeHandle(at);
      showTooltipText(evt, edgeTooltipText(at));
      return;
    }

    if (dist < R_IN - 30 || dist > R_OUT + 40) {
      hideTooltip();
      svgNode.classList.remove("edge-grab");
      renderEdgeHandle(null);
      return;
    }
    const idx = slotFromAngle(angle, slotsInView);
    if (isPaintingLocal) {
      paintAtLocal(idx);
      render();
    } else {
      // Surface the seam under the cursor so the affordance is discoverable
      // rather than something you have to already know about.
      const edge = edgeNear(angle);
      svgNode.classList.toggle("edge-grab", Boolean(edge));
      renderEdgeHandle(edge ? edge.index : null);
    }
    showTooltip(evt, slotOffset + idx);
  });

  svgNode.addEventListener("pointerup", endPaintLocal);
  svgNode.addEventListener("pointercancel", endPaintLocal);
  window.addEventListener("pointerup", endPaintLocal);
  svgNode.addEventListener("pointerleave", () => {
    hideTooltip();
    if (!dragEdge) {
      svgNode.classList.remove("edge-grab");
      renderEdgeHandle(null);
    }
  });

  return { render, renderSegments, renderNeedle, renderCenter };
}

const dialEngines = {
  single: createDialEngine({
    svgId: "dial", segId: "segments", needleId: "needle",
    centerTimeId: "center-time", centerSubId: "center-sub",
    slotOffset: 0, slotsInView: SLOTS,
  }),
  am: createDialEngine({
    svgId: "dial-am", segId: "segments-am", needleId: "needle-am",
    centerTimeId: "center-time-am", centerSubId: "center-sub-am",
    slotOffset: 0, slotsInView: SLOTS / 2,
  }),
  pm: createDialEngine({
    svgId: "dial-pm", segId: "segments-pm", needleId: "needle-pm",
    centerTimeId: "center-time-pm", centerSubId: "center-sub-pm",
    slotOffset: SLOTS / 2, slotsInView: SLOTS / 2,
  }),
};

/** "ampm" (both halves side by side) and "ampm-toggle" (one half at a time,
 *  switched manually) share the same pair of engines and DOM — the toggle
 *  variant just hides whichever half isn't selected. */
const isTwinLayout = (mode) => mode === "ampm" || mode === "ampm-toggle";

const activeEngines = () => (isTwinLayout(settings.dialMode) ? [dialEngines.am, dialEngines.pm] : [dialEngines.single]);

function renderDial() {
  for (const engine of activeEngines()) engine.render();
}

/** The pen name shown in the middle of the dial(s) — refreshed on its own
 *  when only the active pen changed, without redrawing segments/needle. */
function refreshCenters() {
  for (const engine of activeEngines()) engine.renderCenter();
}

/**
 * Points the active pen somewhere real. `activePen` defaults to category 0
 * and was only ever reconciled when a category was hidden *during* the
 * session — so hiding category 0 and reloading left the pen row with nothing
 * marked active while the dial centre still read "pen: Deep Work", and the
 * first stroke painted a category that isn't in the pen row and whose
 * keyboard shortcut is refused. Falls back to the first enabled category, or
 * the eraser if every category is hidden.
 */
function reconcileActivePen() {
  if (state.activePen === UNTRACKED) return;
  if (categories[state.activePen]?.enabled) return;
  const firstEnabled = categories.find((c) => c.enabled);
  state.activePen = firstEnabled ? firstEnabled.id : UNTRACKED;
}

/**
 * How much of today has actually happened, as a slot count.
 *
 * Painting ahead records time that hasn't occurred — it inflates the day's
 * tracked total, its score, and the streak, all from something imagined.
 * Forward day navigation was stopped for the same reason; this is the same
 * rule applied within a day.
 */
function nowSlotLimit() {
  const now = new Date();
  return Math.min(SLOTS, Math.floor((now.getHours() * 60 + now.getMinutes()) / SLOT_MIN) + 1);
}

/** The first slot that can't be painted on the day currently on screen.
 *  Past days are wide open — there, every slot has happened. */
function firstUnpaintableSlot() {
  return isToday(state.viewDate) ? nowSlotLimit() : SLOTS;
}

/**
 * The same rule for a day named by key rather than the one on screen — the
 * multi-day fill and the templates write to days they aren't showing, and
 * without this each one would need to re-derive "has this happened yet".
 * Date keys are `YYYY-MM-DD`, so they compare correctly as strings.
 */
function writeLimitForKey(key) {
  const today = dateKey(new Date());
  if (key < today) return SLOTS;
  if (key > today) return 0; // the whole day is still ahead
  return nowSlotLimit();
}

/** True when a slot is in the future on the day being viewed. */
const isFutureSlot = (globalSlot) => globalSlot >= firstUnpaintableSlot();

/**
 * Stamps a whole day's worth of slots onto the day on screen, keeping only
 * the part that has already happened. Shared by "copy yesterday" and the
 * templates: both describe a full 24 hours, but on today only the elapsed
 * part of that description can be true. Anything beyond now is left as it
 * was rather than overwritten, so the stamp adds without erasing forward.
 * @returns {number} slots dropped, for the caller to mention
 */
function stampSlots(next) {
  const limit = firstUnpaintableSlot();
  for (let i = 0; i < limit; i++) state.slots[i] = next[i];
  return SLOTS - limit;
}

/** The clock-face upkeep a 30-second timer does: move the needle, refresh
 *  the centre time. No data changed, so segments are left alone. */
function refreshLive() {
  checkDayRollover();
  for (const engine of activeEngines()) {
    engine.renderNeedle();
    engine.renderCenter();
  }
}

/** The date the app currently believes "today" is. */
let todayKey = dateKey(new Date());

/**
 * `state.viewDate` was captured once at boot and only ever moved by explicit
 * navigation, so a tab left open across midnight kept writing to yesterday —
 * paint 00:20 and it silently overwrote the previous day's early morning,
 * while the header still read "Today" and the streak never saw the entry.
 * Rolls the view forward only for someone actually sitting on today; anyone
 * who navigated to a past day deliberately keeps their place.
 */
function checkDayRollover() {
  const nowKey = dateKey(new Date());
  if (nowKey === todayKey) return;
  const wasOnToday = dateKey(state.viewDate) === todayKey;
  todayKey = nowKey;
  if (wasOnToday) {
    switchDay(new Date());
    toast(t("dayRolledOverToast"));
  }
  // Date-dependent chrome is stale either way.
  renderDateLabel();
  renderStrip();
  renderStreak();
  renderBackupStatus();
}

/** In "ampm-toggle" mode, shows only state.toggleHalf and hides the other —
 *  both engines still render (cheap), just one half is visually hidden. */
function applyToggleVisibility() {
  const isToggle = settings.dialMode === "ampm-toggle";
  // A class, not `hidden`: the switch must keep its space in the header so
  // that showing it never reflows the row and shifts the dial downward.
  $("dial-toggle-switch").classList.toggle("inactive", !isToggle);
  $("dial-wrap-twin").classList.toggle("toggle-mode", isToggle);
  $("dial-half-am").hidden = isToggle && state.toggleHalf !== "am";
  $("dial-half-pm").hidden = isToggle && state.toggleHalf !== "pm";
  if (!isToggle) return;
  $("toggle-am-btn").classList.toggle("active", state.toggleHalf === "am");
  $("toggle-pm-btn").classList.toggle("active", state.toggleHalf === "pm");
  $("toggle-am-btn").setAttribute("aria-pressed", String(state.toggleHalf === "am"));
  $("toggle-pm-btn").setAttribute("aria-pressed", String(state.toggleHalf === "pm"));
}

function setToggleHalf(half) {
  state.toggleHalf = half;
  applyToggleVisibility();
}

/** Shows the wrap for the current dial layout and redraws it — an engine
 *  that was hidden may be stale, since only a visible one re-renders on
 *  every data change. */
function syncLayoutSwitch() {
  for (const btn of $("dial-layout-switch").children) {
    const active = btn.dataset.mode === settings.dialMode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  }
}

function applyDialMode() {
  const twin = isTwinLayout(settings.dialMode);
  $("dial-wrap-single").hidden = twin;
  $("dial-wrap-twin").hidden = !twin;
  applyToggleVisibility();
  syncLayoutSwitch();
  renderDial();
}

/** The quick switcher on the Day view and the Settings → Appearance dropdown
 *  both just set settings.dialMode — whichever one the user touches, the
 *  other stays in sync via syncLayoutSwitch()/syncAppearanceInputs(). */
function setDialMode(mode) {
  if (mode === settings.dialMode) return;
  settings = normalizeSettings({ ...settings, dialMode: mode });
  persistSettings();
  applyDialMode();
  syncAppearanceInputs();
}

/* ---------- keyboard shortcuts ---------- */

window.addEventListener("keydown", (evt) => {
  // Both modals own their own keys. Without the onboarding check, pressing
  // 1-6 during the welcome tour silently changed the pen behind it.
  if (!$("settings-overlay").hidden || !$("onboarding-overlay").hidden) return;
  const inField = evt.target instanceof HTMLTextAreaElement || evt.target instanceof HTMLInputElement;

  if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === "z" && !inField) {
    evt.preventDefault();
    if (evt.shiftKey) redo();
    else undo();
    return;
  }
  if (inField) return;

  if (/^[1-6]$/.test(evt.key)) {
    const id = Number(evt.key) - 1;
    const cat = categories.find((c) => c.id === id);
    if (cat?.enabled) {
      state.activePen = id;
      persistActivePen();
      renderPens();
      refreshCenters();
    }
    return;
  }
  if (evt.key === "0" || evt.key.toLowerCase() === "e") {
    state.activePen = UNTRACKED;
    persistActivePen();
    renderPens();
    refreshCenters();
  }
});

/* ---------- pens ---------- */

function renderPens() {
  syncTypedEntryCategories();
  syncMultiFillCategorySelect();
  const pensEl = $("pens");
  pensEl.replaceChildren();

  for (const c of categories.filter((c) => c.enabled)) {
    const btn = document.createElement("button");
    btn.className = `pen${state.activePen === c.id ? " active" : ""}`;
    btn.setAttribute("aria-pressed", String(state.activePen === c.id));

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = `var(--${c.cls})`;

    const weight = document.createElement("span");
    weight.className = "wt";
    weight.textContent = WEIGHT_GLYPH[c.weight];

    btn.append(swatch, document.createTextNode(c.name), weight);
    btn.addEventListener("click", () => {
      state.activePen = c.id;
      persistActivePen();
      renderPens();
      refreshCenters();
    });
    pensEl.appendChild(btn);
  }

  // The eraser lives in its own slot, not in the pen list. It isn't a
  // category — it doesn't get renamed, hidden or reweighted, and it is there
  // whether you have six categories or one. Sitting in the row it read as a
  // seventh category, and moved every time the others did.
  const eraserSlot = $("pens-eraser");
  eraserSlot.replaceChildren();
  const eraser = document.createElement("button");
  eraser.className = `pen eraser${state.activePen === UNTRACKED ? " active" : ""}`;
  eraser.setAttribute("aria-pressed", String(state.activePen === UNTRACKED));
  const eraserSwatch = document.createElement("span");
  eraserSwatch.className = "swatch";
  eraser.append(eraserSwatch, document.createTextNode(t("penEraserLabel")));
  eraser.addEventListener("click", () => {
    state.activePen = UNTRACKED;
    persistActivePen();
    renderPens();
    refreshCenters();
  });
  eraserSlot.appendChild(eraser);
}

/* ---------- side panel ---------- */

function catBarRow(name, cls, slotCount, maxSlots, isUntracked) {
  const row = document.createElement("div");
  row.className = `cat-bar-row${isUntracked ? " untracked" : ""}`;

  const nameEl = document.createElement("span");
  nameEl.className = "name";
  if (!isUntracked) {
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = `var(--${cls})`;
    nameEl.appendChild(sw);
  }
  nameEl.appendChild(document.createTextNode(name));

  const track = document.createElement("span");
  track.className = "track";
  const fill = document.createElement("span");
  fill.className = "fill";
  fill.style.width = `${maxSlots ? (slotCount / maxSlots) * 100 : 0}%`;
  if (!isUntracked) fill.style.background = `var(--${cls})`;
  track.appendChild(fill);

  const dur = document.createElement("span");
  dur.className = "dur";
  dur.textContent = fmtDuration(slotCount * SLOT_MIN);

  row.append(nameEl, track, dur);
  return row;
}

/** The window the "still unlogged" nag applies to — null (unrestricted) if
 *  the two times are misconfigured (end at or before start), rather than
 *  silently hiding the nag entirely or producing a negative duration. */
/**
 * For the insight line, which is the one place the app writes HTML rather
 * than textContent. Category names are user-typed, and before this they went
 * into innerHTML raw — a category named with a tag would have been rendered
 * as markup. Now the <b> comes from the message and everything substituted
 * into it is escaped.
 */
const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function dayWindowMinutes() {
  const startMin = hmToMinutes(settings.dayWindow.start);
  const endMin = hmToMinutes(settings.dayWindow.end);
  return endMin > startMin ? { startMin, endMin } : null;
}

function renderSide() {
  const stats = computeStats(state.slots, categories, dayWindowMinutes());

  $("stat-tracked").textContent = fmtDuration(stats.trackedMin);
  $("stat-productive").textContent = stats.trackedMin ? `${stats.productivePct}%` : "—";
  $("stat-focus").textContent = fmtDuration(stats.longestFocusMin);
  // The messages carry the <b> emphasis, so word order stays the
  // translator's to decide; the substituted values are escaped first because
  // one of them is a user-named category.
  $("insight").innerHTML = buildInsight(stats, categories)
    .map((m) => t(m.key, m.params.map(escapeHtml)))
    .join(" ");

  const bucket = scoreBucket(stats.score, stats.trackedMin);
  // Provisional means the score exists but rests on too little logged time to
  // be worth printing — showing "+100" off half an hour is worse than showing
  // nothing, because it reads as a verdict on the day.
  $("score-val").textContent =
    stats.score === null || bucket.provisional ? "—" : `${stats.score > 0 ? "+" : ""}${stats.score}`;
  $("score-badge").className = `score-badge ${bucket.tone}`;
  $("score-badge-text").textContent = t(bucket.labelKey);

  const meter = $("meter-fill");
  meter.style.width = `${stats.score === null ? 50 : Math.max(0, Math.min(100, (stats.score + 100) / 2))}%`;
  meter.style.background = `var(${toneVar(bucket.tone)})`;

  const barsEl = $("cat-bars");
  barsEl.replaceChildren();
  const maxSlots = Math.max(...stats.perCat, stats.untrackedSlots, 1);
  categories.forEach((c, i) => barsEl.appendChild(catBarRow(c.name, c.cls, stats.perCat[i], maxSlots, false)));
  barsEl.appendChild(catBarRow(t("untrackedCapitalized"), null, stats.untrackedSlots, maxSlots, true));

  renderGoalRows(stats);
  renderWeeklyGoalRows();
}

/* ---------- goals ---------- */

function buildGoalRow(row) {
  const wrap = document.createElement("div");
  wrap.className = "goal-row";

  const name = document.createElement("span");
  name.className = "name";
  const sw = document.createElement("span");
  sw.className = "sw";
  sw.style.background = `var(--${row.cls})`;
  name.append(sw, document.createTextNode(row.name));

  const track = document.createElement("span");
  track.className = "track";
  const fill = document.createElement("span");
  fill.className = "fill";
  fill.style.width = `${row.pct}%`;
  fill.style.background = `var(--${row.cls})`;
  track.appendChild(fill);

  const amount = document.createElement("span");
  amount.className = "amount";
  amount.textContent = `${fmtDuration(row.actualMin)} / ${fmtDuration(row.targetMin)}`;
  if (row.met) {
    const check = document.createElement("span");
    check.className = "met";
    check.textContent = " ✓";
    amount.appendChild(check);
  }

  wrap.append(name, track, amount);
  return wrap;
}

function renderGoalRows(stats) {
  const rows = goalProgress(
    stats.perCat.map((n) => n * SLOT_MIN),
    settings.goals,
    categories
  );
  $("goals-panel").hidden = rows.length === 0;
  const el = $("goal-rows");
  el.replaceChildren();
  for (const row of rows) el.appendChild(buildGoalRow(row));
}

function renderWeeklyGoalRows() {
  const weekStart = mostRecentWeekStart(settings.weekStart, new Date());
  const perCatMin = weekPerCatMinutes(days, categories, weekStart);
  const rows = goalProgress(perCatMin, settings.weeklyGoals, categories);
  $("weekly-goals-panel").hidden = rows.length === 0;
  const el = $("weekly-goal-rows");
  el.replaceChildren();
  for (const row of rows) el.appendChild(buildGoalRow(row));
}

/** Drives both the daily (`goals`, "min/day") and weekly (`weeklyGoals`,
 *  "min/wk") editor rows in Settings → Goals — same fields, different
 *  settings key, unit label, and step size. */
function renderGoalsEditorFor(rowsElId, goalsKey, unitLabel, step) {
  const rowsEl = $(rowsElId);
  rowsEl.replaceChildren();

  for (const c of categories) {
    const row = document.createElement("div");
    row.className = "goal-edit-row";

    const swatch = document.createElement("span");
    swatch.className = "sw";
    swatch.style.background = `var(--${c.cls})`;
    swatch.style.opacity = c.enabled ? "1" : "0.35";

    const label = document.createElement("span");
    label.className = "goal-name";
    label.textContent = c.name;

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = String(step);
    input.placeholder = t("goalOffPlaceholder");
    input.value = settings[goalsKey][c.id] ?? "";
    input.disabled = !c.enabled;
    input.setAttribute(
      "aria-label",
      unitLabel === "min/day" ? t("goalAriaLabelDaily", [c.name]) : t("goalAriaLabelWeekly", [c.name])
    );
    input.addEventListener("change", () => {
      const v = Number(input.value);
      const next = { ...settings[goalsKey] };
      if (input.value.trim() === "" || !(v > 0)) delete next[c.id];
      else next[c.id] = Math.round(v);
      settings = normalizeSettings({ ...settings, [goalsKey]: next });
      persistSettings();
      renderSide();
      renderAboutBests();
    });

    const unit = document.createElement("span");
    unit.className = "unit";
    unit.textContent = unitLabel;

    row.append(swatch, label, input, unit);
    rowsEl.appendChild(row);
  }
}

function renderGoalsEditor() {
  renderGoalsEditorFor("goals-editor-rows", "goals", "min/day", 5);
  renderGoalsEditorFor("weekly-goals-editor-rows", "weeklyGoals", "min/wk", 15);
}

/* ---------- day templates ---------- */

/** Stamps a template's slots onto the day currently on screen. Painted time
 *  only — notes, intentions, avoid, and reflection are left exactly as they
 *  are, since a template is the shape of a day, not its content. */
function applyTemplate(template) {
  pushUndo();
  const dropped = stampSlots(template.slots);
  persistDay();
  renderAll();
  toast(dropped ? t("templateAppliedUpToNowToast", [template.name]) : t("templateAppliedToast", [template.name]));
}

/** Saving under a name already in use replaces that template rather than
 *  piling up near-duplicates — the common case is refining one you already
 *  have, not starting a new one every time. */
function saveTemplateFromToday() {
  const input = $("template-name-input");
  const name = input.value.trim().slice(0, MAX_TEMPLATE_NAME);
  if (!name) {
    toast(t("templateNameRequiredToast"));
    return;
  }
  const isUpdate = templates.some((tpl) => tpl.name === name);
  if (!isUpdate && templates.length >= MAX_TEMPLATES) {
    toast(t("templateMaxToast", [String(MAX_TEMPLATES)]));
    return;
  }
  const next = templates.filter((tpl) => tpl.name !== name);
  next.push({ name, slots: [...state.slots] });
  templates = normalizeTemplates(next);
  persistTemplates();
  input.value = "";
  renderTemplatesEditor();
  toast(t("templateSavedToast", [name]));
}

function deleteTemplate(name) {
  templates = templates.filter((tpl) => tpl.name !== name);
  persistTemplates();
  renderTemplatesEditor();
  toast(t("templateDeletedToast", [name]));
}

function renderTemplatesEditor() {
  const listEl = $("templates-list");
  listEl.replaceChildren();

  if (templates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "editor-note";
    empty.textContent = t("templatesEmptyNote");
    listEl.appendChild(empty);
    return;
  }

  for (const tpl of templates) {
    const row = document.createElement("div");
    row.className = "template-row";

    const name = document.createElement("span");
    name.className = "template-name";
    name.textContent = tpl.name;

    // Two-step confirm rather than a modal — same pattern as "Clear day":
    // arm on the first click, revert if nothing follows within a few
    // seconds. Only armed at all when applying would actually overwrite
    // something; a day with nothing painted has nothing to lose.
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "ghost-btn";
    applyBtn.textContent = t("applyLabel");
    let armed = false;
    let armTimer = null;
    applyBtn.addEventListener("click", () => {
      if (dayHasEntries({ slots: state.slots }) && !armed) {
        armed = true;
        applyBtn.textContent = t("applyConfirmLabel");
        armTimer = setTimeout(() => {
          armed = false;
          applyBtn.textContent = t("applyLabel");
        }, 3000);
        return;
      }
      clearTimeout(armTimer);
      armed = false;
      applyBtn.textContent = t("applyLabel");
      applyTemplate(tpl);
    });

    const dropBtn = document.createElement("button");
    dropBtn.type = "button";
    dropBtn.className = "ghost-btn danger";
    dropBtn.textContent = t("deleteLabel");
    dropBtn.setAttribute("aria-label", t("deleteTemplateAriaLabel", [tpl.name]));
    dropBtn.addEventListener("click", () => deleteTemplate(tpl.name));

    row.append(name, applyBtn, dropBtn);
    listEl.appendChild(row);
  }
}

/* ---------- streak ---------- */

function renderStreak() {
  const streak = computeStreak(days, new Date());
  // innerHTML because the message carries the <b> around the count; both
  // substituted values are numbers this module produced, never user text.
  $("streak-text").innerHTML =
    tp("streakBanner", streak.current, [String(streak.current)]) +
    ` <span class="muted">${t("streakBestSuffix", [String(streak.longest)])}</span>`;
  $("streak-icon").textContent = streak.current > 0 ? "🔥" : "○";
  $("streak-freeze").hidden = streak.freezesUsedThisWeek === 0;
  $("streak-risk").hidden = !streak.isAtRisk;
}

/* ---------- personal bests (About tab) ---------- */

function renderAboutBests() {
  const bests = personalBests(days, categories, new Date());
  $("bests-streak").textContent = tp("bestsStreakDays", bests.longestStreak, [String(bests.longestStreak)]);
  $("bests-score").textContent = bests.bestScore
    ? `${bests.bestScore.score > 0 ? "+" : ""}${bests.bestScore.score} · ${bests.bestScore.key}`
    : "—";
  $("bests-day").textContent = bests.mostProductiveDay
    ? `${fmtDuration(bests.mostProductiveDay.productiveMin)} · ${bests.mostProductiveDay.key}`
    : "—";
}

/* ---------- backup nudge ---------- */

let nudgeDismissed = false;

function loggedDayCount() {
  let n = 0;
  for (const day of days.values()) if (dayHasEntries(day)) n++;
  return n;
}

function renderBackupStatus() {
  $("backup-status").textContent = settings.lastExportAt
    ? t("lastBackupStatus", [dateFmt({ dateStyle: "medium" }).format(new Date(settings.lastExportAt))])
    : t("noBackupYetStatus");

  const due = !nudgeDismissed && shouldNudgeBackup(settings.lastExportAt, loggedDayCount(), new Date());
  $("backup-nudge").hidden = !due;
  $("data-backup-nudge").hidden = !due;
}

function dismissNudge() {
  nudgeDismissed = true;
  renderBackupStatus();
}

function markExported() {
  settings = { ...settings, lastExportAt: Date.now() };
  persistSettings();
  renderBackupStatus();
}

/* ---------- 7-day strip ---------- */

/** Short weekday names in the UI language — these were English initials,
 *  which leaked into the week strip of every translated build. */
const DOW = shortWeekdayNames();

function renderStrip() {
  const stripEl = $("strip");
  stripEl.replaceChildren();
  const today = new Date();

  // Name the month(s) the seven days fall in — "24–30" alone doesn't say
  // which month, and at a boundary the strip spans two.
  const first = new Date(today);
  first.setDate(first.getDate() - 6);
  const monthOf = (d) => dateFmt({ month: "long" }).format(d);
  $("strip-month").textContent =
    first.getMonth() === today.getMonth()
      ? `${monthOf(today)} ${today.getFullYear()}`
      : first.getFullYear() === today.getFullYear()
        ? `${monthOf(first)} – ${monthOf(today)} ${today.getFullYear()}`
        : `${monthOf(first)} ${first.getFullYear()} – ${monthOf(today)} ${today.getFullYear()}`;

  for (let offset = -6; offset <= 0; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const stats = computeStats(getDay(dateKey(d)).slots, categories);
    const bucket = scoreBucket(stats.score, stats.trackedMin);

    const btn = document.createElement("button");
    btn.className = `strip-day${sameDay(d, state.viewDate) ? " active" : ""}`;
    btn.setAttribute("aria-label", `${fmtFullDate(d)} — ${t(bucket.labelKey)}`);

    const dow = document.createElement("span");
    dow.className = "dow";
    dow.textContent = DOW[d.getDay()];

    const track = document.createElement("span");
    track.className = "bar-track";
    const fill = document.createElement("span");
    fill.className = "bar-fill";
    // A custom property rather than a dimension: the bar runs left-to-right
    // beside the ring and bottom-to-top when the card is narrow enough to put
    // the strip back on top, and only CSS knows which layout is in force.
    fill.style.setProperty("--fill", `${stats.score === null ? 6 : Math.max(6, (stats.score + 100) / 2)}%`);
    fill.style.background = `var(${toneVar(bucket.tone)})`;
    track.appendChild(fill);

    const num = document.createElement("span");
    num.className = "num";
    num.textContent = String(d.getDate());

    btn.append(dow, track, num);
    btn.addEventListener("click", () => switchDay(d));
    stripEl.appendChild(btn);
  }
}

/* ---------- date navigation ---------- */

function renderDateLabel() {
  const label = $("date-label");
  const jump = $("today-jump");

  $("next-day").disabled = isToday(state.viewDate);

  if (isToday(state.viewDate)) {
    label.textContent = t("dateToday");
    jump.hidden = true;
    return;
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  label.textContent = sameDay(state.viewDate, yesterday)
    ? t("dateYesterday")
    : dateFmt({ weekday: "short", month: "short", day: "numeric" }).format(state.viewDate);
  jump.hidden = false;
}

function flushReflection() {
  if (!state.reflectTimer) return;
  clearTimeout(state.reflectTimer);
  state.reflectTimer = null;
  persistDay();
}

function switchDay(d) {
  flushReflection();
  state.viewDate = d;
  const day = getDay(dateKey(d));
  state.slots = [...day.slots];
  state.reflection = day.reflection;
  state.notes = (day.notes ?? []).map((n) => ({ ...n }));
  state.intents = (day.intents ?? []).map((i) => ({ ...i }));
  state.avoid = [...(day.avoid ?? [])];
  $("reflection").value = state.reflection;
  hideJustPainted();
  renderJournal();
  renderAll();
}

function renderJournal() {
  renderIntents();
  renderAvoid();
  renderBreakdown();
}

/* ---------- copy yesterday ---------- */

function copyYesterday() {
  const y = new Date(state.viewDate);
  y.setDate(y.getDate() - 1);
  const yDay = getDay(dateKey(y));

  if (!dayHasEntries(yDay)) {
    toast(t("copyYesterdayEmptyToast"));
    return;
  }
  const todayHasData = state.slots.some((v) => v !== UNTRACKED);
  if (todayHasData && !window.confirm(t("copyYesterdayConfirm"))) {
    return;
  }

  pushUndo();
  const dropped = stampSlots(yDay.slots);
  persistDay();
  renderAll();
  toast(dropped ? t("copyYesterdayUpToNowToast") : t("copyYesterdaySuccessToast"));
}

/* ---------- share as image ---------- */

/** Loads an SVG string through an <img> and draws it to an off-screen canvas.
 *  A blob: URL is same-origin to this page, so the canvas never taints —
 *  toBlob() works without a CORS workaround. `scale` renders at a higher
 *  pixel density than the CSS size so the PNG stays sharp. */
function rasterizeSvgToPng(svgMarkup, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const svgUrl = URL.createObjectURL(new Blob([svgMarkup], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))), "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error("could not load the SVG snapshot as an image"));
    };
    img.src = svgUrl;
  });
}

async function shareAsImage() {
  const key = dateKey(state.viewDate);
  const dateLabel = dateFmt({ weekday: "long", month: "long", day: "numeric" }).format(state.viewDate);
  const streak = isToday(state.viewDate) ? computeStreak(days, new Date()) : null;
  const shareStats = computeStats(state.slots, categories, dayWindowMinutes());
  const shareTop = categories
    .map((c, i) => ({ name: c.name, min: shareStats.perCat[i] * SLOT_MIN }))
    .filter((r) => r.min > 0)
    .sort((a, b) => b.min - a.min)[0];
  // The card is the one thing that leaves the device, so it reads in the
  // sharer's language. buildShareSvgMarkup can't reach a message catalog,
  // so the finished words are handed to it.
  const svgMarkup = buildShareSvgMarkup(state.slots, categories, dateLabel, streak, {
    score: t("shareScoreLabel"),
    bucket: t(scoreBucket(shareStats.score, shareStats.trackedMin).labelKey),
    nothingLogged: t("shareNothingLogged"),
    tracked: t("shareTrackedLine", [fmtDuration(shareStats.trackedMin), String(shareStats.productivePct)]),
    led: shareTop ? t("shareLedLine", [shareTop.name, fmtDuration(shareTop.min)]) : "",
    streak: streak && streak.current > 0 ? t("shareStreakLine", [String(streak.current)]) : "",
  });

  let blob;
  try {
    blob = await rasterizeSvgToPng(svgMarkup, 1000, 560);
  } catch (err) {
    console.error("Daily Dial: could not render a share image", err);
    toast(t("shareImageErrorToast"));
    return;
  }

  // Not routed through navigator.share(): on desktop Chrome it's frequently
  // registered with zero real targets, and awaiting it consumes this click's
  // transient user-activation — by the time that rejects, the fallback
  // a.click() download below silently no-ops (no error, nothing saved). A
  // plain download always works and is exactly what Export CSV/JSON already do.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `daily-dial-${key}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast(t("shareImageSavedToast"));
}

/* ---------- typed entry ---------- */

/** Fills the typed-entry dropdown, and keeps it on the active pen so the
 *  common case — paint what the pen is already set to — needs no picking. */
function syncTypedEntryCategories() {
  const select = $("typed-entry-cat");
  const previous = select.value;
  select.replaceChildren();
  for (const c of categories.filter((c) => c.enabled)) {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = c.name;
    select.appendChild(opt);
  }
  const wanted = previous !== "" ? previous : String(state.activePen);
  if ([...select.options].some((o) => o.value === wanted)) select.value = wanted;
}

function submitTypedEntry(evt) {
  evt.preventDefault();
  checkDayRollover();
  const input = $("typed-entry-input");
  const raw = input.value.trim();
  // The category was the only half of this you could get wrong by misspelling,
  // so it's a dropdown now. Typing one still works and still wins — aliases
  // and "9-11 leetcode" would be a real loss otherwise — and the dropdown
  // fills in when the text is a bare time range.
  const typed = parseTimeEntry(raw, categories);
  const result = typed.ok
    ? typed
    : parseTimeEntry(`${raw} ${categories[Number($("typed-entry-cat").value)]?.name ?? ""}`, categories);
  if (!result.ok) {
    toast(tm(result.error));
    return;
  }
  pushUndo();
  // parseTimeEntry returns endSlot > SLOTS for a range that crosses midnight.
  // Wrapping it with `% SLOTS` folded the post-midnight part back onto the
  // *same* day: "11pm-1am" painted 23:00-24:00 and 00:00-01:00 of one day,
  // wiped whatever was already in that early hour, and split what should be
  // one two-hour block into two, so longest-focus read 60 minutes.
  const endOfDay = Math.min(result.endSlot, SLOTS);
  // Typed entry gets the same rule as the ring: an erase can reach anywhere,
  // but "20-22 deep work" typed at nine in the morning is a plan, not a log.
  const limit = result.categoryId === UNTRACKED ? SLOTS : firstUnpaintableSlot();
  if (result.startSlot >= limit) {
    toast(t("futureNotLogged"));
    return;
  }
  const cappedEnd = Math.min(endOfDay, limit);
  for (let i = result.startSlot; i < cappedEnd; i++) state.slots[i] = result.categoryId;
  persistDay();

  const overflow = cappedEnd === endOfDay ? result.endSlot - SLOTS : 0;
  if (overflow > 0) {
    const next = new Date(state.viewDate);
    next.setDate(next.getDate() + 1);
    paintIntoStoredDay(dateKey(next), 0, overflow, result.categoryId);
  }

  renderAll();
  renderStrip();
  renderStreak();
  input.value = "";
  showJustPainted(result.startSlot, cappedEnd);
  toast(overflow > 0 ? t("typedEntryOverflowToast") : t("typedEntryAddedToast"));
}

/** Paints a range into a day that isn't the one on screen, going straight to
 *  storage. Used for the post-midnight half of an overnight entry. */
function paintIntoStoredDay(key, from, to, categoryId) {
  const existing = days.get(key);
  const slots = existing ? [...existing.slots] : emptyDay().slots;
  for (let i = from; i < to; i++) slots[i] = categoryId;
  const data = { slots, reflection: existing?.reflection ?? "" };
  days.set(key, data);
  saveLocal({ [DAY_PREFIX + key]: data }).catch(reportStorageFailure);
  // Same rule as persistDay: writing to a demo day makes it yours.
  const sampleIdx = sampleDayKeys.indexOf(key);
  if (sampleIdx !== -1) {
    sampleDayKeys.splice(sampleIdx, 1);
    saveLocal({ [SAMPLE_DAY_KEYS_KEY]: sampleDayKeys }).catch(reportStorageFailure);
    renderSampleDataUI();
  }
}

/* ---------- toast ---------- */

let toastTimer = null;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ---------- note for the stretch just painted ---------- */

/** The range a freshly finished stroke covered, offered for a note while the
 *  user is still looking at the dial. Cleared on day change or once used. */
let justPainted = null;

function showJustPainted(from, to) {
  justPainted = { from, to };
  const cat = state.slots[from];
  const label = `${fmtSlotClock(from)}–${fmtSlotClock(to)}`;
  $("just-painted-what").textContent =
    cat === UNTRACKED ? label : `${label} · ${categories[cat].name}`;
  $("just-painted-note").value = "";
  $("just-painted").hidden = false;
}

function hideJustPainted() {
  justPainted = null;
  $("just-painted").hidden = true;
}

function saveJustPainted() {
  if (!justPainted) return;
  const text = $("just-painted-note").value.trim();
  if (!text) {
    hideJustPainted();
    return;
  }
  saveSpanNote({ start: justPainted.from, end: justPainted.to }, undefined, text);
  announce(t("noteSavedAnnounce", [fmtSlotClock(justPainted.from), fmtSlotClock(justPainted.to)]));
  hideJustPainted();
}

/* ---------- journal: intentions and ranged notes ---------- */


function renderIntents() {
  const list = $("intent-list");
  list.replaceChildren();
  for (const [i, intent] of (state.intents ?? []).entries()) {
    const row = document.createElement("li");
    row.className = `intent-row${intent.done ? " done" : ""}`;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = intent.done;
    box.id = `intent-${i}`;
    box.addEventListener("change", () => {
      state.intents[i].done = box.checked;
      persistDay();
      renderIntents();
    });

    const text = document.createElement("label");
    text.className = "text";
    text.htmlFor = box.id;
    text.textContent = intent.text;

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "drop";
    drop.textContent = "✕";
    drop.setAttribute("aria-label", t("removeIntentionAriaLabel", [intent.text]));
    drop.addEventListener("click", () => {
      state.intents.splice(i, 1);
      persistDay();
      renderIntents();
    });

    row.append(box, text, drop);
    list.appendChild(row);
  }
}

/**
 * The whole day as rows, gaps included.
 *
 * This replaced a note box that only worked while something was selected on
 * the dial — which meant a note could only be written at the moment of
 * painting, never afterwards when you actually remember what you were doing.
 * Every stretch now carries its own always-live field, and an unlogged gap is
 * a row with a category dropdown, so filling the day in is typing and picking
 * rather than selecting first.
 */
function renderBreakdown() {
  const body = $("breakdown-rows");
  body.replaceChildren();
  const spans = computeDaySpans(state.slots);
  const notes = state.notes ?? [];
  const claimed = new Set();

  for (const span of spans) {
    const isGap = span.cat === UNTRACKED;
    const row = document.createElement("tr");
    row.className = `bd-row${isGap ? " gap" : ""}`;

    const when = document.createElement("td");
    when.className = "bd-when";
    when.textContent = `${fmtSlotClock(span.start)}–${fmtSlotClock(span.end)}`;

    const what = document.createElement("td");
    const label = document.createElement("span");
    label.className = "bd-what";
    const dot = document.createElement("span");
    dot.className = "bd-dot";
    if (!isGap) dot.style.background = `var(--${categories[span.cat].cls})`;
    label.appendChild(dot);

    // The table runs the day end to end, so on today it reaches hours that
    // haven't arrived. Those rows stay — the day genuinely does continue —
    // but they say so, instead of offering a control whose every use would
    // be refused.
    const notYet = isGap && span.start >= firstUnpaintableSlot();

    if (notYet) {
      const soon = document.createElement("span");
      soon.className = "bd-not-yet";
      soon.textContent = t("breakdownNotYet");
      label.appendChild(soon);
      row.classList.add("future");
    } else if (isGap) {
      // A dropdown right here, because the alternative is going back to the
      // ring and dragging the exact range again — the friction that stops
      // gaps ever getting filled.
      const pick = document.createElement("select");
      pick.className = "bd-fill";
      pick.setAttribute("aria-label", t("fillSpanAriaLabel", [when.textContent]));
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = t("unloggedOptionLabel");
      pick.appendChild(blank);
      for (const c of categories.filter((c) => c.enabled)) {
        const opt = document.createElement("option");
        opt.value = String(c.id);
        opt.textContent = c.name;
        pick.appendChild(opt);
      }
      pick.addEventListener("change", () => {
        if (pick.value === "") return;
        fillSpan(span.start, span.end, Number(pick.value));
      });
      label.appendChild(pick);
    } else {
      label.append(categories[span.cat].name);
    }
    what.appendChild(label);

    const dur = document.createElement("td");
    dur.className = "bd-dur";
    dur.textContent = fmtDuration((span.end - span.start) * SLOT_MIN);

    const noteCell = document.createElement("td");
    const idxs = noteIndicesForSpan(notes, span.start, span.end);
    idxs.forEach((i) => claimed.add(i));
    const input = document.createElement("input");
    input.type = "text";
    input.className = "bd-note";
    input.maxLength = MAX_NOTE_LEN;
    input.value = idxs.length ? notes[idxs[0]].text : "";
    input.placeholder = isGap ? t("breakdownGapPlaceholder") : "—";
    input.setAttribute("aria-label", t("noteForAriaLabel", [when.textContent]));
    input.addEventListener("change", () => saveSpanNote(span, idxs[0], input.value));
    noteCell.appendChild(input);

    // Any further notes landing in this stretch — usually because the blocks
    // around them were repainted — are shown rather than silently hidden.
    for (const extra of idxs.slice(1)) {
      noteCell.appendChild(extraNoteRow(extra, notes[extra]));
    }

    // Clearing a stretch from here saves going back to the ring, finding
    // the same range, and painting it with the eraser.
    const clearCell = document.createElement("td");
    clearCell.className = "bd-clear-cell";
    if (!isGap) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "bd-clear";
      clear.textContent = "✕";
      clear.title = t("clearSpanTooltip", [when.textContent]);
      clear.setAttribute("aria-label", t("clearSpanAriaLabel", [categories[span.cat].name, when.textContent]));
      clear.addEventListener("click", () => fillSpan(span.start, span.end, UNTRACKED));
      clearCell.appendChild(clear);
    }

    row.append(when, what, dur, noteCell, clearCell);
    body.appendChild(row);
  }

  const tracked = state.slots.filter((v) => v !== UNTRACKED).length * SLOT_MIN;
  const stretches = spans.filter((s) => s.cat !== UNTRACKED).length;
  const loggedText = fmtDuration(tracked);
  const unloggedText = fmtDuration(SLOTS * SLOT_MIN - tracked);
  $("breakdown-sum").textContent = tp("breakdownSummary", stretches, [String(stretches), loggedText, unloggedText]);
}

function extraNoteRow(index, note) {
  const wrap = document.createElement("div");
  wrap.className = "bd-extra";
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = `${fmtSlotClock(note.from)}–${fmtSlotClock(note.to)}`;
  const text = document.createElement("span");
  text.className = "text";
  text.textContent = note.text;
  const drop = document.createElement("button");
  drop.type = "button";
  drop.className = "drop";
  drop.textContent = "✕";
  drop.setAttribute("aria-label", t("removeNoteAriaLabel", [when.textContent]));
  drop.addEventListener("click", () => {
    state.notes.splice(index, 1);
    persistDay();
    renderBreakdown();
    renderDial();
  });
  wrap.append(when, text, drop);
  return wrap;
}

/** Writes a row's note: edits the existing one, creates it, or removes it
 *  when the field is cleared. */
function saveSpanNote(span, existingIndex, raw) {
  const text = raw.trim().slice(0, MAX_NOTE_LEN);
  state.notes = state.notes ?? [];
  if (existingIndex !== undefined && existingIndex !== null) {
    if (text) state.notes[existingIndex].text = text;
    else state.notes.splice(existingIndex, 1);
  } else if (text) {
    if (state.notes.length >= MAX_NOTES_PER_DAY) {
      toast(t("maxNotesToast", [String(MAX_NOTES_PER_DAY)]));
      renderBreakdown();
      return;
    }
    state.notes = [...state.notes, { from: span.start, to: span.end, text }].sort((a, b) => a.from - b.from);
  } else {
    return; // nothing there, nothing typed
  }
  persistDay();
  renderBreakdown();
  renderDial();
}

/** Paints a stretch from the breakdown table, through the same undo and
 *  persistence path a drag on the ring uses. */
function fillSpan(from, to, categoryId) {
  if (tabIsStale) return;
  checkDayRollover();

  // The table lists the day end to end, so on today it offers rows for hours
  // that haven't arrived. Erasing stays unrestricted — it can only ever
  // remove something that shouldn't be there.
  const end = categoryId === UNTRACKED ? to : Math.min(to, firstUnpaintableSlot());
  if (end <= from) {
    toast(t("futureNotLogged"));
    renderBreakdown(); // put the dropdown back to "Unlogged"
    return;
  }

  pushUndo();
  for (let i = from; i < end; i++) state.slots[i] = categoryId;
  persistDay();
  renderAll();
  onStrokeEnd();
  announce(
    categoryId === UNTRACKED
      ? t("clearedAnnounce", [fmtSlotClock(from), fmtSlotClock(to)])
      : t("caretCommitAnnounce", [categories[categoryId].name, fmtSlotClock(from), fmtSlotClock(end)])
  );
}

function renderAvoid() {
  const list = $("avoid-list");
  list.replaceChildren();
  for (const [i, text] of (state.avoid ?? []).entries()) {
    const row = document.createElement("li");
    row.className = "avoid-row";

    const bullet = document.createElement("span");
    bullet.className = "bullet";
    bullet.textContent = "✕";
    bullet.setAttribute("aria-hidden", "true");

    const body = document.createElement("span");
    body.className = "text";
    body.textContent = text;

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "drop";
    drop.textContent = "✕";
    drop.setAttribute("aria-label", t("removeAvoidAriaLabel", [text]));
    drop.addEventListener("click", () => {
      state.avoid.splice(i, 1);
      persistDay();
      renderAvoid();
    });

    row.append(bullet, body, drop);
    list.appendChild(row);
  }
}

function addAvoid(evt) {
  evt.preventDefault();
  const input = $("avoid-input");
  const text = input.value.trim();
  if (!text) return;
  if ((state.avoid ?? []).length >= MAX_INTENTS_PER_DAY) {
    toast(t("maxAvoidToast", [String(MAX_INTENTS_PER_DAY)]));
    return;
  }
  state.avoid = [...(state.avoid ?? []), text.slice(0, MAX_NOTE_LEN)];
  input.value = "";
  persistDay();
  renderAvoid();
}

/* ---------- challenge ---------- */

function renderChallenge() {
  const progress = challengeProgress(settings.challenge, new Date());
  const chip = $("challenge-chip");
  chip.hidden = progress === null;
  if (!progress) return;
  $("challenge-name").textContent = progress.name;
  $("challenge-day").textContent = progress.targetDays
    ? t("challengeDayProgress", [String(progress.day), String(progress.targetDays)])
    : t("challengeDaySimple", [String(progress.day)]);
}

function syncAutoBackupInputs() {
  $("auto-backup-on").checked = settings.autoBackupOn === true;
}

function saveAutoBackup() {
  settings = normalizeSettings({ ...settings, autoBackupOn: $("auto-backup-on").checked });
  persistSettings();
  // The service worker owns the alarm; "reschedule" is the existing channel
  // it already listens on for settings changes.
  chrome.runtime.sendMessage({ type: "reschedule" }).catch(() => {});
  toast($("auto-backup-on").checked ? t("autoBackupOnToast") : t("autoBackupOffToast"));
}

function syncObservationInputs() {
  $("observations-on").checked = settings.observationsOn !== false;
}

function saveObservations() {
  settings = normalizeSettings({ ...settings, observationsOn: $("observations-on").checked });
  persistSettings();
  refreshCurrentView();
}

function syncChallengeInputs() {
  const c = settings.challenge;
  $("challenge-name-input").value = c?.name ?? "";
  $("challenge-start-input").value = c?.startKey ?? "";
  $("challenge-target-input").value = c?.targetDays ?? "";
  $("challenge-clear").hidden = !c;
}

function saveChallenge() {
  const name = $("challenge-name-input").value.trim();
  const startKey = $("challenge-start-input").value;
  const rawTarget = Number($("challenge-target-input").value);
  // A challenge needs both a name and a start; anything less is no challenge.
  const next = name && startKey
    ? { name, startKey, targetDays: Number.isInteger(rawTarget) && rawTarget > 0 ? rawTarget : null }
    : null;
  settings = normalizeSettings({ ...settings, challenge: next });
  persistSettings();
  renderChallenge();
  // Only mirror storage back into the fields once something was actually
  // stored. A half-filled form — a name typed, no start date yet —
  // normalizes to null, and syncing that back cleared the name the instant
  // you tabbed out of it. Filling the form in the obvious order was
  // therefore impossible: the name vanished before you reached the date.
  if (next) syncChallengeInputs();
}

function clearChallenge() {
  settings = normalizeSettings({ ...settings, challenge: null });
  persistSettings();
  renderChallenge();
  syncChallengeInputs();
}

function addIntent(evt) {
  evt.preventDefault();
  const input = $("intent-input");
  const text = input.value.trim();
  if (!text) return;
  if ((state.intents ?? []).length >= MAX_INTENTS_PER_DAY) {
    toast(t("maxIntentsToast", [String(MAX_INTENTS_PER_DAY)]));
    return;
  }
  state.intents = [...(state.intents ?? []), { text: text.slice(0, MAX_NOTE_LEN), done: false }];
  input.value = "";
  persistDay();
  renderIntents();
}


/* ---------- category editor ---------- */

function renderCategoryEditor() {
  const rowsEl = $("cat-editor-rows");
  rowsEl.replaceChildren();

  for (const c of categories) {
    const row = document.createElement("div");
    row.className = "cat-edit-row";

    const swatch = document.createElement("span");
    swatch.className = "sw";
    swatch.style.background = `var(--${c.cls})`;
    swatch.style.opacity = c.enabled ? "1" : "0.35";

    const input = document.createElement("input");
    input.type = "text";
    input.value = c.name;
    input.maxLength = 24;
    input.disabled = !c.enabled;
    input.setAttribute("aria-label", t("categoryNameAriaLabel"));
    input.addEventListener("input", () => {
      c.name = input.value.trim() || c.name;
      persistCategories();
      renderPens();
      refreshCenters();
      renderSide();
      renderGoalsEditor();
      aliasInput.placeholder = t("aliasPlaceholder", [c.name]);
    });

    const seg = document.createElement("div");
    seg.className = "weight-seg";
    for (const w of [1, 0, -1]) {
      const b = document.createElement("button");
      b.textContent = WEIGHT_GLYPH[w];
      b.setAttribute("aria-pressed", String(c.weight === w));
      b.setAttribute(
        "aria-label",
        w === 1 ? t("weightPositiveLabel") : w === 0 ? t("weightNeutralLabel") : t("weightNegativeLabel")
      );
      b.disabled = !c.enabled;
      b.addEventListener("click", () => {
        c.weight = w;
        persistCategories();
        renderCategoryEditor();
        renderPens();
        renderSide();
        renderStrip();
      });
      seg.appendChild(b);
    }

    const toggle = document.createElement("button");
    toggle.className = "toggle";
    toggle.textContent = c.enabled ? "●" : "○";
    toggle.setAttribute("aria-pressed", String(c.enabled));
    toggle.setAttribute("aria-label", c.enabled ? t("hideCategoryAriaLabel", [c.name]) : t("showCategoryAriaLabel", [c.name]));
    toggle.addEventListener("click", () => {
      c.enabled = !c.enabled;
      if (!c.enabled && state.activePen === c.id) state.activePen = UNTRACKED;
      persistCategories();
      renderCategoryEditor();
      renderGoalsEditor();
      renderPens();
      refreshCenters();
      renderSide();
    });

    row.append(swatch, input, seg, toggle);

    const aliasRow = document.createElement("div");
    aliasRow.className = "cat-alias-row";
    const aliasInput = document.createElement("input");
    aliasInput.type = "text";
    aliasInput.value = c.aliases.join(", ");
    aliasInput.disabled = !c.enabled;
    // Tied to the category's current name, not a fixed example — a hardcoded
    // sample ("leetcode, resume...") looked identical and nonsensical under
    // every category including Break and Distraction, and would have stayed
    // wrong forever for a renamed category besides.
    aliasInput.placeholder = t("aliasPlaceholder", [c.name]);
    aliasInput.setAttribute("aria-label", t("aliasAriaLabel", [c.name]));
    aliasInput.addEventListener("change", () => {
      c.aliases = normalizeAliases(aliasInput.value.split(","));
      aliasInput.value = c.aliases.join(", "); // reflect trimming/dedup/caps back
      persistCategories();
    });
    aliasRow.appendChild(aliasInput);

    const item = document.createElement("div");
    item.className = "cat-edit-item";
    item.append(row, aliasRow);

    // The hue on the ring is this category's identity and never changes, but
    // it was chosen assuming the default weight (Distraction red, the two
    // +1s and Break/Admin their own colours). Re-weighting a category away
    // from that default leaves its colour arguing with its score, so say so
    // here rather than trying to recolour a ring people rely on staying put.
    const defaultCat = DEFAULT_CATEGORIES[c.id];
    if (defaultCat && c.weight !== defaultCat.weight) {
      const note = document.createElement("p");
      note.className = "editor-note";
      note.textContent = t("categoryColorNote");
      item.appendChild(note);
    }

    rowsEl.appendChild(item);
  }
}

/* ---------- reminders + weekly recap ---------- */

function syncReminderInputs() {
  $("reminders-on").checked = settings.remindersOn;
  $("reminder-1").value = settings.times[0];
  $("reminder-2").value = settings.times[1];
  $("reminder-1").disabled = !settings.remindersOn;
  $("reminder-2").disabled = !settings.remindersOn;

  $("weekly-recap-on").checked = settings.weeklyRecapOn;
  $("weekly-recap-day").value = String(settings.weeklyRecapDay);
  $("weekly-recap-time").value = settings.weeklyRecapTime;
  $("weekly-recap-day").disabled = !settings.weeklyRecapOn;
  $("weekly-recap-time").disabled = !settings.weeklyRecapOn;
}

function saveReminders() {
  const t1 = $("reminder-1").value;
  const t2 = $("reminder-2").value;
  const recapTime = $("weekly-recap-time").value;

  settings = normalizeSettings({
    ...settings,
    remindersOn: $("reminders-on").checked,
    times: [isValidTime(t1) ? t1 : settings.times[0], isValidTime(t2) ? t2 : settings.times[1]],
    weeklyRecapOn: $("weekly-recap-on").checked,
    weeklyRecapDay: Number($("weekly-recap-day").value),
    weeklyRecapTime: isValidTime(recapTime) ? recapTime : settings.weeklyRecapTime,
  });
  syncReminderInputs();
  persistSettings();
  chrome.runtime.sendMessage({ type: "reschedule" }).catch(() => {
    // Worker asleep or restarting; it reschedules from storage on next wake.
  });
  toast(
    settings.remindersOn
      ? t("remindersSetToast", [settings.times[0], settings.times[1]])
      : t("remindersOffToast")
  );
}

/* ---------- appearance ---------- */

/**
 * Fills the language picker and marks the current choice.
 *
 * Built here rather than in the markup so the list comes from one place —
 * `SUPPORTED_LANGUAGES` in i18n.js, which is also what the override loader
 * validates against. Each language is named in itself, because someone
 * looking for their own language is not helped by seeing it written in a
 * language they cannot read.
 */
function renderLanguageSelect() {
  const sel = $("language-select");
  sel.replaceChildren();
  for (const { code, label } of SUPPORTED_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = code === "auto" ? t("languageAutomatic") : label;
    sel.appendChild(opt);
  }
  sel.value = storedLanguage();
}

/**
 * Applying a language means reloading: every string on the page was resolved
 * once at boot, and the catalog is read synchronously before the first of
 * them renders. Re-translating a live DOM would mean re-running every render
 * path and re-deriving text this module does not own, for a setting people
 * change approximately once.
 */
function onLanguageChange() {
  const chosen = $("language-select").value;
  try {
    if (chosen === "auto") localStorage.removeItem(LANGUAGE_KEY);
    else localStorage.setItem(LANGUAGE_KEY, chosen);
  } catch {
    toast(t("saveFailedToast"));
    return;
  }
  window.location.reload();
}

function syncAppearanceInputs() {
  renderLanguageSelect();
  $("theme-select").value = settings.theme;
  $("time-format-select").value = settings.timeFormat;
  $("dial-mode-select").value = settings.dialMode;
  $("week-start-select").value = String(settings.weekStart);
  $("day-window-start").value = settings.dayWindow.start;
  $("day-window-end").value = settings.dayWindow.end;
}

function saveAppearance() {
  const startVal = $("day-window-start").value;
  const endVal = $("day-window-end").value;
  settings = normalizeSettings({
    ...settings,
    theme: $("theme-select").value,
    timeFormat: $("time-format-select").value,
    dialMode: $("dial-mode-select").value,
    weekStart: Number($("week-start-select").value),
    dayWindow: {
      start: isValidTime(startVal) ? startVal : settings.dayWindow.start,
      end: isValidTime(endVal) ? endVal : settings.dayWindow.end,
    },
  });
  persistSettings();
  applyTheme();
  applyDialMode();
  renderStrip();
  renderSide();
  toast(t("appearanceUpdatedToast"));
}

/* ---------- export ---------- */

function exportCsv() {
  // Same rule as the JSON export and the Drive backup: demo days are not
  // yours, so they never leave in a file that claims to be your history.
  const mine = excludeDays(days, sampleDayKeys);
  const csv = buildCsv(mine, categories);
  if (!csv) {
    toast(days.size === 0 ? t("nothingToExportToast") : t("onlyDemoExportToast"));
    return;
  }
  // Leading BOM so Excel reads it as UTF-8.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `daily-dial-${dateKey(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  markExported();
  toast(t("exportedCsvToast"));
}

function exportJson() {
  const mine = excludeDays(days, sampleDayKeys);
  if (mine.size === 0) {
    toast(days.size === 0 ? t("nothingToExportToast") : t("onlyDemoExportToast"));
    return;
  }
  const backup = buildBackup(mine, categories, settings, chrome.runtime.getManifest().version);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `daily-dial-${dateKey(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  markExported();
  toast(t("exportedJsonToast"));
}

/* ---------- import ---------- */

/** {kind:"json"|"csv", days:Map, categories?:Array, settings?:object} awaiting Merge/Replace. */
let pendingImport = null;
let replaceArmed = false;
let replaceArmTimer = null;

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function handleImportFile(file) {
  let text;
  try {
    text = await readFileAsText(file);
  } catch {
    toast(t("fileReadErrorToast"));
    return;
  }

  const looksJson = file.name.toLowerCase().endsWith(".json") || text.trim().startsWith("{");
  const result = looksJson ? parseBackup(text) : parseCsv(text, categories);

  if (!result.ok) {
    toast(tm(result.error));
    $("import-file").value = "";
    return;
  }

  pendingImport = {
    kind: looksJson ? "json" : "csv",
    days: looksJson ? result.data.days : result.data,
    categories: looksJson ? result.data.categories : null,
    settings: looksJson ? result.data.settings : null,
  };
  showImportConfirm();
}

function showImportConfirm() {
  // Counted against real days only: applyImport drops demo data before it
  // merges, so counting overlaps against fabricated days would describe an
  // import that isn't the one about to happen.
  const summary = summarizeImport(excludeDays(days, sampleDayKeys), pendingImport.days);
  $("import-confirm").hidden = false;
  const sentence1 = tp("importSummarySentence1", summary.incomingCount, [
    String(summary.incomingCount), String(summary.overlapping), String(summary.existingCount),
  ]);
  const sentence2 = tp("importSummarySentence2", summary.newCount, [String(summary.newCount)]);
  const sentence3 = tp("importSummarySentence3", summary.existingCount, [String(summary.existingCount)]);
  $("import-summary").textContent =
    `${sentence1} ${sentence2} ${sentence3}` + (sampleDayKeys.length ? ` ${t("importSummaryDemoClearSentence")}` : "");
  replaceArmed = false;
  clearTimeout(replaceArmTimer);
  $("import-replace").textContent = t("replaceEverythingLabel");
}

function cancelImport() {
  pendingImport = null;
  replaceArmed = false;
  clearTimeout(replaceArmTimer);
  $("import-confirm").hidden = true;
  $("import-file").value = "";
}

function applyImport(mode) {
  if (!pendingImport || tabIsStale) return;

  // Demo mode is dropped before anything is merged. mergeDayMaps keeps the
  // existing day on a collision, and sample days occupy most of the last
  // three weeks — so merging a real backup while demo mode was on silently
  // skipped every real day those fake ones happened to shadow, and leaving
  // demo mode afterwards then deleted those same dates outright. The data
  // was neither imported nor kept.
  if (sampleDayKeys.length) {
    for (const key of sampleDayKeys) days.delete(key);
    removeLocal([...sampleDayKeys.map((k) => DAY_PREFIX + k), SAMPLE_DAY_KEYS_KEY])
      .catch(reportStorageFailure);
    sampleDayKeys = [];
  }

  const merged = mergeDayMaps(days, pendingImport.days, mode);
  const removeKeys = [];
  if (mode === "replace") {
    for (const key of days.keys()) if (!merged.has(key)) removeKeys.push(DAY_PREFIX + key);
  }
  days.clear();
  for (const [key, day] of merged) days.set(key, day);

  if (mode === "replace" && pendingImport.categories) categories = pendingImport.categories;
  if (mode === "replace" && pendingImport.settings) settings = pendingImport.settings;

  const toSet = {};
  for (const [key, day] of days) toSet[DAY_PREFIX + key] = day;
  if (mode === "replace" && pendingImport.categories) {
    toSet[CATEGORIES_KEY] = categories.map(({ name, weight, enabled, aliases }) => ({ name, weight, enabled, aliases }));
  }
  if (mode === "replace" && pendingImport.settings) toSet[SETTINGS_KEY] = settings;
  saveLocal(toSet).catch(reportStorageFailure);
  if (removeKeys.length) removeLocal(removeKeys).catch(reportStorageFailure);
  if (mode === "replace" && pendingImport.settings) {
    chrome.runtime.sendMessage({ type: "reschedule" }).catch(() => {});
  }

  cancelImport();
  // A replace can bring in a different dial layout. Without these two the
  // imported `dialMode` was live in settings while the old rings stayed on
  // screen — and clicking the correct layout button then did nothing at all,
  // because setDialMode early-returns when the mode already matches.
  reconcileActivePen();
  applyDialMode();
  syncLayoutSwitch();
  switchDay(state.viewDate);
  applyTheme();
  syncReminderInputs();
  syncAppearanceInputs();
  renderCategoryEditor();
  renderGoalsEditor();
  renderBackupStatus();
  renderSampleDataUI();
  renderAboutBests();
  renderDriveStatus();
  // History/other views render lazily, so without this an import made while
  // History was open left the heatmap and summaries showing pre-import data.
  refreshCurrentView();
  toast(mode === "replace" ? t("backupRestoredToast") : t("backupMergedToast"));
}

/* ---------- sample data (demo mode) ---------- */

/** Demo mode is a two-way door. It used to be offered only while `days` was
 *  completely empty, which meant that after painting a single real block you
 *  could never see the demo again — the most common way people ask for it
 *  ("show me what this looks like full") was exactly the one that couldn't
 *  be answered. It's now always available, made safe by only ever writing
 *  into dates that hold no real day (see loadSampleData), so entering and
 *  leaving it can never cost you anything you logged yourself. */
function renderSampleDataUI() {
  const active = sampleDayKeys.length > 0;
  $("sample-data-block").hidden = false;
  $("load-sample-data").hidden = active;
  $("clear-sample-data").hidden = !active;
  $("sample-data-note").textContent = active ? t("demoModeOnNote") : t("demoModeOffNote");
  renderDemoBanner();
}

/** The banner is the only thing distinguishing a demo streak from a real
 *  one at a glance, so it follows the data, not the view. */
function renderDemoBanner() {
  $("demo-banner").hidden = sampleDayKeys.length === 0;
}

function loadSampleData() {
  if (tabIsStale) return;
  if (sampleDayKeys.length > 0) return; // already on; the button is hidden, but don't trust that alone
  const sample = buildSampleDays(new Date(), t);
  const toSet = {};
  const claimed = [];
  // Real days win every collision. Demo mode is meant to illustrate, never
  // to overwrite — so it fills the gaps around your data instead.
  for (const [key, day] of sample) {
    if (days.has(key)) continue;
    days.set(key, day);
    toSet[DAY_PREFIX + key] = day;
    claimed.push(key);
  }
  sampleDayKeys = claimed;
  toSet[SAMPLE_DAY_KEYS_KEY] = sampleDayKeys;
  saveLocal(toSet).catch(reportStorageFailure);

  switchDay(state.viewDate);
  renderStrip();
  renderStreak();
  renderAboutBests();
  refreshCurrentView();
  renderSampleDataUI();
  renderFirstRunHint();
  toast(claimed.length ? t("demoModeOnToast") : t("demoModeNothingToAddToast"));
}

function clearSampleData() {
  if (tabIsStale) return;
  if (sampleDayKeys.length === 0) return;
  for (const key of sampleDayKeys) days.delete(key);
  removeLocal([...sampleDayKeys.map((k) => DAY_PREFIX + k), SAMPLE_DAY_KEYS_KEY])
    .catch(reportStorageFailure);
  sampleDayKeys = [];

  switchDay(state.viewDate);
  renderStrip();
  renderStreak();
  renderAboutBests();
  refreshCurrentView();
  renderSampleDataUI();
  renderFirstRunHint();
  toast(t("demoModeOffToast"));
}

/* ---------- multi-day fill ---------- */

/** Enabled categories only, plus an option to erase — the same pen set a
 *  multi-day fill can actually paint with. */
function syncMultiFillCategorySelect() {
  const select = $("multifill-cat-select");
  const previous = select.value;
  select.replaceChildren();
  for (const c of categories.filter((cat) => cat.enabled)) {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = c.name;
    select.appendChild(opt);
  }
  const erase = document.createElement("option");
  erase.value = "erase";
  erase.textContent = t("eraseOptionLabel");
  select.appendChild(erase);
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
}

/** {keys, fromSlot, toSlot, categoryId} awaiting the second confirm click —
 *  categoryId is UNTRACKED for "erase". Null when nothing is pending. */
let pendingMultiFill = null;
let multiFillConfirmArmed = false;
let multiFillConfirmArmTimer = null;

function resetMultiFillConfirmButton() {
  multiFillConfirmArmed = false;
  clearTimeout(multiFillConfirmArmTimer);
  $("multifill-confirm-btn").textContent = t("confirmFillLabel");
}

function cancelMultiFill() {
  pendingMultiFill = null;
  resetMultiFillConfirmButton();
  $("multifill-confirm").hidden = true;
}

/**
 * Validates the date range and time window and, if they check out, shows a
 * confirm box naming how many days would change and how many of those
 * already have painted time in the affected window — nothing is written
 * until the arm-then-confirm click on "Confirm fill" below, same pattern as
 * "Clear day" and "Replace everything".
 */
function showMultiFillConfirm() {
  const rangeResult = dateRangeKeys($("multifill-start-input").value, $("multifill-end-input").value);
  if (!rangeResult.ok) {
    toast(tm(rangeResult.error));
    return;
  }
  const slotResult = multiDayFillSlotRange($("multifill-from-time").value, $("multifill-to-time").value);
  if (!slotResult.ok) {
    toast(tm(slotResult.error));
    return;
  }

  const catValue = $("multifill-cat-select").value;
  const categoryId = catValue === "erase" ? UNTRACKED : Number(catValue);
  const action =
    catValue === "erase"
      ? t("multifillActionErase")
      : t("multifillActionSetTo", [categories.find((c) => c.id === categoryId)?.name ?? t("multifillUnknownCategory")]);

  const { keys } = rangeResult;
  const { fromSlot, toSlot } = slotResult;
  const summary = summarizeMultiDayFill(days, keys, fromSlot, toSlot);
  pendingMultiFill = { keys, fromSlot, toSlot, categoryId };

  // "00:00 to 00:00" is what a whole-day window rounds to (fmtClock reads a
  // slot-96 boundary as midnight, same as a run that ends at day's end
  // everywhere else in the app) — technically correct but reads as zero
  // duration, so the common case gets its own plain wording instead.
  const windowLabel =
    fromSlot === 0 && toSlot === SLOTS
      ? t("multifillWindowWholeDay")
      : t("multifillWindowRange", [fmtSlotClock(fromSlot), fmtSlotClock(toSlot)]);

  $("multifill-confirm").hidden = false;
  const summarySentence = tp("multifillSummary", summary.dayCount, [
    String(summary.dayCount), keys[0], keys[keys.length - 1], action, windowLabel,
  ]);
  const paintedSentence =
    summary.paintedCount > 0
      ? tp("multifillPainted", summary.paintedCount, [String(summary.paintedCount)])
      : t("multifillNonePainted");
  $("multifill-summary").textContent = `${summarySentence} ${paintedSentence}`;
  resetMultiFillConfirmButton();
}

/**
 * Writes every affected day in one call, so the whole fill either lands
 * together or (on a storage error) fails together rather than leaving the
 * range half-applied. The day currently on screen is patched in memory too,
 * so the dial doesn't keep showing stale slots for a day it just overwrote.
 */
function applyMultiFill() {
  if (!pendingMultiFill || tabIsStale) return;
  const { keys, fromSlot, toSlot, categoryId } = pendingMultiFill;
  const viewedKey = dateKey(state.viewDate);

  const toSet = {};
  const claimedSampleKeys = [];
  let clampedDays = 0;
  let written = 0;
  for (const key of keys) {
    // Each day gets its own limit: past days take the whole window, today
    // takes the part that has elapsed, and a day still ahead takes none.
    // Without this, "every weekday, 9–5" applied on a Monday morning would
    // write this afternoon and the rest of the week as already worked.
    const limit = categoryId === UNTRACKED ? SLOTS : writeLimitForKey(key);
    const end = Math.min(toSlot, limit);
    if (end <= fromSlot) {
      clampedDays++;
      continue;
    }
    if (end < toSlot) clampedDays++;

    const existing = days.get(key);
    const slots = fillSlotWindow(existing?.slots ?? emptyDay().slots, fromSlot, end, categoryId);
    const data = {
      slots,
      reflection: existing?.reflection ?? "",
      notes: existing?.notes ?? [],
      intents: existing?.intents ?? [],
      avoid: existing?.avoid ?? [],
    };
    days.set(key, data);
    toSet[DAY_PREFIX + key] = data;
    written++;
    if (key === viewedKey) state.slots = [...slots];
    // Same rule as persistDay: writing into a demo day makes it yours.
    if (sampleDayKeys.includes(key)) claimedSampleKeys.push(key);
  }

  if (claimedSampleKeys.length) {
    sampleDayKeys = sampleDayKeys.filter((k) => !claimedSampleKeys.includes(k));
    toSet[SAMPLE_DAY_KEYS_KEY] = sampleDayKeys;
  }

  saveLocal(toSet).catch(reportStorageFailure);
  cancelMultiFill();

  renderAll();
  renderStrip();
  renderStreak();
  renderAboutBests();
  if (claimedSampleKeys.length) renderSampleDataUI();
  renderFirstRunHint();
  refreshCurrentView();
  // `written` rather than `keys.length`: days wholly in the future were
  // skipped, and reporting the range's size would claim work that no day
  // actually received.
  if (written === 0) toast(t("futureNotLogged"));
  else if (clampedDays) toast(tp("filledDaysUpToNow", written, [String(written)]));
  else toast(tp("filledDays", written, [String(written)]));
}

/* ---------- google drive backup ---------- */

/** Best-effort: never throws, never blocks the caller. A stale or missing
 *  email is corrected the next time any Drive action successfully connects. */
async function refreshDriveAccountEmail(token) {
  const email = await driveFetchAccountEmail(token);
  if (email && email !== driveAccountEmail) {
    driveAccountEmail = email;
    saveLocal({ [DRIVE_ACCOUNT_EMAIL_KEY]: email }).catch(reportStorageFailure);
    renderDriveStatus();
  }
}

function renderDriveStatus() {
  const size = fmtBytes(driveBackupSizeBytes);
  $("drive-account").textContent = driveAccountEmail ? t("driveConnectedAsStatus", [driveAccountEmail]) : "";
  $("drive-account").hidden = !driveAccountEmail;
  $("drive-status").textContent = driveLastSyncAt
    ? t("driveLastSyncStatus", [dateFmt({ dateStyle: "medium", timeStyle: "short" }).format(new Date(driveLastSyncAt))]) + (size ? ` · ${size}` : "")
    : driveFileId
      ? t("driveConnectedNoUploadStatus")
      : t("driveNotBackedUpStatus");
  // Gated on "is this account linked at all", not "have you uploaded". A
  // restore links the account and leaves a file id behind without ever
  // setting a sync time, so keying these off `driveLastSyncAt` meant someone
  // who only ever restored could never revoke access or delete the cloud
  // copy — they'd have to upload first, the exact thing they were avoiding.
  // The file lives in appDataFolder, so there's no escape via Drive's UI.
  const driveLinked = Boolean(driveLastSyncAt || driveFileId);
  $("drive-disconnect").hidden = !driveLinked;
  $("drive-delete").hidden = !driveLinked;
}

async function driveBackupNow() {
  // A stale snapshot uploaded here would overwrite the cloud copy too.
  if (tabIsStale) return;
  // Both file exports refuse to write an empty backup; this one used to run
  // the whole OAuth consent flow first and then report success for a file
  // containing nothing. Demo days don't count — they're excluded below.
  if (excludeDays(days, sampleDayKeys).size === 0) {
    toast(days.size === 0 ? t("nothingToBackupToast") : t("onlyDemoBackupToast"));
    return;
  }
  toast(t("driveConnectingToast"));
  try {
    const token = await driveConnect();
    refreshDriveAccountEmail(token); // fire-and-forget; the backup doesn't wait on it
    const existing = driveFileId ? { id: driveFileId } : await driveFindBackupFile(token);
    // Demo days are excluded here too: a Drive backup taken during demo mode
    // would otherwise restore fabricated history as if it were the user's.
    const backup = buildBackup(
      excludeDays(days, sampleDayKeys),
      categories,
      settings,
      chrome.runtime.getManifest().version
    );
    const backupText = JSON.stringify(backup);
    driveFileId = await driveUploadBackup(token, existing?.id ?? null, backupText);
    driveLastSyncAt = Date.now();
    // The exact byte count of what was just uploaded — no extra API round
    // trip, no broader Drive scope, just measuring what this tab already sent.
    driveBackupSizeBytes = new Blob([backupText]).size;
    await saveLocal({
      [DRIVE_FILE_ID_KEY]: driveFileId,
      [DRIVE_LAST_SYNC_KEY]: driveLastSyncAt,
      [DRIVE_BACKUP_SIZE_KEY]: driveBackupSizeBytes,
    }).catch(reportStorageFailure);
    renderDriveStatus();
    toast(t("driveBackedUpToast"));
  } catch (err) {
    console.error("Daily Dial: Google Drive backup failed", err);
    toast(t("driveBackupErrorToast"));
  }
}

/** Downloads whatever this Google account's backup holds, then hands it to
 *  the exact same merge/replace confirmation flow a file import uses — Drive
 *  is just another place the same backup JSON can come from. */
async function driveRestore() {
  if (tabIsStale) return;
  toast(t("driveCheckingToast"));
  try {
    const token = await driveConnect();
    refreshDriveAccountEmail(token);
    const existing = await driveFindBackupFile(token);
    if (!existing) {
      toast(t("driveNoBackupFoundToast"));
      return;
    }
    const text = await driveDownloadBackup(token, existing.id);
    const result = parseBackup(text);
    if (!result.ok) {
      toast(tm(result.error));
      return;
    }
    driveFileId = existing.id;
    saveLocal({ [DRIVE_FILE_ID_KEY]: driveFileId }).catch(reportStorageFailure);
    // The account is linked from here on, so the status line and the
    // disconnect/delete controls have to reflect that immediately.
    renderDriveStatus();
    pendingImport = {
      kind: "json",
      days: result.data.days,
      categories: result.data.categories,
      settings: result.data.settings,
    };
    showImportConfirm();
  } catch (err) {
    console.error("Daily Dial: Google Drive restore failed", err);
    toast(t("driveUnreachableToast"));
  }
}

async function driveDisconnectClick() {
  await driveDisconnect();
  driveFileId = null;
  driveLastSyncAt = null;
  driveBackupSizeBytes = null;
  driveAccountEmail = null;
  removeLocal([DRIVE_FILE_ID_KEY, DRIVE_LAST_SYNC_KEY, DRIVE_BACKUP_SIZE_KEY, DRIVE_ACCOUNT_EMAIL_KEY]).catch(reportStorageFailure);
  renderDriveStatus();
  toast(t("driveDisconnectedToast"));
}

/** Disconnecting only revokes this app's access to the account — the backup
 *  file itself keeps sitting in appDataFolder, invisible in the user's
 *  regular Drive, until something explicitly deletes it. This is that. */
async function driveDeleteBackupClick() {
  toast(t("driveDeletingToast"));
  try {
    const token = await driveConnect();
    const existing = driveFileId ? { id: driveFileId } : await driveFindBackupFile(token);
    if (!existing) {
      toast(t("driveNoBackupFoundToast"));
      return;
    }
    await driveDeleteBackup(token, existing.id);
    driveFileId = null;
    driveLastSyncAt = null;
    driveBackupSizeBytes = null;
    driveAccountEmail = null;
    removeLocal([DRIVE_FILE_ID_KEY, DRIVE_LAST_SYNC_KEY, DRIVE_BACKUP_SIZE_KEY, DRIVE_ACCOUNT_EMAIL_KEY]).catch(reportStorageFailure);
    renderDriveStatus();
    toast(t("driveDeletedToast"));
  } catch (err) {
    console.error("Daily Dial: Google Drive delete failed", err);
    toast(t("driveDeleteErrorToast"));
  }
}

/* ---------- settings panel ---------- */

let settingsLastFocused = null;

function switchSettingsTab(tab) {
  for (const btn of $("settings-tabs").children) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  }
  for (const sec of $("settings-body").children) {
    sec.classList.toggle("active", sec.dataset.panel === tab);
  }
}

function focusablesIn(panelId) {
  return [...$(panelId).querySelectorAll('button, [href], input, select, textarea, [tabindex]')].filter(
    (el) => !el.disabled && el.offsetParent !== null
  );
}

/** Escape closes, Tab cycles inside. Shared so every modal behaves the same
 *  way — the onboarding dialog claimed aria-modal but trapped nothing. */
function modalKeydownHandler(panelId, onClose) {
  return function handler(evt) {
    if (evt.key === "Escape") {
      evt.preventDefault();
      onClose();
      return;
    }
    if (evt.key !== "Tab") return;
    const focusables = focusablesIn(panelId);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (evt.shiftKey && document.activeElement === first) {
      evt.preventDefault();
      last.focus();
    } else if (!evt.shiftKey && document.activeElement === last) {
      evt.preventDefault();
      first.focus();
    }
  };
}

const onSettingsKeydown = modalKeydownHandler("settings-panel", () => closeSettings());
const onOnboardingKeydown = modalKeydownHandler("onboarding-overlay", () => dismissOnboarding());

function openSettings(tab = "categories") {
  settingsLastFocused = document.activeElement;
  switchSettingsTab(tab);
  $("settings-overlay").hidden = false;
  document.addEventListener("keydown", onSettingsKeydown, true);
  $("settings-panel").focus();
}

function closeSettings() {
  $("settings-overlay").hidden = true;
  document.removeEventListener("keydown", onSettingsKeydown, true);
  if (settingsLastFocused instanceof HTMLElement) settingsLastFocused.focus();
}

/* ---------- onboarding (first run) ---------- */

let onboardingLastFocused = null;

function showOnboarding() {
  onboardingLastFocused = document.activeElement;
  document.addEventListener("keydown", onOnboardingKeydown, true);
  $("onboarding-overlay").hidden = false;
  // Demo mode fills only unlogged dates now, so this offer stays honest at
  // any point in an account's life — it's hidden only while demo mode is
  // already on, when the action would be a no-op.
  $("onboarding-sample-link-wrap").hidden = sampleDayKeys.length > 0;
  $("onboarding-overlay").querySelector(".onboarding-panel").focus();
}

function dismissOnboarding() {
  $("onboarding-overlay").hidden = true;
  document.removeEventListener("keydown", onOnboardingKeydown, true);
  if (onboardingLastFocused instanceof HTMLElement) onboardingLastFocused.focus();
  // Every exit from the tour leaves the hint behind, not just "Let's start".
  // Skipping means "don't lecture me", which a dismissible one-line pointer
  // respects — being dropped on a blank dial with no affordance at all does
  // not, and that was the whole complaint the tour was meant to answer.
  renderFirstRunHint();
  if (onboardingSeen) return;
  onboardingSeen = true;
  saveLocal({ [ONBOARDING_SEEN_KEY]: true }).catch(reportStorageFailure);
}

/** A toast alone was the wrong instrument here: "Let's start" hands a brand
 *  new user an empty dial, and a message that erases itself after 2.6s left
 *  them staring at one with no idea what to touch. The durable half of the
 *  handoff is the first-run hint pinned above the pens — the toast is now
 *  just the acknowledgement that the click registered. */
function dismissOnboardingAndNudge() {
  dismissOnboarding();
  renderFirstRunHint();
  toast(days.size === 0 ? t("onboardingNudgePaintToast") : t("onboardingNudgeSettingsToast"));
}

/** Only for someone who has genuinely nothing painted. `days.size` is the
 *  wrong test here: saving a reflection, or clearing a day, writes a day
 *  record whose slots are all untracked, which would retire the hint while
 *  the ring is still empty. `dayHasEntries` is the same criterion the
 *  heatmap, streak, and history-empty checks already use. */
let firstRunHintDismissed = false;

function renderFirstRunHint() {
  const painted = [...days.values()].some(dayHasEntries);
  $("first-run-hint").hidden = firstRunHintDismissed || painted;
}

/* ---------- wiring ---------- */

/* ---------- view switching ---------- */

/** Views render lazily: each registers a renderer here, called when shown. */
const viewRenderers = new Map();

export function registerView(name, render) {
  viewRenderers.set(name, render);
}

/** Read-only snapshot for other views (History, Applications) to render
 *  from, instead of each re-reading chrome.storage itself. */
export const getAppData = () => ({ days, categories, settings, silenced: silencedObservations });

/** Silencing is permanent by design: "dismiss for now" would just mean the
 *  same observation returning every week to someone who has already decided
 *  their answer, which is the definition of nagging. */
export function silenceObservation(id) {
  if (silencedObservations.includes(id)) return;
  silencedObservations = [...silencedObservations, id];
  saveLocal({ [SILENCED_KEY]: silencedObservations }).catch(reportStorageFailure);
}

let currentView = "day";

function showView(name) {
  currentView = name;
  for (const tab of document.querySelectorAll(".view-tab")) {
    const active = tab.dataset.view === name;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  for (const view of document.querySelectorAll(".view")) {
    view.hidden = view.id !== `view-${name}`;
  }
  // The date navigation only means anything on the Day view.
  $("datenav-wrap").hidden = name !== "day";
  viewRenderers.get(name)?.();
}

/** Jumps another view (e.g. a History heatmap cell or search result) to a
 *  given date on the Day view — the same day-switching path the 7-day strip
 *  uses, plus the view switch itself. */
export function goToDay(d) {
  switchDay(d);
  showView("day");
}

function wireViewNav() {
  $("view-nav").addEventListener("click", (evt) => {
    const tab = evt.target.closest(".view-tab");
    if (tab) showView(tab.dataset.view);
  });
}

/** Re-render whichever non-Day view is showing, after data changes. */
export function refreshCurrentView() {
  if (currentView !== "day") viewRenderers.get(currentView)?.();
}

function renderAll() {
  renderDateLabel();
  renderDial();
  renderPens();
  renderSide();
  renderStrip();
  renderStreak();
  renderBackupStatus();
  // The breakdown is a view of the same slots the dial draws, so it has to
  // move with them — painting a block changes which stretches exist.
  renderBreakdown();
}

function wireEvents() {
  // A backgrounded tab gets throttled timers, so the 30s tick can't be
  // relied on to notice midnight. Coming back to the tab re-checks at once.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkDayRollover();
  });
  $("stale-banner-reload").addEventListener("click", () => window.location.reload());
  $("intent-form").addEventListener("submit", addIntent);
  $("avoid-form").addEventListener("submit", addAvoid);
  $("challenge-chip").addEventListener("click", () => openSettings("goals"));
  for (const id of ["challenge-name-input", "challenge-start-input", "challenge-target-input"]) {
    $(id).addEventListener("change", saveChallenge);
  }
  $("challenge-clear").addEventListener("click", clearChallenge);
  $("template-form").addEventListener("submit", (evt) => {
    evt.preventDefault();
    saveTemplateFromToday();
  });
  $("observations-on").addEventListener("change", saveObservations);
  $("auto-backup-on").addEventListener("change", saveAutoBackup);
  $("just-painted-save").addEventListener("click", saveJustPainted);
  $("just-painted-dismiss").addEventListener("click", hideJustPainted);
  $("just-painted-note").addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") { evt.preventDefault(); saveJustPainted(); }
    if (evt.key === "Escape") hideJustPainted();
  });
  // The recap notification focuses an existing dial rather than reloading it
  // (a reload would discard unsaved edits), so the switch arrives as a message.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "showHistory") showView("history");
  });

  $("prev-day").addEventListener("click", () => {
    const d = new Date(state.viewDate);
    d.setDate(d.getDate() - 1);
    switchDay(d);
  });
  $("next-day").addEventListener("click", () => {
    const d = new Date(state.viewDate);
    d.setDate(d.getDate() + 1);
    // Stops at today. This is a record of what happened, and there was no
    // limit before — you could walk forward indefinitely and paint days that
    // hadn't occurred, which then carried a score and sat in History looking
    // like something you'd done.
    if (dateKey(d) > dateKey(new Date())) {
      toast(t("futureDayToast"));
      return;
    }
    switchDay(d);
  });
  $("today-jump").addEventListener("click", () => switchDay(new Date()));

  $("reflection").addEventListener("input", (evt) => {
    state.reflection = evt.target.value;
    if (state.reflectTimer) clearTimeout(state.reflectTimer);
    state.reflectTimer = setTimeout(() => {
      state.reflectTimer = null;
      persistDay();
    }, 500);
  });

  $("copy-yesterday").addEventListener("click", copyYesterday);
  $("share-image").addEventListener("click", shareAsImage);
  $("typed-entry-form").addEventListener("submit", submitTypedEntry);

  // Two-step confirm rather than a modal — destructive, but undoable.
  const clearBtn = $("clear-day");
  let armed = false;
  let armTimer = null;
  clearBtn.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      clearBtn.textContent = t("clearDayConfirmLabel");
      armTimer = setTimeout(() => {
        armed = false;
        clearBtn.textContent = t("clearDayLabel");
      }, 3000);
      return;
    }
    clearTimeout(armTimer);
    armed = false;
    clearBtn.textContent = t("clearDayLabel");
    pushUndo();
    state.slots = new Array(SLOTS).fill(UNTRACKED);
    persistDay();
    renderAll();
    toast(t("dayClearedToast"));
  });

  // ---- quick dial layout switcher ----
  $("dial-layout-switch").addEventListener("click", (evt) => {
    const btn = evt.target.closest("button[data-mode]");
    if (btn) setDialMode(btn.dataset.mode);
  });

  // ---- ampm-toggle dial layout ----
  $("toggle-am-btn").addEventListener("click", () => setToggleHalf("am"));
  $("toggle-pm-btn").addEventListener("click", () => setToggleHalf("pm"));

  // ---- settings panel ----
  wireViewNav();

  $("open-settings").addEventListener("click", () => openSettings());
  // The hint line names one shortcut; the rest live in About rather than
  // crowding the dial.
  $("hint-shortcuts").addEventListener("click", () => openSettings("about"));
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-overlay").addEventListener("click", (evt) => {
    if (evt.target === $("settings-overlay")) closeSettings();
  });
  $("settings-tabs").addEventListener("click", (evt) => {
    const btn = evt.target.closest("button[data-tab]");
    if (btn) switchSettingsTab(btn.dataset.tab);
  });

  // ---- onboarding (first run, and replayable from About) ----
  $("onboarding-start").addEventListener("click", dismissOnboardingAndNudge);
  $("onboarding-skip").addEventListener("click", dismissOnboarding);
  $("onboarding-overlay").addEventListener("click", (evt) => {
    if (evt.target === $("onboarding-overlay")) dismissOnboarding();
  });
  $("replay-onboarding").addEventListener("click", () => {
    closeSettings();
    showOnboarding();
  });
  $("onboarding-sample-data").addEventListener("click", () => {
    dismissOnboarding(); // a different path was chosen — no "go paint" nudge
    loadSampleData();
    showView("history");
  });
  $("history-empty-sample-data").addEventListener("click", loadSampleData);
  $("demo-banner-exit").addEventListener("click", clearSampleData);
  $("first-run-hint-dismiss").addEventListener("click", () => {
    firstRunHintDismissed = true;
    renderFirstRunHint();
  });

  // ---- reminders + weekly recap ----
  for (const id of ["reminders-on", "reminder-1", "reminder-2", "weekly-recap-on", "weekly-recap-day", "weekly-recap-time"]) {
    $(id).addEventListener("change", saveReminders);
  }

  // ---- appearance ----
  for (const id of [
    "theme-select", "time-format-select", "dial-mode-select", "week-start-select",
    "day-window-start", "day-window-end",
  ]) {
    $(id).addEventListener("change", saveAppearance);
  }
  // Not part of saveAppearance: the language lives in localStorage, not in
  // `settings`, so it never travels in a backup to someone else's device.
  $("language-select").addEventListener("change", onLanguageChange);

  // ---- data: export/import ----
  $("export-csv").addEventListener("click", exportCsv);
  $("export-json").addEventListener("click", exportJson);
  $("backup-nudge-export").addEventListener("click", exportJson);
  $("backup-nudge-dismiss").addEventListener("click", dismissNudge);
  $("data-nudge-dismiss").addEventListener("click", dismissNudge);

  $("import-trigger").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (evt) => {
    const file = evt.target.files?.[0];
    if (file) handleImportFile(file);
  });
  $("import-cancel").addEventListener("click", cancelImport);
  $("import-merge").addEventListener("click", () => applyImport("merge"));
  $("import-replace").addEventListener("click", () => {
    if (!replaceArmed) {
      replaceArmed = true;
      $("import-replace").textContent = t("replaceArmedLabel");
      replaceArmTimer = setTimeout(() => {
        replaceArmed = false;
        $("import-replace").textContent = t("replaceEverythingLabel");
      }, 4000);
      return;
    }
    clearTimeout(replaceArmTimer);
    applyImport("replace");
  });

  // ---- data: sample data ----
  $("load-sample-data").addEventListener("click", loadSampleData);
  $("clear-sample-data").addEventListener("click", clearSampleData);

  // ---- data: multi-day fill ----
  $("multifill-apply").addEventListener("click", showMultiFillConfirm);
  $("multifill-cancel").addEventListener("click", cancelMultiFill);
  // Two-step confirm rather than a modal — same pattern as "Clear day" and
  // "Replace everything": the box above already named what will change, so
  // this is the arm-then-confirm click that actually writes it.
  $("multifill-confirm-btn").addEventListener("click", () => {
    if (!multiFillConfirmArmed) {
      multiFillConfirmArmed = true;
      $("multifill-confirm-btn").textContent = t("multifillArmedLabel");
      multiFillConfirmArmTimer = setTimeout(resetMultiFillConfirmButton, 4000);
      return;
    }
    applyMultiFill();
  });

  // ---- data: google drive ----
  $("drive-backup").addEventListener("click", driveBackupNow);
  $("drive-restore").addEventListener("click", driveRestore);
  $("drive-disconnect").addEventListener("click", driveDisconnectClick);

  // Two-step confirm rather than a modal — destructive, and unlike local
  // data this one isn't covered by ⌘Z.
  const deleteBtn = $("drive-delete");
  let deleteArmed = false;
  let deleteArmTimer = null;
  deleteBtn.addEventListener("click", () => {
    if (!deleteArmed) {
      deleteArmed = true;
      deleteBtn.textContent = t("driveDeleteArmedLabel");
      deleteArmTimer = setTimeout(() => {
        deleteArmed = false;
        deleteBtn.textContent = t("driveDeleteLabel");
      }, 4000);
      return;
    }
    clearTimeout(deleteArmTimer);
    deleteArmed = false;
    deleteBtn.textContent = t("driveDeleteLabel");
    driveDeleteBackupClick();
  });

  window.addEventListener("beforeunload", flushReflection);
}

registerView("day", renderAll);
registerView("history", renderHistory);

async function boot() {
  const version = chrome.runtime.getManifest().version;
  $("version").textContent = `v${version}`;
  $("about-version").textContent = `v${version}`;
  $("multifill-max-days").textContent = String(MULTI_DAY_FILL_MAX_DAYS);

  renderTicksInto($("ticks"), 24, pad2);
  const clockFaceLabel = (h) => (h === 0 ? "12" : String(h));
  renderTicksInto($("ticks-am"), 12, clockFaceLabel);
  renderTicksInto($("ticks-pm"), 12, clockFaceLabel);

  wireEvents();

  await loadAll();
  // Only after loadAll: the in-memory copy this compares against has to
  // exist before a foreign write can be told apart from our own.
  watchForOtherTabs();
  applyTheme();

  // Load the day through the same path a date change uses, rather than a
  // second inline copy: the inline version never picked up notes, intents,
  // or the avoid list, so the journal rendered empty until you navigated
  // to another day and back.
  const day = getDay(dateKey(state.viewDate));
  state.slots = [...day.slots];
  state.reflection = day.reflection;
  state.notes = (day.notes ?? []).map((n) => ({ ...n }));
  state.intents = (day.intents ?? []).map((i) => ({ ...i }));
  state.avoid = [...(day.avoid ?? [])];
  $("reflection").value = state.reflection;
  renderJournal();

  syncReminderInputs();
  syncAppearanceInputs();
  renderCategoryEditor();
  renderGoalsEditor();
  renderTemplatesEditor();
  renderAboutBests();
  renderDriveStatus();
  renderSampleDataUI();
  renderChallenge();
  syncChallengeInputs();
  syncObservationInputs();
  syncAutoBackupInputs();
  reconcileActivePen();
  applyDialMode();
  renderAll();
  // A weekly recap notification opens the dial at #history, since the numbers
  // it just quoted all live on that page.
  if (window.location.hash === "#history") showView("history");

  // Only after the overlay is dealt with: a returning user who never
  // painted anything still gets the hint, but not stacked under a modal.
  if (onboardingSeen) renderFirstRunHint();
  else showOnboarding();

  setInterval(refreshLive, 30_000);
}

boot();
