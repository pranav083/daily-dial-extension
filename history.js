/**
 * History view — page controller.
 *
 * Owns the DOM for the History tab only; all calculation lives in
 * historyLib.js. Data comes from dial.js's in-memory store via `getAppData`
 * rather than reading storage directly — dial.js already owns loading and
 * keeping that store current.
 */
/* global document */

import {
  computeStats,
  dayHasContent,
  detectPatterns,
  dayHasEntries,
  fmtDuration,
  fmtHM,
  sameDay,
  scoreBucket,
  toneVar,
} from "./lib.js";
import {
  buildMonthGrid,
  categoryTrendDirection,
  categoryTrendsByWeek,
  deltaDirection,
  monthSummary,
  searchNotes,
  weekOverWeek,
} from "./historyLib.js";
import { getAppData, goToDay, silenceObservation } from "./dial.js";
import { suggestionFor } from "./suggestions.js";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const ARROW = { up: "▲", down: "▼", flat: "·" };

/** Which month the heatmap/summary/trends are showing. Day-of-month is
 *  ignored everywhere it's read; only kept as a Date for easy +/-1 month math. */
const state = { cursor: new Date() };

let wired = false;
/** Whether the cursor has been pointed at real data yet (once per session). */
let seeded = false;

/** The month of the most recent logged day, or null if nothing is logged. */
/**
 * The month to open on: the most recent one with painted time, or failing
 * that the most recent with anything written at all.
 *
 * The fallback matters for imported history. A journal brought in from
 * elsewhere carries notes and intentions but no painted slots, so keying this
 * on `dayHasEntries` alone left the cursor on the current month and the whole
 * import looked like it had failed.
 */
function latestLoggedMonth(days) {
  let painted = null;
  let anyContent = null;
  for (const [key, day] of days) {
    if (dayHasEntries(day) && (painted === null || key > painted)) painted = key;
    if (dayHasContent(day) && (anyContent === null || key > anyContent)) anyContent = key;
  }
  const key = painted ?? anyContent;
  return key ? new Date(key + "T00:00:00") : null;
}

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
  const cells = [];

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
      } else if (cell.written) {
        // Written up but no time painted. Marked rather than left blank: an
        // imported journal is entirely days like this, and showing them as
        // empty says "nothing happened" about days the user wrote about.
        btn.classList.add("written");
        label = `${cell.date.toDateString()} — written up, no time painted`;
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
      // Roving tabindex: the grid is one tab stop, arrows move within it.
      // Every cell being focusable meant ~40 presses to tab past the month.
      btn.tabIndex = -1;
      btn.dataset.cellIndex = String(cells.length);
      cells.push(btn);
      row.appendChild(btn);
    }
    el.appendChild(row);
  }

  // One cell holds the tab stop: today if it's on screen, else the first.
  const initial = cells.find((b) => b.classList.contains("today")) ?? cells[0];
  if (initial) initial.tabIndex = 0;

  el.onkeydown = (evt) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[evt.key];
    const here = cells.indexOf(document.activeElement);
    if (here === -1) return;
    let next = null;
    if (step !== undefined) next = Math.max(0, Math.min(cells.length - 1, here + step));
    else if (evt.key === "Home") next = 0;
    else if (evt.key === "End") next = cells.length - 1;
    if (next === null) return;
    evt.preventDefault();
    cells[here].tabIndex = -1;
    cells[next].tabIndex = 0;
    cells[next].focus();
  };
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

/** Days in this month carrying notes, intentions or a reflection but no
 *  painted time — the shape an imported journal takes. */
function writtenDaysInMonth(year, month, days) {
  let n = 0;
  for (const [key, day] of days) {
    const d = new Date(key + "T00:00:00");
    if (d.getFullYear() === year && d.getMonth() === month && dayHasContent(day) && !dayHasEntries(day)) n++;
  }
  return n;
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

  // Every number above counts painted time, so a month of imported journal
  // entries reads as a row of zeros next to a log that is visibly full —
  // which looks exactly like a failed import. Say what's actually there.
  if (summary.daysLogged === 0) {
    const written = writtenDaysInMonth(year, month, days);
    if (written > 0) {
      const note = document.createElement("p");
      note.className = "hist-extra-line";
      note.textContent =
        `${written} ${written === 1 ? "day is" : "days are"} written up this month but have no time painted on the dial, ` +
        `so they don't count toward anything above. They're all in the log below.`;
      extra.appendChild(note);
    }
  }
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
  deltaEl.title =
    delta === null ? "Nothing logged last week to compare against." : `Last week: ${prevText}`;
  // "n/a" is jargon for "nothing to compare against yet"; the dash is what
  // the rest of the app already uses for an absent number.
  deltaEl.textContent = delta === null ? "—" : `${ARROW[dir]} ${fmtDelta(Math.abs(delta))}`;

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
  $("log-range").addEventListener("click", (evt) => {
    const btn = evt.target.closest("button[data-range]");
    if (!btn) return;
    logRange = btn.dataset.range;
    for (const b of $("log-range").children) {
      b.setAttribute("aria-pressed", String(b.dataset.range === logRange));
    }
    renderHistory();
  });
  $("hist-search").addEventListener("input", (evt) => {
    renderSearch(getAppData().days, evt.target.value);
  });
}

/** Registered with dial.js's view switcher; called every time the History
 *  tab is shown, and again after any data change while it's the active view. */

/* ---------- the written log ---------- */

/** How far back the log reaches. Kept in module state so switching months
 *  in the panels above doesn't reset it. */
/** Widened once on first render if the default window is empty — see
 *  `seedLogRange`. */
let logRange = "week";
let logRangeSeeded = false;

/**
 * Opens on the narrowest range that actually contains something.
 *
 * "This week" is the right default for someone logging daily, and exactly the
 * wrong one the day you import months of history: the log renders empty and
 * reads as a failed import. Only ever widens, and only once, so it never
 * fights a range the user picked.
 */
function seedLogRange(days) {
  if (logRangeSeeded) return;
  logRangeSeeded = true;
  const withContent = [...days.entries()].filter(([, d]) => dayHasContent(d)).map(([k]) => k);
  if (withContent.length === 0) return;
  for (const range of ["week", "month", "all"]) {
    logRange = range;
    const start = logStartDate(new Date());
    const startKey = start ? dateKeyOf(start) : null;
    if (withContent.some((k) => startKey === null || k >= startKey)) break;
  }
  for (const b of $("log-range").children) {
    b.setAttribute("aria-pressed", String(b.dataset.range === logRange));
  }
}

function logStartDate(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (logRange === "week") d.setDate(d.getDate() - 6);
  else if (logRange === "month") d.setDate(d.getDate() - 29);
  else return null; // everything
  return d;
}

function logRow(when, body, extraClass = "") {
  const li = document.createElement("li");
  if (extraClass) li.className = extraClass;
  const w = document.createElement("span");
  w.className = "log-when";
  w.textContent = when;
  const b = document.createElement("span");
  b.className = "log-body body";
  b.textContent = body;
  li.append(w, b);
  return li;
}

function renderLogDay(key, day, categories) {
  const wrap = document.createElement("div");
  wrap.className = "log-day";

  const head = document.createElement("div");
  head.className = "log-day-head";

  const date = document.createElement("button");
  date.className = "log-date link-btn";
  date.type = "button";
  date.textContent = new Date(key + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long",
  });
  date.title = "Open this day";
  date.addEventListener("click", () => goToDay(key));
  head.appendChild(date);

  if (dayHasEntries(day)) {
    const stats = computeStats(day.slots, categories);
    const meta = document.createElement("span");
    meta.className = "log-meta";
    meta.textContent = fmtDuration(stats.trackedMin);
    head.appendChild(meta);
    if (stats.score !== null) {
      const bucket = scoreBucket(stats.score);
      const chip = document.createElement("span");
      chip.className = "log-score";
      chip.textContent = `${stats.score > 0 ? "+" : ""}${stats.score}`;
      chip.style.color = `var(${toneVar(bucket.tone)})`;
      chip.style.background = `color-mix(in oklab, var(${toneVar(bucket.tone)}) 16%, transparent)`;
      chip.title = bucket.label;
      head.appendChild(chip);
    }
  }
  wrap.appendChild(head);

  if ((day.intents ?? []).length) {
    const label = document.createElement("p");
    label.className = "log-section-label";
    label.textContent = "Meant to";
    const list = document.createElement("ul");
    list.className = "log-list";
    for (const intent of day.intents) {
      const li = document.createElement("li");
      li.className = intent.done ? "done" : "";
      const tick = document.createElement("span");
      tick.className = "tick";
      tick.textContent = intent.done ? "✓" : "○";
      const body = document.createElement("span");
      body.className = "log-body body";
      body.textContent = intent.text;
      li.append(tick, body);
      list.appendChild(li);
    }
    wrap.append(label, list);
  }

  if ((day.notes ?? []).length) {
    const label = document.createElement("p");
    label.className = "log-section-label";
    label.textContent = "What happened";
    const list = document.createElement("ul");
    list.className = "log-list";
    for (const note of day.notes) {
      list.appendChild(logRow(`${fmtHM(note.from)}–${fmtHM(note.to)}`, note.text));
    }
    wrap.append(label, list);
  }

  if ((day.avoid ?? []).length) {
    const label = document.createElement("p");
    label.className = "log-section-label";
    label.textContent = "Meant to avoid";
    const list = document.createElement("ul");
    list.className = "log-list";
    for (const text of day.avoid) {
      const li = document.createElement("li");
      const tick = document.createElement("span");
      tick.className = "tick";
      tick.textContent = "✕";
      const body = document.createElement("span");
      body.className = "log-body body";
      body.textContent = text;
      li.append(tick, body);
      list.appendChild(li);
    }
    wrap.append(label, list);
  }

  if ((day.reflection ?? "").trim()) {
    const p = document.createElement("p");
    p.className = "log-reflection";
    p.textContent = day.reflection;
    wrap.appendChild(p);
  }
  return wrap;
}

function renderLog(days, categories) {
  seedLogRange(days);
  const host = $("log-entries");
  host.replaceChildren();
  const start = logStartDate(new Date());
  const startKey = start ? dateKeyOf(start) : null;

  const keys = [...days.keys()]
    .filter((k) => (startKey === null || k >= startKey) && dayHasContent(days.get(k)))
    .sort()
    .reverse();

  $("log-empty").hidden = keys.length > 0;
  for (const key of keys) host.appendChild(renderLogDay(key, days.get(key), categories));
}

/** Local-date key, matching lib.js's dateKey without importing state. */
function dateKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------- worth noticing ---------- */

/**
 * Patterns from the user's own data, stated as facts.
 *
 * The suggestion list stays collapsed until asked for. An observation is
 * always defensible — it's arithmetic on data the user entered — whereas
 * unprompted advice reads as a lecture, and the thing people do with an app
 * that lectures them is stop opening it. Then the data stops too, which
 * costs far more than the advice was ever worth.
 */
function renderReview(days, categories, settings, silenced) {
  const card = $("review-card");
  const list = $("review-list");
  list.replaceChildren();

  const observations = settings.observationsOn === false
    ? []
    : detectPatterns(days, categories, settings, new Date()).filter((o) => !silenced.includes(o.id));
  card.hidden = observations.length === 0;
  if (observations.length === 0) return;

  for (const observation of observations) {
    list.appendChild(reviewItem(observation));
  }
}

function reviewItem(observation) {
  const item = document.createElement("div");
  item.className = "review-item";

  const headline = document.createElement("p");
  headline.className = "review-headline";
  headline.textContent = observation.headline;

  const detail = document.createElement("p");
  detail.className = "review-detail";
  detail.textContent = observation.detail;

  const actions = document.createElement("div");
  actions.className = "review-actions";

  const suggestion = suggestionFor(observation.suggestionKey);
  const panel = document.createElement("div");
  panel.className = "review-suggest";
  panel.hidden = true;

  if (suggestion) {
    const show = document.createElement("button");
    show.type = "button";
    show.className = "link-btn";
    show.textContent = "What people do about this";
    show.setAttribute("aria-expanded", "false");
    show.addEventListener("click", () => {
      const opening = panel.hidden;
      if (opening && !panel.childElementCount) panel.appendChild(suggestionBody(suggestion));
      panel.hidden = !opening;
      show.setAttribute("aria-expanded", String(opening));
      show.textContent = opening ? "Hide" : "What people do about this";
    });
    actions.appendChild(show);
  }

  const hide = document.createElement("button");
  hide.type = "button";
  hide.className = "link-btn";
  hide.textContent = "Don't show this again";
  hide.title = "Permanently, not just for now.";
  hide.addEventListener("click", () => {
    silenceObservation(observation.id);
    renderHistory();
  });
  actions.appendChild(hide);

  item.append(headline, detail, actions, panel);
  return item;
}

function suggestionBody(suggestion) {
  const wrap = document.createDocumentFragment();

  const lead = document.createElement("p");
  lead.className = "review-lead";
  lead.textContent = suggestion.lead;
  wrap.appendChild(lead);

  const list = document.createElement("ul");
  list.className = "review-approaches";
  for (const approach of suggestion.approaches) {
    const li = document.createElement("li");
    li.className = "review-approach";
    li.append(approach.text);
    if (approach.tools?.length) {
      const tools = document.createElement("div");
      tools.className = "review-tools";
      for (const tool of approach.tools) {
        const link = document.createElement("a");
        link.className = "review-tool";
        link.href = tool.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.append(tool.name);
        const platforms = document.createElement("span");
        platforms.className = "platforms";
        platforms.textContent = tool.platforms;
        link.appendChild(platforms);
        tools.appendChild(link);
      }
      li.appendChild(tools);
    }
    list.appendChild(li);
  }
  wrap.appendChild(list);

  const disclaimer = document.createElement("p");
  disclaimer.className = "review-disclaimer";
  disclaimer.textContent =
    "These are examples of an approach, not recommendations — none are affiliated with Daily Dial.";
  wrap.appendChild(disclaimer);

  return wrap;
}

export function renderHistory() {
  ensureWired();
  const { days, categories, settings, silenced } = getAppData();

  // Gated on *anything recorded*, not just painted time: a day carrying only
  // intentions or a note still belongs in the log, and hiding the whole view
  // meant the journal vanished until something was painted.
  const anyData = [...days.values()].some((d) => dayHasContent(d));
  $("history-empty").hidden = anyData;
  $("history-content").hidden = !anyData;
  if (!anyData) return;

  // The cursor starts on the month the page was opened in, which is empty
  // for anyone returning after a gap or restoring an older backup: four
  // panels of zeros, and only a bare "‹" hinting that the data is elsewhere.
  // On the first render, land on the most recent month that actually has
  // something in it. Later renders keep wherever the user navigated to.
  if (!seeded) {
    seeded = true;
    const latest = latestLoggedMonth(days);
    if (latest && !isSameMonth(state.cursor, latest)) state.cursor = latest;
  }

  const year = state.cursor.getFullYear();
  const month = state.cursor.getMonth();

  $("hist-month-label").textContent = monthLabel(year, month);
  $("hist-this-month").hidden = isSameMonth(state.cursor, new Date());

  renderHeatmap(year, month, days, categories, settings.weekStart);
  renderSummary(year, month, days, categories);
  renderTrends(year, month, days, categories, settings.weekStart);
  renderWeekOverWeek(days, categories, settings.weekStart);
  renderSearch(days, $("hist-search").value);
  renderReview(days, categories, settings, silenced ?? []);
  renderLog(days, categories);
}
