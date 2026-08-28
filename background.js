/**
 * Daily Dial — service worker.
 *
 * Opens the dial and fires the two daily reminders. MV3 workers are torn down
 * when idle, so nothing is held in memory: alarms survive restarts, and
 * settings are re-read from storage on every wake.
 */

import {
  DAY_PREFIX,
  SETTINGS_KEY,
  SLOTS,
  SLOT_MIN,
  UNTRACKED,
  dateKey,
  nextOccurrence,
  normalizeSettings,
  reminderMessage,
} from "./lib.js";

const ALARM_PREFIX = "reminder-";
const OPEN_TAB_KEY = "openTabId";

async function getSettings() {
  const { [SETTINGS_KEY]: saved } = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(saved);
}

async function rescheduleAlarms() {
  const existing = await chrome.alarms.getAll();
  await Promise.all(
    existing.filter((a) => a.name.startsWith(ALARM_PREFIX)).map((a) => chrome.alarms.clear(a.name))
  );

  const { remindersOn, times } = await getSettings();
  if (!remindersOn) return;

  times.forEach((time, i) => {
    chrome.alarms.create(`${ALARM_PREFIX}${i}`, {
      when: nextOccurrence(time),
      periodInMinutes: 24 * 60,
    });
  });
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

/**
 * Focus the existing dial tab rather than piling up duplicates.
 *
 * The tab id is remembered in session storage instead of searching by URL:
 * chrome.tabs.query({url}) needs the "tabs" permission, which Chrome presents
 * to the user as "read your browsing history" — far more than this needs.
 */
async function openDial() {
  const { [OPEN_TAB_KEY]: tabId } = await chrome.storage.session.get(OPEN_TAB_KEY);

  if (typeof tabId === "number") {
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch {
      // Closed since we recorded it — fall through and open a fresh one.
    }
  }

  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL("dial.html") });
  await chrome.storage.session.set({ [OPEN_TAB_KEY]: tab.id });
}

chrome.action.onClicked.addListener(openDial);

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith("dial-")) return;
  chrome.notifications.clear(id);
  openDial();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  notify(Number(alarm.name.slice(ALARM_PREFIX.length)));
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { [OPEN_TAB_KEY]: openId } = await chrome.storage.session.get(OPEN_TAB_KEY);
  if (openId === tabId) await chrome.storage.session.remove(OPEN_TAB_KEY);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "reschedule") return false;
  rescheduleAlarms().then(() => sendResponse({ ok: true }));
  return true; // keep the channel open for the async response
});

chrome.runtime.onInstalled.addListener(rescheduleAlarms);
chrome.runtime.onStartup.addListener(rescheduleAlarms);
