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
  R_IN,
  R_OUT,
  SETTINGS_KEY,
  SLOTS,
  SLOT_MIN,
  UNTRACKED,
  WEIGHT_GLYPH,
  angleAt,
  buildCsv,
  buildInsight,
  computeRuns,
  computeStats,
  dateKey,
  emptyDay,
  fillRange,
  fmtDuration,
  fmtHM,
  isValidTime,
  normalizeCategories,
  normalizeDay,
  normalizeSettings,
  pad2,
  polar,
  runAt,
  sameDay,
  scoreBucket,
  slotFromAngle,
  toneVar,
  wedgePath,
} from "./lib.js";

const $ = (id) => document.getElementById(id);
const isToday = (d) => sameDay(d, new Date());

/** @type {Map<string, {slots:number[], reflection:string}>} */
const days = new Map();
let categories = normalizeCategories(null);
let settings = normalizeSettings(null);

const state = {
  viewDate: new Date(),
  slots: new Array(SLOTS).fill(UNTRACKED),
  reflection: "",
  activePen: 0,
  isPainting: false,
  lastSlot: null,
  reflectTimer: null,
};

/* ---------- storage ---------- */

async function loadAll() {
  const all = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(DAY_PREFIX)) days.set(key.slice(DAY_PREFIX.length), normalizeDay(value));
  }
  categories = normalizeCategories(all[CATEGORIES_KEY]);
  settings = normalizeSettings(all[SETTINGS_KEY]);
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
    .set({ [CATEGORIES_KEY]: categories.map(({ name, weight, enabled }) => ({ name, weight, enabled })) })
    .catch(reportStorageFailure);

const persistSettings = () =>
  chrome.storage.local.set({ [SETTINGS_KEY]: settings }).catch(reportStorageFailure);

function reportStorageFailure(err) {
  console.error("Daily Dial: could not save", err);
  toast("Couldn't save — your last change may be lost.");
}

/* ---------- SVG scaffolding ---------- */

const NS = "http://www.w3.org/2000/svg";
const svg = $("dial");
const segLayer = $("segments");
const tickLayer = $("ticks");
const needleLayer = $("needle");
const tooltip = $("tooltip");

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function renderTicks() {
  tickLayer.replaceChildren();
  for (let h = 0; h < 24; h++) {
    const angle = h * 15;
    const major = h % 3 === 0;
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
      label.textContent = pad2(h);
      tickLayer.appendChild(label);
    }
  }
}

/** Hairline gap between adjacent wedges so neighbouring blocks stay distinct. */
const WEDGE_GAP_DEG = 0.55;

function renderSegments() {
  segLayer.replaceChildren();
  for (const run of computeRuns(state.slots)) {
    const a0 = run.start * (360 / SLOTS);
    const a1 = run.end * (360 / SLOTS);
    const gap = Math.min(WEDGE_GAP_DEG, (a1 - a0) * 0.3);
    segLayer.appendChild(
      svgEl("path", {
        class: `seg ${categories[run.cat].cls}`,
        d: wedgePath(R_IN, R_OUT, a0 + gap, a1 - gap),
      })
    );
  }
}

function renderNeedle() {
  needleLayer.replaceChildren();
  if (!isToday(state.viewDate)) return;
  const now = new Date();
  const angle = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 360;
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
  const now = new Date();
  $("center-time").textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const pen = categories[state.activePen];
  $("center-sub").textContent = pen ? `pen: ${pen.name}` : "eraser";
}

const renderDial = () => {
  renderSegments();
  renderNeedle();
  renderCenter();
};

/* ---------- tooltip ---------- */

function showTooltip(evt, idx) {
  const run = runAt(state.slots, idx);
  tooltip.textContent = run
    ? `${fmtHM(run.start)}–${fmtHM(run.end)}  ·  ${categories[run.cat].name}`
    : `${fmtHM(idx)}–${fmtHM(idx + 1)}  ·  untracked`;
  tooltip.classList.add("show");
  tooltip.style.left = `${evt.clientX}px`;
  tooltip.style.top = `${evt.clientY}px`;
}

const hideTooltip = () => tooltip.classList.remove("show");

/* ---------- undo ---------- */

/** One entry per completed gesture, tagged with its day so stepping back
 *  through history can't drop a stroke onto the wrong date. */
const undoStack = [];
const UNDO_LIMIT = 30;

function pushUndo() {
  undoStack.push({ key: dateKey(state.viewDate), slots: [...state.slots] });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function undo() {
  const key = dateKey(state.viewDate);
  while (undoStack.length && undoStack.at(-1).key !== key) undoStack.pop();
  const entry = undoStack.pop();
  if (!entry) {
    toast("Nothing to undo");
    return;
  }
  state.slots = entry.slots;
  persistDay();
  renderAll();
  toast("Undone");
}

/* ---------- painting ---------- */

function svgPointFromEvent(evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function paintAt(idx) {
  const cat = state.activePen === null ? UNTRACKED : state.activePen;
  if (state.lastSlot === null) state.slots[idx] = cat;
  else state.slots = fillRange(state.slots, state.lastSlot, idx, cat);
  state.lastSlot = idx;
}

svg.addEventListener("pointerdown", (evt) => {
  if (evt.button !== 0) return;
  const p = svgPointFromEvent(evt);
  const { angle, dist } = angleAt(p.x, p.y);
  if (dist < R_IN - 14 || dist > R_OUT + 18) return;

  pushUndo();
  state.isPainting = true;
  state.lastSlot = null;
  try {
    svg.setPointerCapture(evt.pointerId);
  } catch {
    // Synthetic or already-released pointers can't be captured; painting still works.
  }
  const idx = slotFromAngle(angle);
  paintAt(idx);
  renderDial();
  showTooltip(evt, idx);
});

svg.addEventListener("pointermove", (evt) => {
  const p = svgPointFromEvent(evt);
  const { angle, dist } = angleAt(p.x, p.y);
  if (dist < R_IN - 30 || dist > R_OUT + 40) {
    hideTooltip();
    return;
  }
  const idx = slotFromAngle(angle);
  if (state.isPainting) {
    paintAt(idx);
    renderDial();
  }
  showTooltip(evt, idx);
});

function endPaint() {
  if (!state.isPainting) return;
  state.isPainting = false;
  state.lastSlot = null;
  persistDay();
  renderSide();
  renderStrip();
}

svg.addEventListener("pointerup", endPaint);
svg.addEventListener("pointercancel", endPaint);
window.addEventListener("pointerup", endPaint);
svg.addEventListener("pointerleave", hideTooltip);

window.addEventListener("keydown", (evt) => {
  if (!(evt.metaKey || evt.ctrlKey) || evt.key.toLowerCase() !== "z") return;
  if (evt.target instanceof HTMLTextAreaElement || evt.target instanceof HTMLInputElement) return;
  evt.preventDefault();
  undo();
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
      renderCenter();
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
    renderCenter();
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

function renderSide() {
  const stats = computeStats(state.slots, categories);

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
      renderCenter();
      renderSide();
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
      renderPens();
      renderCenter();
      renderSide();
    });

    row.append(swatch, input, seg, toggle);
    rowsEl.appendChild(row);
  }
}

/* ---------- reminders ---------- */

function syncReminderInputs() {
  $("reminders-on").checked = settings.remindersOn;
  $("reminder-1").value = settings.times[0];
  $("reminder-2").value = settings.times[1];
  $("reminder-1").disabled = !settings.remindersOn;
  $("reminder-2").disabled = !settings.remindersOn;
}

function saveReminders() {
  const t1 = $("reminder-1").value;
  const t2 = $("reminder-2").value;
  settings = normalizeSettings({
    remindersOn: $("reminders-on").checked,
    times: [isValidTime(t1) ? t1 : settings.times[0], isValidTime(t2) ? t2 : settings.times[1]],
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

/* ---------- CSV export ---------- */

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
  toast("Exported CSV");
}

/* ---------- disclosure panels ---------- */

function wireDisclosure(btnId, panelId, openLabel, closedLabel, onOpen) {
  const btn = $(btnId);
  const panel = $(panelId);
  btn.addEventListener("click", () => {
    const open = panel.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = open ? openLabel : closedLabel;
    if (open) onOpen?.();
  });
}

/* ---------- wiring ---------- */

function renderAll() {
  renderDateLabel();
  renderDial();
  renderPens();
  renderSide();
  renderStrip();
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

  $("export-csv").addEventListener("click", exportCsv);
  for (const id of ["reminders-on", "reminder-1", "reminder-2"]) {
    $(id).addEventListener("change", saveReminders);
  }

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

  wireDisclosure("toggle-categories", "cat-editor", "Done editing", "Edit categories", renderCategoryEditor);
  wireDisclosure("toggle-reminders", "reminder-editor", "Done", "Reminders", syncReminderInputs);

  window.addEventListener("beforeunload", flushReflection);
}

async function boot() {
  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  renderTicks();
  wireEvents();

  await loadAll();

  const day = getDay(dateKey(state.viewDate));
  state.slots = [...day.slots];
  state.reflection = day.reflection;
  $("reflection").value = state.reflection;
  syncReminderInputs();
  renderAll();

  setInterval(() => {
    renderNeedle();
    renderCenter();
  }, 30_000);
}

boot();
