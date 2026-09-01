#!/usr/bin/env node
/**
 * Regenerates docs/changelog.md from CHANGELOG.md, and checks it is current.
 *
 * The website page was a hand-kept copy, and by the time anyone looked it was
 * four releases behind — claiming 1.30.0 was the latest while the extension
 * shipped 1.34.0. Nothing failed, because nothing was checking: the page built
 * fine and returned 200, it was just quietly wrong. That is the same shape of
 * problem as a stale demo, which is why this mirrors build-demo.mjs and gets
 * the same verification in `npm run check`.
 *
 *   node scripts/build-docs-changelog.mjs          # rewrite the page
 *   node scripts/build-docs-changelog.mjs --check   # fail if it is behind
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = join(root, "docs", "changelog.md");

const FRONT_MATTER = `---
title: What's new
description: Every release of Daily Dial, and what changed in it.
---

# What's new

Daily Dial is developed in the open. This is the project's changelog, unedited.

`;

// Everything after the "# Changelog" H1 — the page supplies its own heading.
const source = readFileSync(join(root, "CHANGELOG.md"), "utf8").split("\n").slice(1).join("\n").replace(/^\n+/, "");
const expected = FRONT_MATTER + source;

if (process.argv.includes("--check")) {
  const actual = readFileSync(page, "utf8");
  if (actual !== expected) {
    console.error("docs/changelog.md is behind CHANGELOG.md.\nRun `npm run build:docs-changelog`.");
    process.exit(1);
  }
  const latest = source.match(/^## \[([\d.]+)\]/m)?.[1] ?? "?";
  console.log(`Changelog check passed — the site's changelog matches, newest release ${latest}.`);
} else {
  writeFileSync(page, expected);
  const releases = (source.match(/^## \[/gm) ?? []).length;
  console.log(`docs/changelog.md rebuilt from CHANGELOG.md — ${releases} entries`);
}
