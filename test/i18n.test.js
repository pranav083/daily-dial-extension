import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Tests for the layer that turns message keys into words.
 *
 * This module sits between the pure logic and everything the user reads, and
 * it had no tests at all — which mattered more than usual, because its two
 * hardest jobs are invisible when they go wrong. A plural form chosen for the
 * wrong language reads as a slightly odd sentence; a date formatted in the
 * browser's locale instead of the app's reads as a correct date. Neither
 * looks like a bug from the outside.
 *
 * `i18n.js` calls `chrome.i18n`, so each test installs a fake `chrome` backed
 * by a real locale file before importing it. The import has to be dynamic and
 * per-test for that reason: a static one would run at module-eval time, before
 * any fake exists.
 */

const LOCALES = readdirSync(new URL("../_locales", import.meta.url));
const catalogFor = (loc) =>
  JSON.parse(readFileSync(new URL(`../_locales/${loc}/messages.json`, import.meta.url), "utf8"));

/** Installs a fake chrome.i18n for `locale` and returns a fresh i18n module.
 *  The cache-busting query is what makes each test see its own locale rather
 *  than whichever one happened to load first. */
async function loadI18n(locale) {
  const catalog = catalogFor(locale);
  const en = locale === "en" ? catalog : catalogFor("en");
  globalThis.chrome = {
    i18n: {
      getUILanguage: () => locale.replace("_", "-"),
      getMessage(key, subs) {
        const entry = catalog[key] ?? en[key];
        if (!entry) return "";
        const args = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
        let out = entry.message;
        for (const [name, def] of Object.entries(entry.placeholders ?? en[key]?.placeholders ?? {})) {
          const i = Number(String(def.content).slice(1)) - 1;
          out = out.replaceAll(`$${name.toUpperCase()}$`, args[i] ?? "");
        }
        return out;
      },
    },
  };
  return import(`../i18n.js?locale=${locale}-${Math.random()}`);
}

/* ---------- plural selection ---------- */

test("pluralKey asks the language, rather than assuming English's two forms", async () => {
  const en = await loadI18n("en");
  assert.equal(en.pluralKey("filledDays", 1), "filledDays_one");
  assert.equal(en.pluralKey("filledDays", 0), "filledDays_other");
  assert.equal(en.pluralKey("filledDays", 5), "filledDays_other");

  // Japanese has a single form, so every count resolves to the same message.
  const ja = await loadI18n("ja");
  assert.equal(ja.pluralKey("filledDays", 1), "filledDays_other");
  assert.equal(ja.pluralKey("filledDays", 5), "filledDays_other");
});

test("pluralKey falls back to _other when the form a language wants is absent", async () => {
  const ja = await loadI18n("ja");
  // ja genuinely has no _one entry; asking for a count that would select
  // "one" elsewhere must still land on something that exists.
  assert.equal(ja.pluralKey("bestsStreakDays", 1), "bestsStreakDays_other");
  assert.notEqual(ja.t("bestsStreakDays_other"), "", "and that something is a real message");
});

test("tp renders the singular and the plural differently in English", async () => {
  const en = await loadI18n("en");
  const one = en.tp("filledDays", 1, ["1"]);
  const many = en.tp("filledDays", 3, ["3"]);
  assert.match(one, /1 day\b/);
  assert.match(many, /3 days\b/);
  assert.notEqual(one, many);
});

test("the counts that used to read '1 of 1 intentions' now agree", async () => {
  const en = await loadI18n("en");
  assert.match(en.tp("recapIntentions", 1, ["1", "1"]), /1 of 1 intention\b/);
  assert.match(en.tp("recapIntentions", 2, ["1", "2"]), /1 of 2 intentions\b/);
  assert.match(en.tp("obsUntrackedAreaHeadline", 1, ["21", "1"]), /1 category\b/);
  assert.match(en.tp("obsUntrackedAreaHeadline", 3, ["21", "3"]), /3 categories\b/);
});

/* ---------- descriptors from the pure layer ---------- */

test("tm resolves a plain descriptor and substitutes its params", async () => {
  const en = await loadI18n("en");
  assert.equal(en.tm({ key: "scoreLockedIn", params: [] }), "Locked in");
  assert.match(en.tm({ key: "recapTopCategory", params: ["Deep Work"] }), /Deep Work/);
});

test("tm resolves a counted descriptor through the plural rules", async () => {
  const en = await loadI18n("en");
  assert.match(en.tm({ key: "filledDays", count: 1, params: ["1"] }), /1 day\b/);
  assert.match(en.tm({ key: "filledDays", count: 9, params: ["9"] }), /9 days\b/);
});

test("tm coerces non-string params, so callers need not stringify counts", async () => {
  const en = await loadI18n("en");
  assert.match(en.tm({ key: "filledDays", count: 4, params: [4] }), /4 days\b/);
});

test("tmJoin builds the whole recap out of its sentences", async () => {
  const en = await loadI18n("en");
  const out = en.tmJoin([
    { key: "recapTrackedProductive", params: ["7h", "80"] },
    { key: "recapAskAdjust", params: [] },
  ]);
  assert.match(out, /7h tracked, 80% productive\./);
  assert.match(out, /adjust/);
});

test("a missing key degrades to something legible rather than blank or raw", async () => {
  const en = await loadI18n("en");
  assert.equal(en.t("someKeyNobodyAdded"), "Some Key Nobody Added");
});

/* ---------- dates follow the app's language ---------- */

test("dateFmt uses the UI language, not the host's", async () => {
  const es = await loadI18n("es");
  const label = es.dateFmt({ month: "long", year: "numeric" }).format(new Date(2026, 7, 1));
  assert.match(label, /agosto/, `expected Spanish month name, got "${label}"`);

  const en = await loadI18n("en");
  assert.match(en.dateFmt({ month: "long", year: "numeric" }).format(new Date(2026, 7, 1)), /August/);
});

test("shortWeekdayNames are localized and indexed 0=Sunday", async () => {
  const en = await loadI18n("en");
  const names = en.shortWeekdayNames();
  assert.equal(names.length, 7);
  assert.match(names[0], /^Sun/, "index 0 is Sunday, matching Date.getDay()");
  assert.match(names[6], /^Sat/);

  const de = await loadI18n("de");
  assert.match(de.shortWeekdayNames()[0], /^So/);
});

test("fmtFullDate is not the English toDateString it replaced", async () => {
  const es = await loadI18n("es");
  const out = es.fmtFullDate(new Date(2026, 7, 29));
  assert.doesNotMatch(out, /Aug|Sat/, `still English: "${out}"`);
  assert.match(out, /agosto/);
});

/* ---------- duration suffixes ---------- */

test("initDurationUnits teaches fmtDuration the local suffixes", async () => {
  const hi = await loadI18n("hi");
  const { fmtDuration, setDurationUnits } = await import("../lib.js");
  try {
    hi.initDurationUnits();
    assert.equal(fmtDuration(465), "7घं 45मि");
  } finally {
    // lib.js holds this as module state shared with every other test file's
    // import, so put English back rather than leaving a landmine.
    setDurationUnits("h", "m");
  }
  assert.equal(fmtDuration(465), "7h 45m");
});

/* ---------- writing direction ---------- */

test("applyDocumentDirection mirrors only for right-to-left languages", async () => {
  const fakeDoc = { documentElement: {} };
  globalThis.document = fakeDoc;
  try {
    const ar = await loadI18n("en");
    globalThis.chrome.i18n.getUILanguage = () => "ar";
    assert.equal(ar.applyDocumentDirection(), true);
    assert.equal(fakeDoc.documentElement.dir, "rtl");

    globalThis.chrome.i18n.getUILanguage = () => "ar-EG";
    assert.equal(ar.applyDocumentDirection(), true, "matched on the base subtag, not the exact tag");

    globalThis.chrome.i18n.getUILanguage = () => "hi";
    assert.equal(ar.applyDocumentDirection(), false);
    assert.equal(fakeDoc.documentElement.dir, "ltr");
    assert.equal(fakeDoc.documentElement.lang, "hi");
  } finally {
    delete globalThis.document;
  }
});

/* ---------- every shipped locale, as a set ---------- */

test("every locale resolves the plural form its language actually needs", async () => {
  const en = catalogFor("en");
  const families = new Set(
    Object.keys(en)
      .map((k) => /^(.*)_(zero|one|two|few|many|other)$/.exec(k)?.[1])
      .filter(Boolean)
  );
  assert.ok(families.size >= 14, `expected the plural families to be found, got ${families.size}`);

  for (const loc of LOCALES) {
    const i18n = await loadI18n(loc);
    for (const base of families) {
      for (const n of [0, 1, 2, 3, 5, 11, 21, 100]) {
        const key = i18n.pluralKey(base, n);
        assert.notEqual(
          i18n.t(key),
          "",
          `${loc}: "${base}" at ${n} resolved to ${key}, which has no message`
        );
      }
    }
  }
});

/* ---------- the service worker's constraints ---------- */

test("i18n.js loads where there is no localStorage and no XMLHttpRequest", async () => {
  // Exactly a service worker: background.js imports this module, and a worker
  // has neither API. The language override reads both, so a missing guard
  // here would throw at module evaluation and take every reminder with it.
  const savedXhr = globalThis.XMLHttpRequest;
  delete globalThis.XMLHttpRequest;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    get() {
      throw new ReferenceError("localStorage is not defined");
    },
    configurable: true,
  });
  try {
    globalThis.chrome = {
      i18n: { getUILanguage: () => "en", getMessage: () => "ok" },
      runtime: { getURL: (p) => p },
    };
    const i18n = await import(`../i18n.js?worker=${Math.random()}`);
    assert.equal(i18n.storedLanguage(), "auto", "a worker cannot hold a choice, and must not throw asking");
    assert.equal(i18n.t("anything"), "ok");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
    if (savedXhr) globalThis.XMLHttpRequest = savedXhr;
  }
});

test("loadStoredOverride gives the worker the chosen language", async () => {
  // The page reads the choice synchronously before it renders; the worker
  // cannot, so it awaits this. Without it the dial is in one language and the
  // reminder it fires arrives in another.
  const catalogs = {
    hi: catalogFor("hi"),
    en: catalogFor("en"),
  };
  globalThis.chrome = {
    i18n: { getUILanguage: () => "en", getMessage: (k) => catalogs.en[k]?.message ?? "" },
    runtime: { getURL: (p) => p },
    storage: { local: { get: async () => ({ dailyDialLanguage: "hi" }) } },
  };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (path) => ({
    ok: true,
    json: async () => (String(path).includes("/hi/") ? catalogs.hi : catalogs.en),
  });
  try {
    const i18n = await import(`../i18n.js?override=${Math.random()}`);
    assert.equal(i18n.t("notifyEveningTitle"), catalogs.en.notifyEveningTitle.message, "English before loading");
    assert.equal(await i18n.loadStoredOverride(), "hi");
    assert.equal(i18n.t("notifyEveningTitle"), catalogs.hi.notifyEveningTitle.message, "Hindi after");
    assert.equal(i18n.uiLanguage(), "hi", "plural rules and dates follow it too");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("loadStoredOverride stays quiet when there is no choice, or it fails", async () => {
  globalThis.chrome = {
    i18n: { getUILanguage: () => "en", getMessage: () => "en text" },
    runtime: { getURL: (p) => p },
    storage: { local: { get: async () => ({}) } },
  };
  let i18n = await import(`../i18n.js?none=${Math.random()}`);
  assert.equal(await i18n.loadStoredOverride(), null, "no stored choice");

  // A catalog that cannot be fetched must never stop a notification firing.
  globalThis.chrome.storage.local.get = async () => ({ dailyDialLanguage: "hi" });
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  try {
    i18n = await import(`../i18n.js?fail=${Math.random()}`);
    assert.equal(await i18n.loadStoredOverride(), null);
    assert.equal(i18n.t("whatever"), "en text", "and English still resolves");
  } finally {
    globalThis.fetch = savedFetch;
  }
});
