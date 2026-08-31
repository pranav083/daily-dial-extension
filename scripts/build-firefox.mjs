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
 *  3. AMO requires `data_collection_permissions`, which in turn sets the
 *     version floor. See the manifest block below for both.
 *
 * Google Drive backup works: it uses `identity.launchWebAuthFlow`, which
 * Firefox supports, and deliberately never used Chrome-only `getAuthToken`.
 * Its redirect URI differs from Chrome's and must be registered separately —
 * `npm run firefox:redirect` prints it.
 *
 * A warning about local linting: `addons-linter` reports a missing
 * `data_collection_permissions` as a *warning*, while AMO rejects the upload
 * over it with an *error*. Only AMO knows an extension is new, so this
 * particular failure cannot be reproduced here at any linter version. A clean
 * `web-ext lint` is necessary and not sufficient; the upload is the real test.
 *
 * What remains after this build is two `innerHTML` warnings, both on strings
 * whose every substitution goes through escapeHtml() first. They are answered
 * in the reviewer note rather than silenced.
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

// (2) an id Firefox will accept, and the data-consent declaration AMO requires
manifest.browser_specific_settings = {
  gecko: {
    id: "daily-dial@pranav083.github.io",

    // 140, not the 121 this originally targeted. `data_collection_permissions`
    // below needs 140 on desktop and 142 on Android, and AMO rejects a new
    // extension that omits it. Raising the floor turned out to cost nothing
    // and pay for itself: `runtime.getContexts` ships in 140, so four
    // compatibility warnings disappeared along with the error.
    strict_min_version: "140.0",

    // "none" is a claim about what this add-on does on its own, and it is
    // true: there is no server of ours, no analytics, and no host permissions,
    // so the browser would refuse an outbound request even if the code made
    // one.
    //
    // Google Drive backup is the case worth thinking about, since it plainly
    // moves data off the device. It is off until switched on, it goes to the
    // user's own Drive rather than anywhere of ours, and every transfer is one
    // deliberate click — which is Mozilla's own description of implicit
    // consent. Declaring it as `required` would show every installer a
    // data-collection warning for a feature most will never enable, which
    // misleads far more people than it informs.
    //
    // Declaring it under `optional` was the other candidate and is rejected on
    // purpose. Firefox renders an optional data permission as a toggle in
    // about:addons, and nothing in this code reads that toggle — so denying it
    // would leave Drive backup working exactly as before. A control that does
    // not control anything is worse than no control. If it is ever declared,
    // it gets declared together with a real `permissions.request()` check.
    //
    // The reviewer note in docs/AMO_LISTING.md states all of this plainly
    // rather than leaving a reviewer to find the `identity` permission and
    // wonder.
    data_collection_permissions: { required: ["none"] },
  },

  // Stated explicitly so the version floor is right on Android too, where the
  // key landed in 142 rather than 140. Without this the linter assumes the
  // desktop minimum applies and warns.
  gecko_android: { strict_min_version: "142.0" },
};

writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`build/firefox/ built from v${manifest.version} — event page, gecko id set`);
