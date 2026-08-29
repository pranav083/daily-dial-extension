#!/usr/bin/env node
/**
 * Guards that every module the extension actually loads is in the zip.
 *
 * `npm run package` lists its files by hand, which is fine until a new module
 * is added — `suggestions.js` shipped in v1.16.0 imported by dial.js and
 * history.js but missing from that list, so the packaged extension would have
 * failed to load with a bare module-resolution error and nothing in the repo
 * would have caught it. The release workflow builds from the same script, so
 * a broken zip would have gone straight to a GitHub release.
 *
 * Walks the real import graph from the extension's two entry points rather
 * than trusting a second hand-maintained list, which would just be the same
 * problem again.
 *
 * Run by `npm run check` and by CI.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(root, name), "utf8");

/** Chrome loads these directly: one from dial.html, one from the manifest. */
const ENTRY_POINTS = ["dial.js", "background.js"];

/** Every local module reachable from the entry points. */
function reachableModules() {
  const seen = new Set();
  const queue = [...ENTRY_POINTS];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    // Matches `from "./x.js"` and `import("./x.js")` — relative local imports
    // only, which is all this project has.
    for (const [, dep] of read(file).matchAll(/["']\.\/([a-zA-Z0-9_-]+\.js)["']/g)) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return seen;
}

const packageScript = JSON.parse(read("package.json")).scripts.package;
const packaged = new Set(packageScript.match(/[a-zA-Z0-9_-]+\.js/g) ?? []);

const missing = [...reachableModules()].filter((f) => !packaged.has(f)).sort();

if (missing.length) {
  console.error(
    `The package script is missing ${missing.length} module(s) the extension imports:\n` +
      missing.map((f) => `  - ${f}`).join("\n") +
      `\n\nAdd them to the "package" script in package.json, or the built zip will\n` +
      `fail to load with a module-resolution error.`
  );
  process.exit(1);
}

console.log(`Package check passed — all ${reachableModules().size} imported modules are in the zip.`);
