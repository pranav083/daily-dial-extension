/**
 * Daily Dial — service worker.
 *
 * Opens the dial and fires the two daily reminders. MV3 workers are torn down
 * when idle, so nothing is held in memory: alarms survive restarts, and
 * settings are re-read from storage on every wake.
 */

import {
  CATEGORIES_KEY,
  DAY_PREFIX,
  SETTINGS_KEY,
  SLOTS,
  SLOT_MIN,
  UNTRACKED,
  computeStats,
  dateKey,
  mostRecentWeekStart,
  nextOccurrence,
  nextWeeklyOccurrence,
  normalizeCategories,
  normalizeDay,
  normalizeSettings,
  reminderMessage,
  scoreBucket,
  weeklyRecap,
  weeklyRecapMessage,
} from "./lib.js";

const ALARM_PREFIX = "reminder-";
const WEEKLY_RECAP_ALARM = "weekly-recap";
const BADGE_ALARM = "badge-refresh";

// Toolbar-badge colours by score bucket — fixed hex, since the badge sits on
// the browser chrome rather than the page and can't read the dial's CSS
// theme variables.
const BADGE_COLORS = { good: "#16a34a", warning: "#d97706", critical: "#dc2626", muted: "#6b7280" };

async function getSettings() {
  const { [SETTINGS_KEY]: saved } = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(saved);
}

async function getCategories() {
  const { [CATEGORIES_KEY]: saved } = await chrome.storage.local.get(CATEGORIES_KEY);
  return normalizeCategories(saved);
}

async function getAllDays() {
  const all = await chrome.storage.local.get(null);
  const days = new Map();
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(DAY_PREFIX)) days.set(key.slice(DAY_PREFIX.length), normalizeDay(value));
  }
  return days;
}

async function rescheduleAlarms() {
  const existing = await chrome.alarms.getAll();
  await Promise.all(
    existing
      .filter((a) => a.name.startsWith(ALARM_PREFIX) || a.name === WEEKLY_RECAP_ALARM)
      .map((a) => chrome.alarms.clear(a.name))
  );

  const settings = await getSettings();

  if (settings.remindersOn) {
    settings.times.forEach((time, i) => {
      chrome.alarms.create(`${ALARM_PREFIX}${i}`, {
        when: nextOccurrence(time),
        periodInMinutes: 24 * 60,
      });
    });
  }

  if (settings.weeklyRecapOn) {
    chrome.alarms.create(WEEKLY_RECAP_ALARM, {
      when: nextWeeklyOccurrence(settings.weeklyRecapDay, settings.weeklyRecapTime),
      periodInMinutes: 7 * 24 * 60,
    });
  }
}

/** Today's score on the toolbar icon, so it's readable without opening the
 *  dial — text is the score itself (e.g. "+42", "-15"), colour matches the
 *  same good/warning/critical bucket the dial's own score badge uses. Blank
 *  until today has at least one painted block. */
async function refreshBadge() {
  const key = DAY_PREFIX + dateKey(new Date());
  const [{ [key]: raw }, categories] = await Promise.all([chrome.storage.local.get(key), getCategories()]);
  const slots = Array.isArray(raw?.slots) && raw.slots.length === SLOTS ? raw.slots : null;

  if (!slots || slots.every((v) => v === UNTRACKED)) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  const stats = computeStats(slots, categories);
  const bucket = scoreBucket(stats.score);
  await chrome.action.setBadgeText({ text: `${stats.score > 0 ? "+" : ""}${stats.score}` });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[bucket.tone] ?? BADGE_COLORS.muted });
}

/** The badge alarm runs independently of reminders/recap (which the user can
 *  turn off) and isn't touched by rescheduleAlarms' clear-and-recreate, so
 *  it only needs creating once. Mainly covers the midnight rollover to a
 *  fresh, unpainted day for anyone who leaves Chrome running overnight. */
async function ensureBadgeAlarm() {
  const existing = await chrome.alarms.get(BADGE_ALARM);
  if (!existing) chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 30 });
}

/** Minutes of today still carrying no category. */
async function untrackedMinutesToday() {
  const key = DAY_PREFIX + dateKey(new Date());
  const { [key]: day } = await chrome.storage.local.get(key);
  const slots = Array.isArray(day?.slots) && day.slots.length === SLOTS ? day.slots : null;
  if (!slots) return 24 * 60;
  return slots.filter((v) => v === UNTRACKED).length * SLOT_MIN;
}

async function notify(index) {
  const untracked = await untrackedMinutesToday();
  chrome.notifications.create(`dial-${index}-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title: index === 1 ? "Close out your day" : "Daily Dial",
    message: reminderMessage(index, untracked),
    priority: 1,
  });
}

/** The week just gone — the recap fires after it ends, so the most recent
 *  occurrence of the chosen week-start day is the *current* (in-progress)
 *  week; the completed one is exactly 7 days before that. */
async function notifyWeeklyRecap() {
  const [settings, categories, days] = await Promise.all([getSettings(), getCategories(), getAllDays()]);
  const weekStart = mostRecentWeekStart(settings.weekStart, new Date());
  weekStart.setDate(weekStart.getDate() - 7);

  const recap = weeklyRecap(days, categories, weekStart);
  chrome.notifications.create(`dial-recap-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title: "Weekly recap",
    message: weeklyRecapMessage(recap),
    priority: 1,
  });
}

/**
 * Focus the existing dial tab rather than piling up duplicates.
 *
 * Asks the runtime what's actually open instead of remembering a tab id.
 * Session storage is cleared on browser shutdown, so a restored tab — a
 * pinned dial, "continue where you left off", or a Ctrl+Shift+T — came back
 * with an id we had forgotten, and the next click opened a *second* dial.
 * Two live copies is the one thing the page can't survive cleanly, since
 * each holds a whole-day snapshot and writes it back wholesale.
 *
 * getContexts needs no "tabs" permission, so this keeps the constraint that
 * ruled out chrome.tabs.query({url}) — that permission reads to the user as
 * "read your browsing history", far more than this needs. It also removes
 * the double-click race the old bookkeeping had.
 */
async function openDial() {
  const [existing] = await chrome.runtime.getContexts({
    contextTypes: ["TAB"],
    documentUrls: [chrome.runtime.getURL("dial.html")],
  });

  if (existing) {
    try {
      await chrome.tabs.update(existing.tabId, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
      return;
    } catch {
      // Vanished between the query and the focus — fall through.
    }
  }

  await chrome.tabs.create({ url: chrome.runtime.getURL("dial.html") });
}

chrome.action.onClicked.addListener(openDial);

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith("dial-")) return;
  chrome.notifications.clear(id);
  openDial();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[DAY_PREFIX + dateKey(new Date())] || changes[CATEGORIES_KEY]) refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) {
    refreshBadge();
    return;
  }
  if (alarm.name === WEEKLY_RECAP_ALARM) {
    notifyWeeklyRecap();
    return;
  }
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  notify(Number(alarm.name.slice(ALARM_PREFIX.length)));
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "reschedule") return false;
  rescheduleAlarms().then(() => sendResponse({ ok: true }));
  return true; // keep the channel open for the async response
});

function initBadge() {
  ensureBadgeAlarm();
  refreshBadge();
}

chrome.runtime.onInstalled.addListener(rescheduleAlarms);
chrome.runtime.onStartup.addListener(rescheduleAlarms);
chrome.runtime.onInstalled.addListener(initBadge);
chrome.runtime.onStartup.addListener(initBadge);
