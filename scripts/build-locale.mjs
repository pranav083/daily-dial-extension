#!/usr/bin/env node
/**
 * Turns a flat `{key: "translated text"}` file into a full Chrome locale.
 *
 * Translators should only ever have to write the words. Everything else in a
 * messages.json entry is machinery that must match English exactly or the
 * substitution silently breaks: the `placeholders` block maps `$COUNT$` to
 * `$1`, and those numbers are positional against the arguments the *code*
 * passes, so they are not a translator's decision. Copying them by hand
 * across nine languages would be nine chances to renumber one.
 *
 *   node scripts/build-locale.mjs hi translations/hi.json
 *
 * Plural families are expanded from whatever forms the flat file supplies
 * (`filledDays_one`, `filledDays_few`, …); the English `_other` entry is the
 * template for the whole family. `descriptions` are dropped — they exist to
 * tell translators what a string is for, and are dead weight in the shipped
 * locale, which is loaded on every page open.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [locale, flatPath] = process.argv.slice(2);

if (!locale || !flatPath) {
  console.error("usage: build-locale.mjs <locale> <flat.json>");
  process.exit(1);
}

const en = JSON.parse(readFileSync(join(root, "_locales/en/messages.json"), "utf8"));
const flat = JSON.parse(readFileSync(flatPath, "utf8"));

/** English entry for a key, following a plural form back to its family. */
const template = (key) => en[key] ?? en[key.replace(/_(zero|one|two|few|many|other)$/, "_other")];

const out = {};
const unknown = [];

for (const [key, message] of Object.entries(flat)) {
  const base = template(key);
  if (!base) {
    unknown.push(key);
    continue;
  }
  const entry = { message };
  if (base.placeholders) entry.placeholders = base.placeholders;
  out[key] = entry;
}

if (unknown.length) {
  console.error(`${unknown.length} key(s) not in the English catalog:\n` + unknown.map((k) => `  - ${k}`).join("\n"));
  process.exit(1);
}

const dir = join(root, "_locales", locale);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "messages.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`_locales/${locale}/messages.json — ${Object.keys(out).length} messages`);
