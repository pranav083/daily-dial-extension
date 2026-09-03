#!/usr/bin/env node
/**
 * Loads the real extension into Chrome and drives it.
 *
 * Everything else that tests the UI runs against `docs/demo/`, where `chrome.*`
 * is a shim over localStorage. That is a good harness and it cannot answer the
 * questions that matter most about an extension: is the service worker alive,
 * are the alarms scheduled, does chrome.storage actually persist, did Chrome
 * accept the keyboard shortcut. The first time this ran it found that
 * Ctrl+Shift+D had never been assigned, because it collides with Chrome's own
 * "Bookmark all tabs" and Chrome declines such a suggestion in silence.
 *
 *   npm run smoke            # headless
 *   npm run smoke -- headful # watch it happen
 *
 * Two things about the plumbing, both of which cost an hour to discover:
 *
 *  - `--load-extension` was removed in Chrome 137. The replacement is
 *    `Extensions.loadUnpacked` over CDP on the *browser* session, which needs
 *    `--enable-unsafe-extension-debugging` to be permitted at all.
 *  - An unpacked extension's id is the SHA-256 of its absolute path: the first
 *    16 bytes, each nibble mapped 0-f to a-p. Computing it is far steadier
 *    than hunting for the right target in /json/list, which lists Chrome's own
 *    component extensions too.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const headful = process.argv.includes("headful");
const PORT = 9412;
const profile = join(tmpdir(), "daily-dial-smoke-profile");

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => existsSync(p));

if (!CHROME) {
  console.error("No Chrome found. This check needs a real browser; skipping is fine on CI without one.");
  process.exit(0);
}

const extensionId = (() => {
  const hex = createHash("sha256").update(root, "utf8").digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

const args = [
  `--remote-debugging-port=${PORT}`,
  "--no-first-run",
  `--user-data-dir=${profile}`,
  "--enable-unsafe-extension-debugging",
  "--window-size=1400,1100",
  "--hide-scrollbars",
];
if (!headful) args.unshift("--headless=new");
const chrome = spawn(CHROME, args, { stdio: "ignore" });

/** A tiny CDP client: enough to open a session, evaluate, and dispatch input. */
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return `EXC: ${String(r.result.exceptionDetails?.exception?.description || "").split("\n")[0]}`;
    return r.result?.result?.value;
  };
  return { ws, send, evaluate, events };
}

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`  ${pass ? "PASS" : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

try {
  await sleep(4500);
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  const loaded = await browser.send("Extensions.loadUnpacked", { path: root });
  browser.ws.close();
  if (!loaded.result?.id) throw new Error("Extensions.loadUnpacked failed: " + JSON.stringify(loaded.error));
  console.log(`${version.Browser} — loaded ${loaded.result.id}`);
  if (loaded.result.id !== extensionId) console.log(`  (note: computed id ${extensionId} differs from the loaded one)`);
  await sleep(1500);

  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const page = await connect(target.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Page.navigate", { url: `chrome-extension://${loaded.result.id}/dial.html` });
  await sleep(3000);

  check("the extension page loads", String(await page.evaluate("location.protocol")) === "chrome-extension:");

  const shortcut = await page.evaluate(
    `(async () => { const c = await chrome.commands.getAll();
       const o = c.find((x) => x.name === "open-dial");
       return o ? (o.shortcut || "") : "MISSING"; })()`
  );
  check("Chrome accepted the suggested keyboard shortcut", !!shortcut && shortcut !== "MISSING",
    shortcut ? `open-dial = ${shortcut}` : "assigned nothing — the suggested key probably collides with a Chrome one");

  const workers = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
    .filter((t) => t.type === "service_worker" && t.url.includes(loaded.result.id));
  check("the background service worker is running", workers.length > 0);

  const alarms = await page.evaluate(`(async () => (await chrome.alarms.getAll()).map((a) => a.name).join(","))()`);
  check("alarms are scheduled", String(alarms).length > 0, String(alarms));

  for (const [label, expr] of [
    ["chrome.storage.local", `typeof chrome.storage?.local?.getBytesInUse === "function"`],
    ["chrome.notifications", `typeof chrome.notifications?.create === "function"`],
    ["chrome.identity", `typeof chrome.identity?.launchWebAuthFlow === "function"`],
  ]) check(`${label} is available`, (await page.evaluate(expr)) === true);

  await page.evaluate(`(async () => { const p = (n) => String(n).padStart(2, "0"); const d = new Date();
    const k = "day:" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    const s = Array(96).fill(-1); for (let j = 36; j < 48; j++) s[j] = 0;
    await chrome.storage.local.set({ onboardingSeen: true, [k]: { slots: s, reflection: "", notes: [], intents: [], avoid: [] } }); })()`);
  await page.send("Page.reload");
  await sleep(2600);
  check("a day survives a reload through real chrome.storage",
    /3h/.test(String(await page.evaluate(`document.getElementById("breakdown-sum")?.textContent`))),
    String(await page.evaluate(`document.getElementById("breakdown-sum")?.textContent?.trim()`)));

  page.ws.close();
} finally {
  chrome.kill();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
