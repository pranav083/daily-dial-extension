/**
 * Daily Dial — service worker.
 *
 * Opens the dial and fires the two daily reminders. MV3 workers are torn down
 * when idle, so nothing is held in memory: alarms survive restarts, and
 * settings are re-read from storage on every wake.
 */

import { initDurationUnits, loadStoredOverride, t, tm, tmJoin } from "./i18n.js";

import {
  CATEGORIES_KEY,
  DAY_PREFIX,
  DRIVE_BACKUP_SIZE_KEY,
  DRIVE_FILE_ID_KEY,
  DRIVE_LAST_SYNC_KEY,
  SAMPLE_DAY_KEYS_KEY,
  SETTINGS_KEY,
  SLOTS,
  SLOT_MIN,
  UNTRACKED,
  buildBackup,
  computeStats,
  dateKey,
  excludeDays,
  recapWeekStart,
  dialUrlSuffix,
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
import { driveConnectSilently, driveFindBackupFile, driveUploadBackup } from "./drive.js";

// The service worker formats durations too (the evening reminder names how
// much is unlogged), and it is torn down and re-evaluated constantly — so
// this runs at module scope, where every wake-up passes through it, rather
// than in an init function that only the first activation would reach.
initDurationUnits();

const ALARM_PREFIX = "reminder-";
const WEEKLY_RECAP_ALARM = "weekly-recap";
const BADGE_ALARM = "badge-refresh";
const AUTO_BACKUP_ALARM = "auto-backup";
/** Once a day is plenty: the data changes slowly and every run costs the
 *  user a Drive round trip they did not ask for. */
const AUTO_BACKUP_PERIOD_MIN = 24 * 60;

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
  const bucket = scoreBucket(stats.score, stats.trackedMin);
  // A dash rather than a confident number when the day is barely logged —
  // the badge is the most glanceable surface there is, so a misleading
  // number does the most damage here.
  await chrome.action.setBadgeText({
    text: bucket.provisional ? "–" : `${stats.score > 0 ? "+" : ""}${stats.score}`,
  });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[bucket.tone] ?? BADGE_COLORS.muted });
}

/**
 * Backs up to Drive without involving the user.
 *
 * Every exit here is silent. This runs on a timer the user is not watching,
 * so a consent window, an error toast, or a notification would all arrive
 * with no action to explain them — the honest behaviour when something is
 * not right is to skip this run and try again tomorrow. The dial's own
 * "Back up now" button remains the place where failures are worth reporting,
 * because there a person is waiting for an answer.
 *
 * Only ever updates an existing backup: `driveConnectSilently` cannot
 * establish a first connection, and `fileId` is absent until one has been
 * made by hand, so turning this on before connecting does nothing rather
 * than surprising anyone with a sign-in.
 */
async function autoBackup() {
  try {
    const settings = await getSettings();
    if (!settings.autoBackupOn) return;

    const stored = await chrome.storage.local.get([DRIVE_FILE_ID_KEY, SAMPLE_DAY_KEYS_KEY]);
    const fileId = typeof stored[DRIVE_FILE_ID_KEY] === "string" ? stored[DRIVE_FILE_ID_KEY] : null;
    if (!fileId) return; // never connected by hand — nothing to update

    const [categories, days] = await Promise.all([getCategories(), getAllDays()]);
    // Demo days are excluded here exactly as they are from a manual backup:
    // a backup is a copy of the user's data, and sample days carry no marker
    // that would let a restore tell them apart later.
    const sampleKeys = Array.isArray(stored[SAMPLE_DAY_KEYS_KEY]) ? stored[SAMPLE_DAY_KEYS_KEY] : [];
    const mine = excludeDays(days, sampleKeys);
    if (mine.size === 0) return;

    const token = await driveConnectSilently();
    const existing = await driveFindBackupFile(token).catch(() => null);
    const text = JSON.stringify(
      buildBackup(mine, categories, settings, chrome.runtime.getManifest().version)
    );
    const id = await driveUploadBackup(token, existing?.id ?? fileId, text);

    await chrome.storage.local.set({
      [DRIVE_FILE_ID_KEY]: id,
      [DRIVE_LAST_SYNC_KEY]: Date.now(),
      [DRIVE_BACKUP_SIZE_KEY]: new Blob([text]).size,
    });
  } catch (err) {
    // Deliberately quiet — see above. Logged only for anyone with the
    // service worker console open.
    console.warn("Daily Dial: automatic backup skipped", err);
  }
}

/** The badge alarm runs independently of reminders/recap (which the user can
 *  turn off) and isn't touched by rescheduleAlarms' clear-and-recreate, so
 *  it only needs creating once. Mainly covers the midnight rollover to a
 *  fresh, unpainted day for anyone who leaves Chrome running overnight. */
async function ensureBadgeAlarm() {
  const existing = await chrome.alarms.get(BADGE_ALARM);
  if (!existing) chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 30 });
}

/**
 * Keeps the automatic-backup alarm in step with the setting.
 *
 * Created only while the setting is on, rather than created always and
 * ignored when off: an alarm that exists but does nothing still wakes the
 * service worker on a timer for no reason.
 */
async function syncAutoBackupAlarm() {
  const settings = await getSettings();
  const existing = await chrome.alarms.get(AUTO_BACKUP_ALARM);
  if (settings.autoBackupOn && !existing) {
    chrome.alarms.create(AUTO_BACKUP_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: AUTO_BACKUP_PERIOD_MIN,
    });
  } else if (!settings.autoBackupOn && existing) {
    await chrome.alarms.clear(AUTO_BACKUP_ALARM);
  }
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
  // Before any text is composed: the worker cannot read the language choice
  // synchronously the way the page does.
  await loadStoredOverride();
  const untracked = await untrackedMinutesToday();
  chrome.notifications.create(`dial-${index}-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title: index === 1 ? t("notifyEveningTitle") : t("appNameShort"),
    message: tm(reminderMessage(index, untracked)),
    priority: 1,
  });
}

/** The week just gone — the recap fires after it ends, so the most recent
 *  occurrence of the chosen week-start day is the *current* (in-progress)
 *  week; the completed one is exactly 7 days before that. */
async function notifyWeeklyRecap() {
  await loadStoredOverride();
  const [settings, categories, days] = await Promise.all([getSettings(), getCategories(), getAllDays()]);
  // Anchored on when the recap actually fires, not on weekStart alone — the
  // two disagreed whenever either setting moved off its default, and the
  // recap then described a week up to seven days old.
  const weekStart = recapWeekStart(settings.weekStart, new Date());

  const recap = weeklyRecap(days, categories, weekStart);
  chrome.notifications.create(`dial-recap-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title: t("notifyRecapTitle"),
    message: tmJoin(weeklyRecapMessage(recap)),
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
async function openDial(hash) {
  const [existing] = await chrome.runtime.getContexts({
    contextTypes: ["TAB"],
    documentUrls: [chrome.runtime.getURL("dial.html")],
  });

  if (existing) {
    try {
      // Re-navigating an already-open tab would throw away unsaved edits, so
      // an existing dial is only ever focused — never reloaded — and the
      // page itself is told to switch view instead.
      await chrome.tabs.update(existing.tabId, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
      if (dialUrlSuffix(hash) === "#history") {
        await chrome.runtime.sendMessage({ type: "showHistory" }).catch(() => {});
      }
      return;
    } catch {
      // Vanished between the query and the focus — fall through.
    }
  }

  await chrome.tabs.create({ url: chrome.runtime.getURL("dial.html") + dialUrlSuffix(hash) });
}

/**
 * The keyboard shortcut, for the same reason the toolbar button exists: on a
 * manual tracker, the thing that decides whether a day gets logged is how
 * little friction stands between remembering and recording. A shortcut is the
 * shortest path there is.
 *
 * `chrome.commands` may be absent where the shortcut is unsupported, so this
 * is guarded rather than assumed.
 */
chrome.commands?.onCommand?.addListener?.((command) => {
  if (command === "open-dial") openDial();
});

// Wrapped, not passed directly: onClicked hands the listener the Tab object,
// which openDial would take as its `hash` argument and concatenate into the
// URL as "[object Object]" — breaking every toolbar click.
chrome.action.onClicked.addListener(() => openDial());

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith("dial-")) return;
  chrome.notifications.clear(id);
  // A weekly recap is about the week just gone, so it opens History rather
  // than today's dial — the numbers it just quoted are all on that page.
  openDial(id.startsWith("dial-recap-") ? "#history" : undefined);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[DAY_PREFIX + dateKey(new Date())] || changes[CATEGORIES_KEY]) refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_BACKUP_ALARM) {
    autoBackup();
    return;
  }
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
  syncAutoBackupAlarm();
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
// chrome.storage.session is cleared on shutdown but alarms survive it, so
// this is really a repair step: it re-creates the alarm if it was lost, and
// clears it if the setting was turned off while the worker wasn't running.
chrome.runtime.onInstalled.addListener(syncAutoBackupAlarm);
chrome.runtime.onStartup.addListener(syncAutoBackupAlarm);
