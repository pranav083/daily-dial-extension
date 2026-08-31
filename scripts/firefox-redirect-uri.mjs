#!/usr/bin/env node
/**
 * Prints the OAuth redirect URI Firefox will hand to Google for this add-on.
 *
 * Needed because Chrome and Firefox disagree, and Google's console will only
 * send a browser back to a URI that was registered in advance:
 *
 *   Chrome   https://<extension-id>.chromiumapp.org/
 *   Firefox  https://<sha1 of the gecko id>.extensions.allizom.org/
 *
 * Firefox derives that subdomain from the add-on id, which is exactly why the
 * id is pinned in build-firefox.mjs. Without a pinned id the URI changes on
 * every temporary install and no registration can ever match it.
 *
 * The algorithm is confirmed against Firefox's own test for the identity API,
 * which asserts that `identity@mozilla.org` maps to
 * 35b64b676900f491c00e7f618d43f7040e88422e — reproduced below as a self-check
 * so this script fails loudly if the derivation ever changes, rather than
 * printing a plausible-looking URI that Google will reject.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const sha1 = (s) => createHash("sha1").update(s, "utf8").digest("hex");

const CHECK_ID = "identity@mozilla.org";
const CHECK_HASH = "35b64b676900f491c00e7f618d43f7040e88422e";
if (sha1(CHECK_ID) !== CHECK_HASH) {
  console.error("Derivation self-check failed — do not trust the URI below.");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const id = process.argv[2] ?? (() => {
  const src = readFileSync(join(root, "scripts", "build-firefox.mjs"), "utf8");
  return src.match(/id:\s*"([^"]+)"/)?.[1];
})();

if (!id) {
  console.error("No add-on id. Pass one: node scripts/firefox-redirect-uri.mjs <id>");
  process.exit(1);
}

console.log(`add-on id    ${id}`);
console.log(`redirect URI https://${sha1(id)}.extensions.allizom.org/`);
console.log(`\nRegister that under Authorized redirect URIs on the same Google OAuth`);
console.log(`client as the Chrome one — additional, not instead of.`);
