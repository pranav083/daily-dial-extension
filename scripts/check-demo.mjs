#!/usr/bin/env node
/**
 * Fails if docs/demo/ no longer matches the extension it was built from.
 *
 * A stale demo is worse than none: someone tries a version that behaves
 * differently from the one they install, and the difference is invisible
 * from the outside. Run by `npm run check`; the fix is `npm run build:demo`.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const demo = join(root, "docs", "demo");
const FILES = ["dial.css", "dial.js", "i18n.js", "lib.js", "history.js", "historyLib.js", "drive.js", "suggestions.js"];

if (!existsSync(demo)) {
  console.error("docs/demo/ is missing. Run `npm run build:demo`.");
  process.exit(1);
}
const stale = FILES.filter((f) => readFileSync(join(root, f), "utf8") !== readFileSync(join(demo, f), "utf8"));
const version = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version;
if (!readFileSync(join(demo, "demo-shim.js"), "utf8").includes(`"${version}"`)) stale.push("manifest version");

if (stale.length) {
  console.error(`The playable demo is behind the extension (${stale.join(", ")}).\nRun \`npm run build:demo\`.`);
  process.exit(1);
}
console.log(`Demo check passed — docs/demo/ matches the extension at v${version}.`);

// Jekyll drops underscore-prefixed directories unless _config.yml says
// otherwise. The demo loads its catalogs from _locales at runtime, so getting
// this wrong publishes a demo where every string is a humanised key — which
// looks like the app is broken, and is invisible until someone opens it.
const config = readFileSync(join(root, "docs", "_config.yml"), "utf8");
if (!/^include:\s*(\n\s*-\s*_locales)/m.test(config)) {
  console.error("docs/_config.yml must `include: [_locales]`, or the demo publishes with no translations.");
  process.exit(1);
}
