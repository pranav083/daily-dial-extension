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

function persistDay() {
  const key = dateKey(state.viewDate);
  const data = { slots: state.slots, reflection: state.reflection };
  days.set(key, data);
  chrome.storage.local.set({ [DAY_PREFIX + key]: data }).catch(reportStorageFailure);
}

const persistCategories = () =>
  chrome.storage.local
    .set({ [CATEGORIES_KEY]: categories.map(({ name, weight, enabled, aliases }) => ({ name, weight, enabled, aliases })) })
    .catch(reportStorageFailure);

const persistSettings = () =>
  chrome.storage.local.set({ [SETTINGS_KEY]: settings }).catch(reportStorageFailure);

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

function showTooltip(evt, idx) {
  const run = runAt(state.slots, idx);
  const fmt = (i) => fmtClock(i, settings.timeFormat);
  tooltip.textContent = run
    ? `${fmt(run.start)}–${fmt(run.end)}  ·  ${categories[run.cat].name}`
    : `${fmt(idx)}–${fmt(idx + 1)}  ·  untracked`;
  tooltip.classList.add("show");
  tooltip.style.left = `${evt.clientX}px`;
  tooltip.style.top = `${evt.clientY}px`;
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

  let isPaintingLocal = false;
  let lastLocal = null;

  const localSlice = () => state.slots.slice(slotOffset, slotOffset + slotsInView);
  const writeSlice = (sub) => {
    for (let i = 0; i < slotsInView; i++) state.slots[slotOffset + i] = sub[i];
  };

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
    // the other one isn't 10:30am just because this half's twin is.
    centerTimeEl.textContent =
      localMin === null
        ? "--:--"
        : fmtClock(Math.round((now.getHours() * 60 + now.getMinutes()) / SLOT_MIN), settings.timeFormat);
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
    if (dist < R_IN - 30 || dist > R_OUT + 40) {
      hideTooltip();
      return;
    }
    const idx = slotFromAngle(angle, slotsInView);
    if (isPaintingLocal) {
      paintAtLocal(idx);
      render();
    }
    showTooltip(evt, slotOffset + idx);
  });

  svgNode.addEventListener("pointerup", endPaintLocal);
  svgNode.addEventListener("pointercancel", endPaintLocal);
  window.addEventListener("pointerup", endPaintLocal);
  svgNode.addEventListener("pointerleave", hideTooltip);

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

/** The clock-face upkeep a 30-second timer does: move the needle, refresh
 *  the centre time. No data changed, so segments are left alone. */
function refreshLive() {
  for (const engine of activeEngines()) {
    engine.renderNeedle();
    engine.renderCenter();
  }
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
  const input = $("typed-entry-input");
  const result = parseTimeEntry(input.value, categories);
  if (!result.ok) {
    toast(result.error);
    return;
  }
  pushUndo();
  for (let i = result.startSlot; i < result.endSlot; i++) state.slots[i % SLOTS] = result.categoryId;
  persistDay();
  renderAll();
  input.value = "";
  toast("Added");
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
  const csv = buildCsv(days, categories);
  if (!csv) {
    toast("Nothing logged yet to export.");
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
  if (days.size === 0) {
    toast("Nothing logged yet to export.");
    return;
  }
  const backup = buildBackup(days, categories, settings, chrome.runtime.getManifest().version);
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
  const summary = summarizeImport(days, pendingImport.days);
  $("import-confirm").hidden = false;
  $("import-summary").textContent =
    `${summary.incomingCount} day${summary.incomingCount === 1 ? "" : "s"} in the file, ` +
    `${summary.overlapping} overlapping your ${summary.existingCount} existing. ` +
    `Merge adds ${summary.newCount} new day${summary.newCount === 1 ? "" : "s"}. ` +
    `Replace erases all ${summary.existingCount} existing day${summary.existingCount === 1 ? "" : "s"} and restores exactly what's in the file.`;
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
  if (!pendingImport) return;

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
  // A replace discards every prior day outright, sample ones included — the
  // old bookkeeping would otherwise point at days that are now either gone
  // or overwritten with the file's own content for that date.
  if (mode === "replace" && sampleDayKeys.length) {
    sampleDayKeys = [];
    chrome.storage.local.remove(SAMPLE_DAY_KEYS_KEY).catch(reportStorageFailure);
  }

  chrome.storage.local.set(toSet).catch(reportStorageFailure);
  if (removeKeys.length) chrome.storage.local.remove(removeKeys).catch(reportStorageFailure);
  if (mode === "replace" && pendingImport.settings) {
    chrome.runtime.sendMessage({ type: "reschedule" }).catch(() => {});
  }

  cancelImport();
  switchDay(state.viewDate);
  applyTheme();
  syncReminderInputs();
  syncAppearanceInputs();
  renderCategoryEditor();
  renderGoalsEditor();
  renderBackupStatus();
  renderSampleDataUI();
  toast(mode === "replace" ? "Backup restored" : "Backup merged in");
}

/* ---------- sample data (demo mode) ---------- */

/** "Load" only makes sense before there's any real data — once anything
 *  real exists, offering to overwrite it with fake days risks real
 *  confusion for no real benefit. "Clear" only makes sense once sample data
 *  is actually the thing currently loaded. */
function renderSampleDataUI() {
  const offerable = days.size === 0;
  const active = sampleDayKeys.length > 0;
  // Once real data exists and sample data was never loaded, this whole
  // block has nothing useful to say — showing the section label and blurb
  // with no reachable button under it read as broken, not just inactive.
  $("sample-data-block").hidden = !offerable && !active;
  $("load-sample-data").hidden = !offerable;
  $("clear-sample-data").hidden = !active;
  $("sample-data-note").textContent = active
    ? "Loaded. Check History for the heatmap and trends, or clear it below whenever you're ready to log for real."
    : "See how History, streaks, and goals look with three weeks of varied (fake) days, before you've logged anything of your own.";
}

function loadSampleData() {
  if (days.size > 0) return; // the button is hidden in this case, but don't trust that alone
  const sample = buildSampleDays(new Date());
  const toSet = {};
  for (const [key, day] of sample) {
    days.set(key, day);
    toSet[DAY_PREFIX + key] = day;
  }
  sampleDayKeys = [...sample.keys()];
  toSet[SAMPLE_DAY_KEYS_KEY] = sampleDayKeys;
  chrome.storage.local.set(toSet).catch(reportStorageFailure);

  switchDay(state.viewDate);
  renderStrip();
  renderStreak();
  renderAboutBests();
  refreshCurrentView();
  renderSampleDataUI();
  toast("Loaded sample data — see History, or clear it below");
}

function clearSampleData() {
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
  toast("Sample data cleared");
}

/* ---------- google drive backup ---------- */

function renderDriveStatus() {
  $("drive-status").textContent = driveLastSyncAt
    ? `Last synced to Google Drive: ${new Date(driveLastSyncAt).toLocaleString()}`
    : "Not backed up to Google Drive yet.";
  $("drive-disconnect").hidden = !driveLastSyncAt;
  $("drive-delete").hidden = !driveLastSyncAt;
}

async function driveBackupNow() {
  toast("Connecting to Google Drive…");
  try {
    const token = await driveConnect();
    const existing = driveFileId ? { id: driveFileId } : await driveFindBackupFile(token);
    const backup = buildBackup(days, categories, settings, chrome.runtime.getManifest().version);
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
  // Only a real offer the first time (or a replay before anything's been
  // logged) — once real data exists, loadSampleData() would no-op anyway,
  // same as the equivalent link in Settings → About.
  $("onboarding-sample-link-wrap").hidden = days.size > 0;
  $("onboarding-overlay").querySelector(".onboarding-panel").focus();
}

function dismissOnboarding() {
  $("onboarding-overlay").hidden = true;
  if (onboardingSeen) return;
  onboardingSeen = true;
  chrome.storage.local.set({ [ONBOARDING_SEEN_KEY]: true }).catch(reportStorageFailure);
}

/** "Let's start" closing into silence read as a dead end — it should hand
 *  off to something. Only nudges when the visible day is still genuinely
 *  blank, so replaying the tour later (via About) doesn't lecture someone
 *  who's clearly already painting. Skip and clicking outside stay silent —
 *  both are "I don't need the help," and get to mean that. */
function dismissOnboardingAndNudge() {
  dismissOnboarding();
  if (!state.slots.some((v) => v !== UNTRACKED)) {
    toast("Pick a category below, then drag around the ring to paint");
  }
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
  applyDialMode();
  renderAll();
  if (!onboardingSeen) showOnboarding();

  setInterval(refreshLive, 30_000);
}

boot();
