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

/**
 * The languages this build ships, in the order the picker lists them.
 * `auto` means "whatever Chrome resolved", which is the default and the only
 * value that costs nothing.
 */
export const SUPPORTED_LANGUAGES = [
  { code: "auto", label: "Automatic" },
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "hi", label: "हिन्दी" },
  { code: "ja", label: "日本語" },
  { code: "pt_BR", label: "Português (BR)" },
  { code: "ru", label: "Русский" },
  { code: "zh_CN", label: "中文（简体）" },
];

/**
 * Where a deliberate language choice is stored.
 *
 * `localStorage`, not `chrome.storage`, for one reason: this has to be
 * readable *synchronously*, before the first string is rendered.
 * `chrome.storage` is async, and a page that painted itself in Chrome's
 * language and then re-rendered in yours would flash. Everything else the
 * app owns still lives in `chrome.storage`; this single value is the
 * exception, and it is a per-device display preference rather than data —
 * it has no business travelling in a backup to a device someone else reads.
 */
export const LANGUAGE_KEY = "dailyDialLanguage";

export function storedLanguage() {
  try {
    return localStorage.getItem(LANGUAGE_KEY) || "auto";
  } catch {
    return "auto"; // storage disabled — fall back to Chrome's choice
  }
}

/**
 * The chosen catalog, loaded once at module evaluation.
 *
 * A synchronous request, which is normally the wrong thing: it blocks the
 * main thread. Here it reads one packaged file that is already on disk, only
 * when someone has explicitly overridden the language, and the alternative is
 * either rendering English first and repainting, or restructuring boot to be
 * async — and the dial engines below capture their aria-labels at module-eval
 * time, so "async boot" is a much larger change than it sounds.
 *
 * `null` whenever the language is automatic, which is the default: that path
 * is exactly as fast as before and goes straight to chrome.i18n.
 */
const override = (() => {
  const want = storedLanguage();
  if (want === "auto") return null;
  try {
    const url = chrome.runtime.getURL(`_locales/${want}/messages.json`);
    const req = new XMLHttpRequest();
    req.open("GET", url, false);
    req.send();
    if (req.status !== 200 && req.status !== 0) return null;
    const chosen = JSON.parse(req.responseText);
    // English underneath, so a key the chosen locale omits (Japanese has no
    // _one forms, for instance) still resolves rather than vanishing.
    let base = {};
    if (want !== "en") {
      const b = new XMLHttpRequest();
      b.open("GET", chrome.runtime.getURL("_locales/en/messages.json"), false);
      b.send();
      if (b.status === 200 || b.status === 0) base = JSON.parse(b.responseText);
    }
    return { lang: want.replace("_", "-"), chosen, base };
  } catch {
    return null; // a bad stored value must never stop the page loading
  }
})();

/** Substitutes `$NAME$` placeholders the way chrome.i18n does. Only needed on
 *  the override path; chrome.i18n does it itself otherwise. */
function fill(entry, substitutions) {
  const args = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
  let out = entry.message;
  for (const [name, def] of Object.entries(entry.placeholders ?? {})) {
    const i = Number(String(def.content).slice(1)) - 1;
    out = out.replaceAll(`$${name.toUpperCase()}$`, args[i] ?? "");
  }
  return out;
}

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
  if (override) {
    const entry = override.chosen[key] ?? override.base[key];
    if (entry) return fill(entry, substitutions);
    return humanizeKey(key);
  }
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
  // A deliberate choice wins, so plural rules, dates and writing direction
  // all follow the language actually on screen rather than Chrome's.
  if (override) return override.lang;
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
  if (override) {
    if (override.chosen[candidate] ?? override.base[candidate]) return candidate;
    return `${key}_other`;
  }
  try {
    if (chrome.i18n?.getMessage(candidate)) return candidate;
  } catch {
    // fall through
  }
  return `${key}_other`;
}

/**
 * A counted message, straight from the UI: `tp("filledDays", n, [String(n)])`.
 *
 * This replaced nine `n === 1 ? t("…Singular") : t("…Plural")` ternaries.
 * They read as though they were only about English grammar, but they also
 * fixed the *catalog* at two forms — so no Russian or Arabic translation
 * could have been correct however well it was written.
 */
export const tp = (key, count, params) => t(pluralKey(key, count), params);

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

/**
 * A date formatter in the language the app is *displayed* in.
 *
 * Every one of these used to pass `undefined`, which means the browser's own
 * locale — usually but not always the same thing, and never the same thing
 * once someone sets the extension's language deliberately. It showed:
 * a fully Spanish page with "August 2026" over the week strip.
 */
export const dateFmt = (options) => new Intl.DateTimeFormat(uiLanguage(), options);

/** A full, spoken-out date — for aria-labels, which were using
 *  `toDateString()`. That is English by definition, so every screen reader
 *  in every other language was being handed "Sat Aug 29 2026". */
export const fmtFullDate = (d) =>
  dateFmt({ weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(d);

/**
 * Short weekday names indexed 0=Sunday, matching `Date.getDay()`.
 *
 * 2024-01-07 is a Sunday, so the seven days from it land on Sun..Sat — a
 * fixed anchor rather than arithmetic off today, which would depend on when
 * the module happened to load.
 */
export function shortWeekdayNames() {
  const fmt = dateFmt({ weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 7 + i)));
}

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
