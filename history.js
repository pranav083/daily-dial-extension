/**
 * History view — page controller.
 *
 * Owns the DOM for the History tab only; all calculation lives in
 * historyLib.js. Data comes from dial.js's in-memory store via `getAppData`
 * rather than reading storage directly — dial.js already owns loading and
 * keeping that store current.
 */
/* global document */

import { dayHasEntries, fmtDuration, sameDay, scoreBucket, toneVar } from "./lib.js";
import {
  buildMonthGrid,
  categoryTrendDirection,
  categoryTrendsByWeek,
  deltaDirection,
  monthSummary,
  searchNotes,
  weekOverWeek,
} from "./historyLib.js";
import { getAppData, goToDay } from "./dial.js";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const ARROW = { up: "▲", down: "▼", flat: "·" };

/** Which month the heatmap/summary/trends are showing. Day-of-month is
 *  ignored everywhere it's read; only kept as a Date for easy +/-1 month math. */
const state = { cursor: new Date() };

let wired = false;

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function monthLabel(year, month) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(year, month, 1));
}

const fmtScore = (n) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n}`);
const fmtPct = (n) => (n === null ? "—" : `${n}%`);

/* ---------- month heatmap ---------- */

/** Background intensity scales with |score|, so the heatmap reads as a
 *  gradient rather than three flat buckets — a +5 day and a +95 day both
 *  read "good" but shouldn't look identical. */
function heatColor(score) {
  const bucket = scoreBucket(score);
  const intensity = Math.max(30, Math.min(90, 30 + Math.abs(score) * 0.6));
  return `color-mix(in oklab, var(${toneVar(bucket.tone)}) ${intensity}%, var(--panel-2))`;
}

function renderHeatmap(year, month, days, categories, weekStart) {
  const el = $("hist-heatmap");
  el.replaceChildren();

  const header = document.createElement("div");
  header.className = "hist-heatmap-row hist-heatmap-header";
  header.setAttribute("role", "row");
  for (let i = 0; i < 7; i++) {
    const cell = document.createElement("div");
    cell.className = "hist-dow";
    cell.setAttribute("role", "columnheader");
    cell.textContent = DOW[(weekStart + i) % 7];
    header.appendChild(cell);
  }
  el.appendChild(header);

  const weeks = buildMonthGrid(year, month, days, categories, weekStart);
  const today = new Date();

  for (const week of weeks) {
    const row = document.createElement("div");
    row.className = "hist-heatmap-row";
    row.setAttribute("role", "row");

    for (const cell of week) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "gridcell");
      btn.className = "hist-day";
      if (!cell.inMonth) btn.classList.add("out");
      if (sameDay(cell.date, today)) btn.classList.add("today");

      let label;
      if (cell.logged) {
        btn.classList.add("logged");
        btn.style.background = heatColor(cell.score);
        label = `${cell.date.toDateString()} — score ${fmtScore(cell.score)}, ${fmtDuration(cell.trackedMin)} tracked`;
      } else {
        btn.classList.add("empty");
        label = `${cell.date.toDateString()} — not logged`;
      }
      btn.setAttribute("aria-label", label);
      btn.title = label;

      const num = document.createElement("span");
      num.className = "hist-day-num";
      num.textContent = String(cell.day);
      btn.appendChild(num);

      const cellDate = new Date(cell.date);
      btn.addEventListener("click", () => goToDay(cellDate));
      row.appendChild(btn);
    }
    el.appendChild(row);
  }
}

/* ---------- month summary ---------- */

function statTile(value, label) {
  const stat = document.createElement("div");
  stat.className = "stat";
  const v = document.createElement("div");
  v.className = "v";
  v.textContent = value;
  const l = document.createElement("div");
  l.className = "l";
  l.textContent = label;
  stat.append(v, l);
  return stat;
}

function renderSummary(year, month, days, categories) {
  const summary = monthSummary(year, month, days, categories);

  const statsEl = $("hist-summary-stats");
  statsEl.replaceChildren(
    statTile(String(summary.daysLogged), "Days logged"),
    statTile(fmtDuration(summary.totalTrackedMin), "Tracked"),
    statTile(fmtScore(summary.avgScore), "Avg score"),
    statTile(fmtPct(summary.avgProductivePct), "Avg productive")
  );

  const extra = $("hist-summary-extra");
  extra.replaceChildren();

  const best = document.createElement("p");
  best.className = "hist-extra-line";
  best.textContent = summary.bestDay
    ? `Best day: ${summary.bestDay.key} (${fmtScore(summary.bestDay.score)})`
    : "Best day: — nothing scored yet this month.";
  extra.appendChild(best);

  const streak = document.createElement("p");
  streak.className = "hist-extra-line";
  streak.title = "Consecutive logged days, counted only within this month — it doesn't borrow from the month before or after.";
  streak.textContent = `Streak this month: ${summary.currentStreak} current · ${summary.longestStreak} longest`;
  extra.appendChild(streak);
}

/* ---------- category trends ---------- */

function trendSvg(weeks, catIndex, cls) {
  const svg = document.createElementNS(SVG_NS, "svg");
  const w = Math.max(1, weeks.length) * 24;
  svg.setAttribute("viewBox", `0 0 ${w} 60`);
  svg.setAttribute("class", "hist-trend-svg");
  svg.setAttribute("preserveAspectRatio", "none");

  const max = Math.max(1, ...weeks.map((wk) => wk.perCatMin[catIndex]));
  weeks.forEach((wk, i) => {
    const min = wk.perCatMin[catIndex];
    const barH = Math.round((min / max) * 50);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(i * 24 + 4));
    rect.setAttribute("y", String(58 - barH));
    rect.setAttribute("width", "16");
    rect.setAttribute("height", String(min > 0 ? Math.max(barH, 2) : 0));
    rect.setAttribute("rx", "2");
    rect.setAttribute("class", cls);
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `Week of ${wk.weekStartKey}: ${fmtDuration(min)}`;
    rect.appendChild(title);
    svg.appendChild(rect);
  });
  return svg;
}

function renderTrends(year, month, days, categories, weekStart) {
  const weeks = categoryTrendsByWeek(year, month, days, categories, weekStart);
  const el = $("hist-trends");
  el.replaceChildren();

  if (weeks.every((wk) => wk.perCatMin.every((m) => m === 0))) {
    const p = document.createElement("p");
    p.className = "editor-note";
    p.textContent = "Nothing logged this month yet — trends fill in as you paint days on the dial.";
    el.appendChild(p);
    return;
  }

  categories.forEach((c, i) => {
    const card = document.createElement("div");
    card.className = "hist-trend";

    const head = document.createElement("div");
    head.className = "hist-trend-head";
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = `var(--${c.cls})`;
    const name = document.createElement("span");
    name.className = "hist-trend-name";
    name.textContent = c.name;
    const dir = categoryTrendDirection(weeks, i);
    const dirEl = document.createElement("span");
    dirEl.className = `hist-trend-dir ${dir}`;
    dirEl.title = "First week vs. last week shown, so a single dip in the middle doesn't flip the read.";
    dirEl.textContent = ARROW[dir];
    head.append(sw, name, dirEl);

    card.append(head, trendSvg(weeks, i, c.cls));
    el.appendChild(card);
  });
}

/* ---------- week over week ---------- */

function wowRow(label, curText, prevText, delta, fmtDelta) {
  const row = document.createElement("div");
  row.className = "hist-wow-row";

  const nameEl = document.createElement("span");
  nameEl.className = "hist-wow-label";
  nameEl.textContent = label;

  const curEl = document.createElement("span");
  curEl.className = "hist-wow-val";
  curEl.textContent = curText;

  const dir = deltaDirection(delta);
  const deltaEl = document.createElement("span");
  deltaEl.className = `hist-wow-delta ${dir}`;
  deltaEl.title = `Last week: ${prevText}`;
  deltaEl.textContent = delta === null ? "n/a" : `${ARROW[dir]} ${fmtDelta(Math.abs(delta))}`;

  row.append(nameEl, curEl, deltaEl);
  return row;
}

function renderWeekOverWeek(days, categories, weekStart) {
  const wow = weekOverWeek(days, categories, weekStart, new Date());
  const el = $("hist-wow");
  el.replaceChildren(
    wowRow("Tracked", fmtDuration(wow.current.trackedMin), fmtDuration(wow.previous.trackedMin), wow.deltas.trackedMin, fmtDuration),
    wowRow(
      "Productive",
      fmtPct(wow.current.avgProductivePct),
      fmtPct(wow.previous.avgProductivePct),
      wow.deltas.avgProductivePct,
      (n) => `${n}pt`
    ),
    wowRow("Avg score", fmtScore(wow.current.avgScore), fmtScore(wow.previous.avgScore), wow.deltas.avgScore, (n) => `${n}`)
  );
}

/* ---------- note search ---------- */

function renderSearch(days, query) {
  const el = $("hist-search-results");
  el.replaceChildren();

  const q = query.trim();
  if (!q) {
    const p = document.createElement("p");
    p.className = "editor-note";
    p.textContent = "Type to search your reflections.";
    el.appendChild(p);
    return;
  }

  const matches = searchNotes(days, q);
  if (matches.length === 0) {
    const p = document.createElement("p");
    p.className = "editor-note";
    p.textContent = `No notes match "${q}".`;
    el.appendChild(p);
    return;
  }

  for (const m of matches) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hist-search-result";
    btn.title = "Jump to this day";

    const date = document.createElement("span");
    date.className = "hist-search-date";
    date.textContent = m.key;

    const snippet = document.createElement("span");
    snippet.className = "hist-search-snippet";
    snippet.textContent = m.snippet;

    btn.append(date, snippet);
    btn.addEventListener("click", () => goToDay(new Date(`${m.key}T00:00:00`)));
    el.appendChild(btn);
  }
}

/* ---------- wiring ---------- */

function ensureWired() {
  if (wired) return;
  wired = true;

  $("hist-prev-month").addEventListener("click", () => {
    state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1);
    renderHistory();
  });
  $("hist-next-month").addEventListener("click", () => {
    state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1);
    renderHistory();
  });
  $("hist-this-month").addEventListener("click", () => {
    state.cursor = new Date();
    renderHistory();
  });
  $("hist-search").addEventListener("input", (evt) => {
    renderSearch(getAppData().days, evt.target.value);
  });
}

/** Registered with dial.js's view switcher; called every time the History
 *  tab is shown, and again after any data change while it's the active view. */
export function renderHistory() {
  ensureWired();
  const { days, categories, settings } = getAppData();

  const anyData = [...days.values()].some((d) => dayHasEntries(d));
  $("history-empty").hidden = anyData;
  $("history-content").hidden = !anyData;
  if (!anyData) return;

  const year = state.cursor.getFullYear();
  const month = state.cursor.getMonth();

  $("hist-month-label").textContent = monthLabel(year, month);
  $("hist-this-month").hidden = isSameMonth(state.cursor, new Date());

  renderHeatmap(year, month, days, categories, settings.weekStart);
  renderSummary(year, month, days, categories);
  renderTrends(year, month, days, categories, settings.weekStart);
  renderWeekOverWeek(days, categories, settings.weekStart);
  renderSearch(days, $("hist-search").value);
}
