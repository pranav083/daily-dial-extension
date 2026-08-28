#!/usr/bin/env node
/**
 * Guards the three places a version lives: manifest.json (what Chrome and the
 * Web Store see), package.json (what tooling sees), and CHANGELOG.md (what
 * people read). They drift silently otherwise, and a Web Store upload with a
 * stale manifest version is rejected after the fact.
 *
 * Run by `npm run check` and by CI.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(root, name), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));
const changelog = read("CHANGELOG.md");

const problems = [];

if (manifest.version !== pkg.version) {
  problems.push(
    `manifest.json is ${manifest.version} but package.json is ${pkg.version} — they must match.`
  );
}

// Chrome requires 1–4 dot-separated integers, each 0–65535, no leading zeros.
if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(manifest.version)) {
  problems.push(`manifest.json version "${manifest.version}" is not a valid Chrome version string.`);
}

if (!changelog.includes(`## [${pkg.version}]`)) {
  problems.push(
    `CHANGELOG.md has no "## [${pkg.version}]" section — every release needs an entry.`
  );
}

if (problems.length > 0) {
  console.error("Version check failed:\n");
  for (const p of problems) console.error(`  • ${p}`);
  console.error("");
  process.exit(1);
}

console.log(`Version check passed — ${pkg.version} is consistent across manifest, package, and changelog.`);
