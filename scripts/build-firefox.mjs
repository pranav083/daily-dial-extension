#!/usr/bin/env node
/**
 * Produces a Firefox build in build/firefox/ from the Chrome sources.
 *
 * A transform rather than a second copy of the code: the two builds must not
 * drift, and every difference between them belongs in one readable list
 * below rather than scattered across duplicated files.
 *
 * Three things actually differ.
 *
 *  1. Firefox MV3 runs the background as an event page (`scripts`), not a
 *     service worker. Both keys cannot sit in the Chrome manifest without
 *     Chrome warning about the one it does not use.
 *  2. Firefox requires an extension id under `browser_specific_settings`
 *     before it will sign or install a build.
 *  3. `chrome.runtime.getContexts` does not exist there. That one is handled
 *     in background.js itself, which falls back to `extension.getViews` — no
 *     transform needed, and Chrome keeps using getContexts.
 *
 * Google Drive backup works: it uses `identity.launchWebAuthFlow`, which
 * Firefox supports, and deliberately never used Chrome-only `getAuthToken`.
 *
 * `web-ext lint` reports getContexts as unsupported. That is expected and
 * handled — background.js checks for it before calling it — but the linter
 * cannot see a runtime guard, so the warning stays. Zero errors is the bar
 * that matters for submission.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build", "firefox");

const FILES = [
  "dial.html", "dial.css", "dial.js", "i18n.js", "lib.js",
  "history.js", "historyLib.js", "drive.js", "suggestions.js", "background.js",
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) cpSync(join(root, f), join(out, f));
for (const d of ["_locales", "fonts", "icons"]) cpSync(join(root, d), join(out, d), { recursive: true });
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

// (1) event page, not service worker
manifest.background = { scripts: ["background.js"], type: "module" };

// (2) an id Firefox will accept
manifest.browser_specific_settings = {
  gecko: {
    id: "daily-dial@pranav083.github.io",
    strict_min_version: "121.0", // MV3 with module background is stable from here
    // Not declaring `data_collection_permissions` here on purpose. The key
    // needs a newer Firefox than this build targets, so adding it trades one
    // lint warning for two and narrows compatibility for no gain. AMO asks
    // the same question in the submission form, where the answer is "none":
    // the add-on collects nothing, and Drive backup sends the user's own data
    // to the user's own Drive on their explicit action.
  },
};

writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`build/firefox/ built from v${manifest.version} — event page, gecko id set`);
