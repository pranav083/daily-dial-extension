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
  CATEGORIES_KEY,
  DAY_PREFIX,
  DRIVE_FILE_ID_KEY,
  DRIVE_LAST_SYNC_KEY,
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
  buildShareSvgMarkup,
  computeRuns,
  computeStats,
  computeStreak,
  dateKey,
  dayHasEntries,
  emptyDay,
  fillRange,
  fmtClock,
  fmtDuration,
  goalProgress,
  hmToMinutes,
  isValidTime,
  mergeDayMaps,
  mostRecentWeekStart,
  normalizeAliases,
  normalizeCategories,
  normalizeDay,
  normalizeSettings,
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
  driveFindBackupFile,
  driveUploadBackup,
} from "./drive.js";

const $ = (id) => document.getElementById(id);
const isToday = (d) => sameDay(d, new Date());

/** @type {Map<string, {slots:number[], reflection:string}>} */
const days = new Map();
let categories = normalizeCategories(null);
let settings = normalizeSettings(null);
/** Device-local Google Drive connection bookkeeping — see DRIVE_FILE_ID_KEY. */
let driveFileId = null;
let driveLastSyncAt = null;
let onboardingSeen = false;
/** Exact date keys the currently-loaded sample data (if any) wrote — see
 *  SAMPLE_DAY_KEYS_KEY. Empty when sample data has never been loaded, or has
 *  already been cleared. */
let sampleDayKeys = [];

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
  categories = normalizeCategories(all[CATEGORIES_KEY]);
  settings = normalizeSettings(all[SETTINGS_KEY]);
  driveFileId = typeof all[DRIVE_FILE_ID_KEY] === "string" ? all[DRIVE_FILE_ID_KEY] : null;
  driveLastSyncAt = Number.isFinite(all[DRIVE_LAST_SYNC_KEY]) ? all[DRIVE_LAST_SYNC_KEY] : null;
  // Anyone with logged history already predates this feature entirely —
  // never show a first-run "welcome" to someone mid-way through real use,
  // even though the flag itself was never explicitly set for them.
  onboardingSeen = all[ONBOARDING_SEEN_KEY] === true || days.size > 0;
  sampleDayKeys = Array.isArray(all[SAMPLE_DAY_KEYS_KEY]) ? all[SAMPLE_DAY_KEYS_KEY] : [];

  if (all[SCHEMA_VERSION_KEY] !== SCHEMA_VERSION) {
    chrome.storage.local.set({ [SCHEMA_VERSION_KEY]: SCHEMA_VERSION }).catch(() => {
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

function markTabStale() {
  if (tabIsStale) return;
  tabIsStale = true;
  $("stale-banner").hidden = false;
  document.body.classList.add("is-stale");
  closeSettings();
}

/** True when a change came from somewhere else, rather than echoing our own
 *  write back at us. */
function isForeignChange(changes) {
  for (const [key, { newValue }] of Object.entries(changes)) {
    let mine;
    if (key.startsWith(DAY_PREFIX)) mine = days.get(key.slice(DAY_PREFIX.length));
    else if (key === CATEGORIES_KEY) mine = categories.map(({ name, weight, enabled, aliases }) => ({ name, weight, enabled, aliases }));
    else if (key === SETTINGS_KEY) mine = settings;
    else if (key === SAMPLE_DAY_KEYS_KEY) mine = sampleDayKeys;
    else continue; // bookkeeping we don't hold a copy of
    if (JSON.stringify(newValue) !== JSON.stringify(mine)) return true;
  }
  return false;
}

function watchForOtherTabs() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || tabIsStale) return;
    if (isForeignChange(changes)) markTabStale();
  });
}

function persistDay() {
  if (tabIsStale) return;
  const key = dateKey(state.viewDate);
  const data = { slots: state.slots, reflection: state.reflection };
  const wasEmpty = days.size === 0;
  days.set(key, data);
  chrome.storage.local.set({ [DAY_PREFIX + key]: data }).catch(reportStorageFailure);
  // Editing a demo day makes it yours. Without this it stays on the sample
  // list, and leaving demo mode would delete the day you just worked on.
  const sampleIdx = sampleDayKeys.indexOf(key);
  if (sampleIdx !== -1) {
    sampleDayKeys.splice(sampleIdx, 1);
    chrome.storage.local.set({ [SAMPLE_DAY_KEYS_KEY]: sampleDayKeys }).catch(reportStorageFailure);
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
    : chrome.storage.local
        .set({ [CATEGORIES_KEY]: categories.map(({ name, weight, enabled, aliases }) => ({ name, weight, enabled, aliases })) })
        .catch(reportStorageFailure);

const persistSettings = () =>
  tabIsStale ? undefined : chrome.storage.local.set({ [SETTINGS_KEY]: settings }).catch(reportStorageFailure);

function reportStorageFailure(err) {
  console.error("Daily Dial: could not save", err);
  toast("Couldn't save — your last change may be lost.");
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
    : [idx, idx + 1, "untracked"];
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

const hideTooltip = () => tooltip.classList.remove("show");

/* ---------- undo / redo ---------- */

/** One entry per completed gesture, tagged with its day so stepping back
 *  through history can't drop a stroke onto the wrong date. Redo mirrors undo
 *  exactly, and a new stroke clears whatever was available to redo. */
const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 30;

function pushUndo() {
  undoStack.push({ key: dateKey(state.viewDate), slots: [...state.slots] });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

function undo() {
  const key = dateKey(state.viewDate);
  while (undoStack.length && undoStack.at(-1).key !== key) undoStack.pop();
  const entry = undoStack.pop();
  if (!entry) {
    toast("Nothing to undo");
    return;
  }
  redoStack.push({ key, slots: [...state.slots] });
  if (redoStack.length > UNDO_LIMIT) redoStack.shift();
  state.slots = entry.slots;
  persistDay();
  renderAll();
  toast("Undone");
}

function redo() {
  const key = dateKey(state.viewDate);
  while (redoStack.length && redoStack.at(-1).key !== key) redoStack.pop();
  const entry = redoStack.pop();
  if (!entry) {
    toast("Nothing to redo");
    return;
  }
  undoStack.push({ key, slots: [...state.slots] });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  state.slots = entry.slots;
  persistDay();
  renderAll();
  toast("Redone");
}

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

  let isPaintingLocal = false;
  let lastLocal = null;

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

  const nameOf = (cat) => (cat === UNTRACKED ? "untracked" : categories[cat].name);

  /** Both sides of the seam at once — the point is seeing the trade. */
  function edgeTooltipText(at) {
    const g = (i) => fmtSlotClock(slotOffset + i);
    const { from, to, left, right } = dragEdge;
    const leftPart = at > from ? `${g(from)}–${g(at)} ${nameOf(left)}` : `${nameOf(left)} gone`;
    const rightPart = at < to ? `${g(at)}–${g(to)} ${nameOf(right)}` : `${nameOf(right)} gone`;
    return `${leftPart}   |   ${rightPart}`;
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
      centerTimeEl.title = "Time logged in this half";
    } else {
      centerTimeEl.textContent = fmtClock(
        Math.round((now.getHours() * 60 + now.getMinutes()) / SLOT_MIN),
        settings.timeFormat
      );
      centerTimeEl.title = "Current time";
    }
    const pen = categories[state.activePen];
    centerSubEl.textContent = pen ? `pen: ${pen.name}` : "eraser";
  }

  function render() {
    renderSegments();
    renderNeedle();
    renderCenter();
  }

  function svgPointFromEvent(evt) {
    const pt = svgNode.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svgNode.getScreenCTM().inverse());
  }

  function paintAtLocal(localIdx) {
    const cat = state.activePen === null ? UNTRACKED : state.activePen;
    if (lastLocal === null) {
      const sub = localSlice();
      sub[localIdx] = cat;
      writeSlice(sub);
    } else {
      writeSlice(fillRange(localSlice(), lastLocal, localIdx, cat));
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
    toast("It's a new day — the dial has rolled over");
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
  $("dial-toggle-switch").hidden = !isToggle;
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
  if (!$("settings-overlay").hidden) return; // settings panel owns its own keys (Esc, focus trap)
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
      renderPens();
      refreshCenters();
    }
    return;
  }
  if (evt.key === "0" || evt.key.toLowerCase() === "e") {
    state.activePen = UNTRACKED;
    renderPens();
    refreshCenters();
  }
});

/* ---------- pens ---------- */

function renderPens() {
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
      renderPens();
      refreshCenters();
    });
    pensEl.appendChild(btn);
  }

  const eraser = document.createElement("button");
  eraser.className = `pen eraser${state.activePen === UNTRACKED ? " active" : ""}`;
  eraser.setAttribute("aria-pressed", String(state.activePen === UNTRACKED));
  const eraserSwatch = document.createElement("span");
  eraserSwatch.className = "swatch";
  eraser.append(eraserSwatch, document.createTextNode("Eraser"));
  eraser.addEventListener("click", () => {
    state.activePen = UNTRACKED;
    renderPens();
    refreshCenters();
  });
  pensEl.appendChild(eraser);
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
  $("insight").innerHTML = buildInsight(stats, categories);

  const bucket = scoreBucket(stats.score);
  $("score-val").textContent = stats.score === null ? "—" : `${stats.score > 0 ? "+" : ""}${stats.score}`;
  $("score-badge").className = `score-badge ${bucket.tone}`;
  $("score-badge-text").textContent = bucket.label;

  const meter = $("meter-fill");
  meter.style.width = `${stats.score === null ? 50 : Math.max(0, Math.min(100, (stats.score + 100) / 2))}%`;
  meter.style.background = `var(${toneVar(bucket.tone)})`;

  const barsEl = $("cat-bars");
  barsEl.replaceChildren();
  const maxSlots = Math.max(...stats.perCat, stats.untrackedSlots, 1);
  categories.forEach((c, i) => barsEl.appendChild(catBarRow(c.name, c.cls, stats.perCat[i], maxSlots, false)));
  barsEl.appendChild(catBarRow("Untracked", null, stats.untrackedSlots, maxSlots, true));

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
    input.placeholder = "off";
    input.value = settings[goalsKey][c.id] ?? "";
    input.disabled = !c.enabled;
    input.setAttribute("aria-label", `${unitLabel === "min/day" ? "Daily" : "Weekly"} goal for ${c.name}, in minutes`);
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

/* ---------- streak ---------- */

function renderStreak() {
  const streak = computeStreak(days, new Date());
  $("streak-current").textContent = streak.current;
  $("streak-best").textContent = streak.longest;
  $("streak-icon").textContent = streak.current > 0 ? "🔥" : "○";
  $("streak-freeze").hidden = streak.freezesUsedThisWeek === 0;
  $("streak-risk").hidden = !streak.isAtRisk;
}

/* ---------- personal bests (About tab) ---------- */

function renderAboutBests() {
  const bests = personalBests(days, categories, new Date());
  $("bests-streak").textContent = `${bests.longestStreak} day${bests.longestStreak === 1 ? "" : "s"}`;
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
    ? `Last backup: ${new Date(settings.lastExportAt).toLocaleDateString()}`
    : "You haven't exported a backup yet.";

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

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function renderStrip() {
  const stripEl = $("strip");
  stripEl.replaceChildren();
  const today = new Date();

  for (let offset = -6; offset <= 0; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const stats = computeStats(getDay(dateKey(d)).slots, categories);
    const bucket = scoreBucket(stats.score);

    const btn = document.createElement("button");
    btn.className = `strip-day${sameDay(d, state.viewDate) ? " active" : ""}`;
    btn.setAttribute("aria-label", `${d.toDateString()} — ${bucket.label}`);

    const dow = document.createElement("span");
    dow.className = "dow";
    dow.textContent = DOW[d.getDay()];

    const track = document.createElement("span");
    track.className = "bar-track";
    const fill = document.createElement("span");
    fill.className = "bar-fill";
    fill.style.height = `${stats.score === null ? 6 : Math.max(6, (stats.score + 100) / 2)}%`;
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

  if (isToday(state.viewDate)) {
    label.textContent = "Today";
    jump.hidden = true;
    return;
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  label.textContent = sameDay(state.viewDate, yesterday)
    ? "Yesterday"
    : new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(state.viewDate);
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
  $("reflection").value = state.reflection;
  renderAll();
}

/* ---------- copy yesterday ---------- */

function copyYesterday() {
  const y = new Date(state.viewDate);
  y.setDate(y.getDate() - 1);
  const yDay = getDay(dateKey(y));

  if (!dayHasEntries(yDay)) {
    toast("Yesterday has nothing to copy.");
    return;
  }
  const todayHasData = state.slots.some((v) => v !== UNTRACKED);
  if (todayHasData && !window.confirm("Today already has entries — overwrite them with yesterday's?")) {
    return;
  }

  pushUndo();
  state.slots = [...yDay.slots];
  persistDay();
  renderAll();
  toast("Copied yesterday — ⌘Z to undo");
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
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric",
  }).format(state.viewDate);
  const streak = isToday(state.viewDate) ? computeStreak(days, new Date()) : null;
  const svgMarkup = buildShareSvgMarkup(state.slots, categories, dateLabel, streak);

  let blob;
  try {
    blob = await rasterizeSvgToPng(svgMarkup, 1000, 560);
  } catch (err) {
    console.error("Daily Dial: could not render a share image", err);
    toast("Couldn't create the image.");
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
  toast("Saved image");
}

/* ---------- typed entry ---------- */

function submitTypedEntry(evt) {
  evt.preventDefault();
  checkDayRollover();
  const input = $("typed-entry-input");
  const result = parseTimeEntry(input.value, categories);
  if (!result.ok) {
    toast(result.error);
    return;
  }
  pushUndo();
  // parseTimeEntry returns endSlot > SLOTS for a range that crosses midnight.
  // Wrapping it with `% SLOTS` folded the post-midnight part back onto the
  // *same* day: "11pm-1am" painted 23:00-24:00 and 00:00-01:00 of one day,
  // wiped whatever was already in that early hour, and split what should be
  // one two-hour block into two, so longest-focus read 60 minutes.
  const endOfDay = Math.min(result.endSlot, SLOTS);
  for (let i = result.startSlot; i < endOfDay; i++) state.slots[i] = result.categoryId;
  persistDay();

  const overflow = result.endSlot - SLOTS;
  if (overflow > 0) {
    const next = new Date(state.viewDate);
    next.setDate(next.getDate() + 1);
    paintIntoStoredDay(dateKey(next), 0, overflow, result.categoryId);
  }

  renderAll();
  renderStrip();
  renderStreak();
  input.value = "";
  toast(overflow > 0 ? "Added — the part past midnight went to the next day" : "Added");
}

/** Paints a range into a day that isn't the one on screen, going straight to
 *  storage. Used for the post-midnight half of an overnight entry. */
function paintIntoStoredDay(key, from, to, categoryId) {
  const existing = days.get(key);
  const slots = existing ? [...existing.slots] : emptyDay().slots;
  for (let i = from; i < to; i++) slots[i] = categoryId;
  const data = { slots, reflection: existing?.reflection ?? "" };
  days.set(key, data);
  chrome.storage.local.set({ [DAY_PREFIX + key]: data }).catch(reportStorageFailure);
  // Same rule as persistDay: writing to a demo day makes it yours.
  const sampleIdx = sampleDayKeys.indexOf(key);
  if (sampleIdx !== -1) {
    sampleDayKeys.splice(sampleIdx, 1);
    chrome.storage.local.set({ [SAMPLE_DAY_KEYS_KEY]: sampleDayKeys }).catch(reportStorageFailure);
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
    input.setAttribute("aria-label", "Category name");
    input.addEventListener("input", () => {
      c.name = input.value.trim() || c.name;
      persistCategories();
      renderPens();
      refreshCenters();
      renderSide();
      renderGoalsEditor();
      aliasInput.placeholder = `other words for "${c.name}"…`;
    });

    const seg = document.createElement("div");
    seg.className = "weight-seg";
    for (const w of [1, 0, -1]) {
      const b = document.createElement("button");
      b.textContent = WEIGHT_GLYPH[w];
      b.setAttribute("aria-pressed", String(c.weight === w));
      b.setAttribute(
        "aria-label",
        w === 1 ? "Counts toward score" : w === 0 ? "Neutral" : "Counts against score"
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
    toggle.setAttribute("aria-label", `${c.enabled ? "Hide" : "Show"} ${c.name}`);
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
    aliasInput.placeholder = `other words for "${c.name}"…`;
    aliasInput.setAttribute("aria-label", `Aliases for ${c.name} — other words the typed entry box recognizes`);
    aliasInput.addEventListener("change", () => {
      c.aliases = normalizeAliases(aliasInput.value.split(","));
      aliasInput.value = c.aliases.join(", "); // reflect trimming/dedup/caps back
      persistCategories();
    });
    aliasRow.appendChild(aliasInput);

    const item = document.createElement("div");
    item.className = "cat-edit-item";
    item.append(row, aliasRow);
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
      ? `Reminders set for ${settings.times[0]} and ${settings.times[1]}`
      : "Reminders off"
  );
}

/* ---------- appearance ---------- */

function syncAppearanceInputs() {
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
  toast("Appearance updated");
}

/* ---------- export ---------- */

function exportCsv() {
  // Same rule as the JSON export and the Drive backup: demo days are not
  // yours, so they never leave in a file that claims to be your history.
  const mine = excludeDays(days, sampleDayKeys);
  const csv = buildCsv(mine, categories);
  if (!csv) {
    toast(
      days.size === 0
        ? "Nothing logged yet to export."
        : "Only demo data is loaded — there's nothing of your own to export yet."
    );
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
  toast("Exported CSV");
}

function exportJson() {
  const mine = excludeDays(days, sampleDayKeys);
  if (mine.size === 0) {
    toast(
      days.size === 0
        ? "Nothing logged yet to export."
        : "Only demo data is loaded — there's nothing of your own to export yet."
    );
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
  toast("Exported JSON backup");
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
    toast("Couldn't read that file.");
    return;
  }

  const looksJson = file.name.toLowerCase().endsWith(".json") || text.trim().startsWith("{");
  const result = looksJson ? parseBackup(text) : parseCsv(text, categories);

  if (!result.ok) {
    toast(result.error);
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
  $("import-summary").textContent =
    `${summary.incomingCount} day${summary.incomingCount === 1 ? "" : "s"} in the file, ` +
    `${summary.overlapping} overlapping your ${summary.existingCount} existing. ` +
    `Merge adds ${summary.newCount} new day${summary.newCount === 1 ? "" : "s"}. ` +
    `Replace erases all ${summary.existingCount} existing day${summary.existingCount === 1 ? "" : "s"} and restores exactly what's in the file.` +
    (sampleDayKeys.length ? " Demo data will be cleared first." : "");
  replaceArmed = false;
  clearTimeout(replaceArmTimer);
  $("import-replace").textContent = "Replace everything";
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
    chrome.storage.local
      .remove([...sampleDayKeys.map((k) => DAY_PREFIX + k), SAMPLE_DAY_KEYS_KEY])
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
  chrome.storage.local.set(toSet).catch(reportStorageFailure);
  if (removeKeys.length) chrome.storage.local.remove(removeKeys).catch(reportStorageFailure);
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
  toast(mode === "replace" ? "Backup restored" : "Backup merged in");
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
  $("sample-data-note").textContent = active
    ? "Demo mode is on. Sample days fill only dates you hadn't logged — leaving it removes exactly those, and nothing of yours."
    : "See how History, streaks, and goals look with three weeks of varied (fake) days. Your own days are left as they are.";
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
  const sample = buildSampleDays(new Date());
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
  chrome.storage.local.set(toSet).catch(reportStorageFailure);

  switchDay(state.viewDate);
  renderStrip();
  renderStreak();
  renderAboutBests();
  refreshCurrentView();
  renderSampleDataUI();
  renderFirstRunHint();
  toast(
    claimed.length
      ? "Demo mode on — sample days added around your own"
      : "Every day in the sample range is already yours — nothing to add"
  );
}

function clearSampleData() {
  if (tabIsStale) return;
  if (sampleDayKeys.length === 0) return;
  for (const key of sampleDayKeys) days.delete(key);
  chrome.storage.local
    .remove([...sampleDayKeys.map((k) => DAY_PREFIX + k), SAMPLE_DAY_KEYS_KEY])
    .catch(reportStorageFailure);
  sampleDayKeys = [];

  switchDay(state.viewDate);
  renderStrip();
  renderStreak();
  renderAboutBests();
  refreshCurrentView();
  renderSampleDataUI();
  renderFirstRunHint();
  toast("Demo mode off — your own days are untouched");
}

/* ---------- google drive backup ---------- */

function renderDriveStatus() {
  $("drive-status").textContent = driveLastSyncAt
    ? `Last synced to Google Drive: ${new Date(driveLastSyncAt).toLocaleString()}`
    : driveFileId
      ? "Connected to Google Drive. Restored from a backup; nothing uploaded from here yet."
      : "Not backed up to Google Drive yet.";
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
    toast(
      days.size === 0
        ? "Nothing logged yet to back up."
        : "Only demo data is loaded — there's nothing of your own to back up yet."
    );
    return;
  }
  toast("Connecting to Google Drive…");
  try {
    const token = await driveConnect();
    const existing = driveFileId ? { id: driveFileId } : await driveFindBackupFile(token);
    // Demo days are excluded here too: a Drive backup taken during demo mode
    // would otherwise restore fabricated history as if it were the user's.
    const backup = buildBackup(
      excludeDays(days, sampleDayKeys),
      categories,
      settings,
      chrome.runtime.getManifest().version
    );
    driveFileId = await driveUploadBackup(token, existing?.id ?? null, JSON.stringify(backup));
    driveLastSyncAt = Date.now();
    await chrome.storage.local
      .set({ [DRIVE_FILE_ID_KEY]: driveFileId, [DRIVE_LAST_SYNC_KEY]: driveLastSyncAt })
      .catch(reportStorageFailure);
    renderDriveStatus();
    toast("Backed up to Google Drive");
  } catch (err) {
    console.error("Daily Dial: Google Drive backup failed", err);
    toast("Couldn't back up to Google Drive.");
  }
}

/** Downloads whatever this Google account's backup holds, then hands it to
 *  the exact same merge/replace confirmation flow a file import uses — Drive
 *  is just another place the same backup JSON can come from. */
async function driveRestore() {
  if (tabIsStale) return;
  toast("Checking Google Drive…");
  try {
    const token = await driveConnect();
    const existing = await driveFindBackupFile(token);
    if (!existing) {
      toast("No Daily Dial backup found in this Google account.");
      return;
    }
    const text = await driveDownloadBackup(token, existing.id);
    const result = parseBackup(text);
    if (!result.ok) {
      toast(result.error);
      return;
    }
    driveFileId = existing.id;
    chrome.storage.local.set({ [DRIVE_FILE_ID_KEY]: driveFileId }).catch(reportStorageFailure);
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
    toast("Couldn't reach Google Drive.");
  }
}

async function driveDisconnectClick() {
  await driveDisconnect();
  driveFileId = null;
  driveLastSyncAt = null;
  chrome.storage.local.remove([DRIVE_FILE_ID_KEY, DRIVE_LAST_SYNC_KEY]).catch(reportStorageFailure);
  renderDriveStatus();
  toast("Disconnected from Google Drive");
}

/** Disconnecting only revokes this app's access to the account — the backup
 *  file itself keeps sitting in appDataFolder, invisible in the user's
 *  regular Drive, until something explicitly deletes it. This is that. */
async function driveDeleteBackupClick() {
  toast("Deleting from Google Drive…");
  try {
    const token = await driveConnect();
    const existing = driveFileId ? { id: driveFileId } : await driveFindBackupFile(token);
    if (!existing) {
      toast("No Daily Dial backup found in this Google account.");
      return;
    }
    await driveDeleteBackup(token, existing.id);
    driveFileId = null;
    driveLastSyncAt = null;
    chrome.storage.local.remove([DRIVE_FILE_ID_KEY, DRIVE_LAST_SYNC_KEY]).catch(reportStorageFailure);
    renderDriveStatus();
    toast("Deleted your Google Drive backup");
  } catch (err) {
    console.error("Daily Dial: Google Drive delete failed", err);
    toast("Couldn't delete from Google Drive.");
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

function settingsFocusables() {
  return [...$("settings-panel").querySelectorAll('button, [href], input, select, textarea, [tabindex]')].filter(
    (el) => !el.disabled && el.offsetParent !== null
  );
}

function onSettingsKeydown(evt) {
  if (evt.key === "Escape") {
    evt.preventDefault();
    closeSettings();
    return;
  }
  if (evt.key !== "Tab") return;
  const focusables = settingsFocusables();
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
}

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

function showOnboarding() {
  $("onboarding-overlay").hidden = false;
  // Demo mode fills only unlogged dates now, so this offer stays honest at
  // any point in an account's life — it's hidden only while demo mode is
  // already on, when the action would be a no-op.
  $("onboarding-sample-link-wrap").hidden = sampleDayKeys.length > 0;
  $("onboarding-overlay").querySelector(".onboarding-panel").focus();
}

function dismissOnboarding() {
  $("onboarding-overlay").hidden = true;
  // Every exit from the tour leaves the hint behind, not just "Let's start".
  // Skipping means "don't lecture me", which a dismissible one-line pointer
  // respects — being dropped on a blank dial with no affordance at all does
  // not, and that was the whole complaint the tour was meant to answer.
  renderFirstRunHint();
  if (onboardingSeen) return;
  onboardingSeen = true;
  chrome.storage.local.set({ [ONBOARDING_SEEN_KEY]: true }).catch(reportStorageFailure);
}

/** A toast alone was the wrong instrument here: "Let's start" hands a brand
 *  new user an empty dial, and a message that erases itself after 2.6s left
 *  them staring at one with no idea what to touch. The durable half of the
 *  handoff is the first-run hint pinned above the pens — the toast is now
 *  just the acknowledgement that the click registered. */
function dismissOnboardingAndNudge() {
  dismissOnboarding();
  renderFirstRunHint();
  toast(
    days.size === 0
      ? "Pick a category below, then drag around the ring to paint"
      : "You're set — Settings (☰, top right) has categories, reminders, goals, and backup"
  );
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
export const getAppData = () => ({ days, categories, settings });

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
}

function wireEvents() {
  // A backgrounded tab gets throttled timers, so the 30s tick can't be
  // relied on to notice midnight. Coming back to the tab re-checks at once.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkDayRollover();
  });
  $("stale-banner-reload").addEventListener("click", () => window.location.reload());

  $("prev-day").addEventListener("click", () => {
    const d = new Date(state.viewDate);
    d.setDate(d.getDate() - 1);
    switchDay(d);
  });
  $("next-day").addEventListener("click", () => {
    const d = new Date(state.viewDate);
    d.setDate(d.getDate() + 1);
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
      clearBtn.textContent = "Confirm clear?";
      armTimer = setTimeout(() => {
        armed = false;
        clearBtn.textContent = "Clear day";
      }, 3000);
      return;
    }
    clearTimeout(armTimer);
    armed = false;
    clearBtn.textContent = "Clear day";
    pushUndo();
    state.slots = new Array(SLOTS).fill(UNTRACKED);
    persistDay();
    renderAll();
    toast("Day cleared — ⌘Z to undo");
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
      $("import-replace").textContent = "Click again to erase existing days";
      replaceArmTimer = setTimeout(() => {
        replaceArmed = false;
        $("import-replace").textContent = "Replace everything";
      }, 4000);
      return;
    }
    clearTimeout(replaceArmTimer);
    applyImport("replace");
  });

  // ---- data: sample data ----
  $("load-sample-data").addEventListener("click", loadSampleData);
  $("clear-sample-data").addEventListener("click", clearSampleData);

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
      deleteBtn.textContent = "Click again to delete permanently";
      deleteArmTimer = setTimeout(() => {
        deleteArmed = false;
        deleteBtn.textContent = "Delete Drive backup";
      }, 4000);
      return;
    }
    clearTimeout(deleteArmTimer);
    deleteArmed = false;
    deleteBtn.textContent = "Delete Drive backup";
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

  const day = getDay(dateKey(state.viewDate));
  state.slots = [...day.slots];
  state.reflection = day.reflection;
  $("reflection").value = state.reflection;

  syncReminderInputs();
  syncAppearanceInputs();
  renderCategoryEditor();
  renderGoalsEditor();
  renderAboutBests();
  renderDriveStatus();
  renderSampleDataUI();
  reconcileActivePen();
  applyDialMode();
  renderAll();
  // Only after the overlay is dealt with: a returning user who never
  // painted anything still gets the hint, but not stacked under a modal.
  if (onboardingSeen) renderFirstRunHint();
  else showOnboarding();

  setInterval(refreshLive, 30_000);
}

boot();
