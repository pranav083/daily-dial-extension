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
