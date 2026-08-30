/**
 * The one place message keys become words.
 *
 * `lib.js` and `suggestions.js` are pure — no DOM, no `chrome.*` — so they
 * describe what should be said as `{ key, params }` and never as a finished
 * sentence. Everything that renders (dial.js, history.js) and the service
 * worker (background.js, which cannot import dial.js because dial.js touches
 * the DOM) resolves those descriptors through here.
 *
 * Kept deliberately small: a wrapper over `chrome.i18n.getMessage`, plural
 * selection, and the duration suffixes. Anything larger belongs in the caller.
 */

import { setDurationUnits } from "./lib.js";

/** Turns a message key into a readable fallback (e.g. "exportCsvLabel" ->
 *  "Export csv label"), used only if a key is ever missing from
 *  messages.json, so a gap degrades to something legible instead of a blank
 *  string or a raw key. Real translations missing for a non-English locale
 *  are handled by Chrome itself, which falls back to default_locale. */
function humanizeKey(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/** Thin wrapper over chrome.i18n.getMessage. `substitutions` is a string or
 *  array of strings, positional against the message's own placeholders. */
export function t(key, substitutions) {
  try {
    const msg = chrome.i18n?.getMessage(key, substitutions);
    if (msg) return msg;
  } catch {
    // chrome.i18n unavailable — shouldn't happen in a real extension, but
    // falls through to the readable fallback below rather than throwing.
  }
  return humanizeKey(key);
}

/** The UI language Chrome resolved for this profile, e.g. "hi" or "pt-BR". */
export const uiLanguage = () => {
  try {
    return chrome.i18n?.getUILanguage?.() || "en";
  } catch {
    return "en";
  }
};

/**
 * Picks the plural form for `count` and returns the matching key.
 *
 * English has two forms, so `n === 1 ? "day" : "days"` reads like the whole
 * problem. It isn't: Russian has three and Arabic six, and no translator can
 * recover a form the code never asks for. `Intl.PluralRules` knows every
 * language's rules, so the catalog just needs one message per form —
 * `filledDays_one`, `filledDays_other`, and for Arabic also `_zero`, `_two`,
 * `_few`, `_many`. A locale that doesn't define a form it needs falls back to
 * `_other`, which is the form every language has.
 */
export function pluralKey(key, count) {
  let form = "other";
  try {
    form = new Intl.PluralRules(uiLanguage()).select(count);
  } catch {
    // Unknown locale tag — "other" is always a valid form.
  }
  const candidate = `${key}_${form}`;
  try {
    if (chrome.i18n?.getMessage(candidate)) return candidate;
  } catch {
    // fall through
  }
  return `${key}_other`;
}

/**
 * Resolves a descriptor from the pure layer: `msg(...)` or `plural(...)`.
 * @param {{key:string, params?:string[], count?:number}} descriptor
 */
export function tm(descriptor) {
  if (!descriptor) return "";
  if (typeof descriptor === "string") return t(descriptor);
  const { key, params = [], count } = descriptor;
  return t(count === undefined ? key : pluralKey(key, count), params.map(String));
}

/** Resolves a list of descriptors into one string — how `buildInsight` and
 *  `weeklyRecapMessage` are meant to be read. */
export const tmJoin = (descriptors, sep = " ") => descriptors.map(tm).join(sep);

/** Languages Chrome may resolve to that are written right to left. Matched on
 *  the base subtag, so "ar", "ar-EG" and "ar-SA" all count. */
const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi"]);

/**
 * Sets the document's writing direction for right-to-left languages.
 *
 * The layout mirrors — the week strip moves to the right of the ring, notes
 * and pens flow from the right — because that is what reading order means.
 * The dial itself does not: a clock runs clockwise in every language on
 * earth, and 15:00 is 15:00. Its geometry is absolute SVG coordinates, which
 * `dir` does not touch, so this is true by construction rather than by a rule
 * someone has to remember.
 */
export function applyDocumentDirection() {
  const lang = uiLanguage();
  const rtl = RTL_LANGUAGES.has(lang.split("-")[0].toLowerCase());
  document.documentElement.lang = lang;
  document.documentElement.dir = rtl ? "rtl" : "ltr";
  return rtl;
}

/**
 * Teaches `fmtDuration` the local hour and minute suffixes. Must run before
 * anything formats a duration, which is why both entry points call it at the
 * very top — a duration formatted before this lands would read "7h 45m" in
 * the middle of an otherwise-translated sentence.
 */
export function initDurationUnits() {
  setDurationUnits(t("durationHourSuffix"), t("durationMinuteSuffix"));
}
