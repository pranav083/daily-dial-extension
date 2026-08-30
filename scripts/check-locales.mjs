#!/usr/bin/env node
/**
 * Guards the translations.
 *
 * A missing or malformed translation fails quietly in Chrome: it falls back
 * to English, or — worse — substitutes nothing and shows a bare "$COUNT$" to
 * someone who can't read the English anyway. Neither shows up in a test that
 * only ever runs in English, so this checks the catalogs directly.
 *
 * What it enforces, per locale:
 *
 *  1. Every key in `en` exists. English is the source of truth; a locale
 *     silently missing a key is a half-translated screen.
 *  2. No key that `en` doesn't have — always a typo or a stale rename.
 *  3. Every `$PLACEHOLDER$` used in the translated text is defined in that
 *     same file. Chrome does not borrow placeholder definitions from
 *     default_locale, so a translation that keeps `$COUNT$` without carrying
 *     the block renders the literal text.
 *  4. Placeholder *contents* match English exactly — `$1`, `$2`. They are
 *     positional against the arguments the code passes, so a locale that
 *     renumbers them silently swaps two values around.
 *  5. Every plural family has at least the `_other` form, which is the one
 *     form every language on earth has and the fallback `pluralKey()` uses.
 *  6. Plural families carry every form the language actually needs, worked
 *     out from Intl.PluralRules rather than assumed. Russian needs three and
 *     Arabic six; English's two are not a template for anyone else.
 *
 * Run by `npm run check` and by CI.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(root, "_locales");
const read = (loc) => JSON.parse(readFileSync(join(localesDir, loc, "messages.json"), "utf8"));

const en = read("en");
const enKeys = Object.keys(en);
const locales = readdirSync(localesDir).filter((l) => l !== "en").sort();

/** `$FOO$` occurrences in a message body. */
const usedPlaceholders = (text) => [...text.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) => m[1].toLowerCase());

/** Plural families, keyed by base name: { filledDays: Set{"one","other"} }. */
function pluralFamilies(catalog) {
  const fams = new Map();
  for (const k of Object.keys(catalog)) {
    const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(k);
    if (!m) continue;
    if (!fams.has(m[1])) fams.set(m[1], new Set());
    fams.get(m[1]).add(m[2]);
  }
  return fams;
}

/** The plural forms this language actually distinguishes, per CLDR. */
function requiredForms(locale) {
  const tag = locale.replace("_", "-");
  const rules = new Intl.PluralRules(tag);
  const forms = new Set(["other"]);
  // 0-200 plus a few fractions covers every cardinal category CLDR defines.
  for (let n = 0; n <= 200; n++) forms.add(rules.select(n));
  for (const n of [0.5, 1.5, 2.5]) forms.add(rules.select(n));
  return forms;
}

const problems = [];
const note = (loc, msg) => problems.push(`${loc}: ${msg}`);

for (const loc of locales) {
  let catalog;
  try {
    catalog = read(loc);
  } catch (err) {
    note(loc, `messages.json is missing or not valid JSON — ${err.message}`);
    continue;
  }

  const enFams = pluralFamilies(en);
  const locFams = pluralFamilies(catalog);
  const needed = requiredForms(loc);

  // (1) and (2): key parity, ignoring plural forms, which are handled below.
  const isPluralKey = (k) => /_(zero|one|two|few|many|other)$/.test(k);
  const missing = enKeys.filter((k) => !isPluralKey(k) && !(k in catalog));
  if (missing.length) {
    note(loc, `${missing.length} key(s) not translated: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`);
  }
  const extra = Object.keys(catalog).filter((k) => !isPluralKey(k) && !(k in en));
  if (extra.length) note(loc, `${extra.length} key(s) that English doesn't have: ${extra.slice(0, 8).join(", ")}`);

  // (5) and (6): plural coverage.
  for (const [base] of enFams) {
    const have = locFams.get(base);
    if (!have) {
      note(loc, `plural family "${base}" is missing entirely`);
      continue;
    }
    if (!have.has("other")) note(loc, `"${base}" has no _other form — that is the fallback every language needs`);
    const gaps = [...needed].filter((f) => !have.has(f));
    if (gaps.length) note(loc, `"${base}" is missing the ${gaps.map((g) => `_${g}`).join(", ")} form(s) this language needs`);
  }

  // (3) and (4): placeholders.
  for (const [key, entry] of Object.entries(catalog)) {
    if (typeof entry?.message !== "string") {
      note(loc, `"${key}" has no message string`);
      continue;
    }
    const defined = new Set(Object.keys(entry.placeholders ?? {}).map((n) => n.toLowerCase()));
    for (const used of usedPlaceholders(entry.message)) {
      if (!defined.has(used)) {
        note(loc, `"${key}" uses $${used.toUpperCase()}$ but doesn't define it — Chrome will print it literally`);
      }
    }
    // Compare against English's definition for the same key (or the _other
    // form, which is where a plural family's English definition lives).
    const enEntry = en[key] ?? en[key.replace(/_(zero|one|two|few|many|other)$/, "_other")];
    for (const [name, def] of Object.entries(entry.placeholders ?? {})) {
      const enDef = enEntry?.placeholders?.[name] ?? enEntry?.placeholders?.[name.toLowerCase()];
      if (!enDef) {
        note(loc, `"${key}" defines $${name.toUpperCase()}$, which English doesn't have`);
      } else if (enDef.content !== def.content) {
        note(loc, `"${key}" maps $${name.toUpperCase()}$ to ${def.content}, English maps it to ${enDef.content} — values would swap`);
      }
    }
  }
}

if (problems.length) {
  console.error(`Locale check failed — ${problems.length} problem(s):\n` + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}

console.log(
  locales.length
    ? `Locale check passed — ${locales.length} translation(s) complete against ${enKeys.length} English keys.`
    : `Locale check passed — English only (${enKeys.length} keys).`
);
