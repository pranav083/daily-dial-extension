#!/usr/bin/env node
/**
 * Regenerates the Chrome Web Store screenshots from the running extension.
 *
 * By hand these go stale silently, and a stale screenshot is worse than a
 * missing one: the listing spent months advertising a build whose score
 * arithmetic had since been replaced and whose categories were a colour it no
 * longer used. Nothing failed, because nothing was checking. Running this
 * produces shots of the product as it currently is.
 *
 *   npm run shots            # docs/store/screenshot-*.png
 *   npm run shots -- headful
 *
 * 1280x800 is the Store's own size. Anything else is rejected at upload.
 */

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const headful = process.argv.includes("headful");
const PORT = 9432;
const W = 1280, H = 800;
const outDir = join(root, "docs", "store");
const profile = join(tmpdir(), "daily-dial-shots-profile");

const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => existsSync(p));
if (!CHROME) { console.error("No Chrome found."); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
mkdirSync(outDir, { recursive: true });

const args = [`--remote-debugging-port=${PORT}`, "--no-first-run", `--user-data-dir=${profile}`,
  "--enable-unsafe-extension-debugging", `--window-size=${W},${H}`, "--hide-scrollbars",
  "--force-device-scale-factor=1", "--force-color-profile=srgb"];
if (!headful) args.unshift("--headless=new");
const chrome = spawn(CHROME, args, { stdio: "ignore" });

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails?.exception?.description || "").split("\n")[0]);
    return r.result?.result?.value;
  };
  return { ws, send, evaluate };
}

let page;
async function shot(name) {
  await sleep(500);
  // No `clip`: its coordinates are page-relative, not viewport-relative, so a
  // clipped capture photographs the top of the document however far the page
  // has been scrolled. The scrolled shot came out as the unscrolled one with
  // a differently-drawn header, and then as a frame of empty space.
  const s = await page.send("Page.captureScreenshot", { format: "png" });
  const bytes = Buffer.from(s.result.data, "base64");
  writeFileSync(join(outDir, name), bytes);
  console.log(`  ${name}  ${(bytes.length / 1024).toFixed(0)}kB`);
  return bytes;
}

try {
  await sleep(4500);
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  const loaded = await browser.send("Extensions.loadUnpacked", { path: root });
  browser.ws.close();
  const extId = loaded.result?.id;
  if (!extId) throw new Error("could not load the extension");
  await sleep(1200);

  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  page = await connect(target.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Runtime.enable");

  // Late enough that a full day is paintable, and the housekeeping prompts
  // hidden — they are honest features that read as warnings in a storefront.
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const R = Date;
    const t = new R(); t.setHours(22, 15, 0, 0); const off = t - new R();
    function F(...a) { return a.length ? new R(...a) : new R(R.now() + off); }
    F.now = () => R.now() + off; F.parse = R.parse; F.UTC = R.UTC; F.prototype = R.prototype;
    Object.setPrototypeOf(F, R); window.Date = F;
    document.addEventListener("DOMContentLoaded", () => {
      const css = document.createElement("style");
      css.textContent = ".nudge-bar, #backup-nudge, #review-nudge { display: none !important; }";
      document.head.appendChild(css);
    }); })();` });

  await page.send("Page.navigate", { url: `chrome-extension://${extId}/dial.html` });
  await sleep(2500);
  await page.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  // A month of real-looking days, a live challenge, and a fully painted today.
  await page.evaluate(`(async () => {
    const p = (n) => String(n).padStart(2, "0");
    const key = (d) => d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    const plans = [[[0,2.5,5],[2.5,9,7],[9,12,0],[12,13,4],[13,16,2],[16,17.5,1],[17.5,19,6],[19,22,0]],
                   [[0,2,5],[2,9,7],[9,13,0],[13,14,4],[14,17,1],[17,19,6],[19,21.5,2]],
                   [[0,1.5,5],[1.5,8.5,7],[8.5,12,2],[12,13,4],[13,17,0],[17,18,3],[18,20,1]],
                   [[0,2,5],[2,9,7],[9,11,3],[11,13,0],[13,14,4],[14,18,2],[20,22,5]]];
    const set = { onboardingSeen: true };
    for (let i = 0; i < 27; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const s = Array(96).fill(-1);
      for (const [a, b, c] of plans[i % plans.length]) for (let j = Math.round(a * 4); j < Math.round(b * 4); j++) s[j] = c;
      set[key(d)] = undefined;
      set["day:" + key(d)] = {
        slots: s, reflection: i === 0 ? "Good morning, lost the middle of the afternoon." : "",
        notes: i === 0 ? [{ from: 36, to: 48, text: "the take-home, finally" }] : [],
        intents: i === 0 ? [{ text: "Finish the take-home", done: true }, { text: "Mail the professor", done: false }] : [],
        avoid: i === 0 ? ["Doom-scrolling"] : [],
      };
    }
    set.categories = [
      { name: "Deep Work", weight: 1, enabled: true, aliases: ["dw", "focus"], color: null },
      { name: "Applications", weight: 1, enabled: true, aliases: ["apps", "jobs"], color: null },
      { name: "Study", weight: 1, enabled: true, aliases: [], color: null },
      { name: "Admin", weight: 0, enabled: true, aliases: [], color: null },
      { name: "Break", weight: 0, enabled: true, aliases: [], color: null },
      { name: "Distraction", weight: -1, enabled: true, aliases: [], color: null },
      { name: "Exercise", weight: 1, enabled: true, aliases: ["gym", "run"], color: null },
      { name: "Sleep", weight: 0, enabled: true, aliases: [], color: null },
      { name: "Social", weight: 0, enabled: false, aliases: [], color: null },
      { name: "Errands", weight: 0, enabled: false, aliases: [], color: null },
    ];
    const start = new Date(); start.setDate(start.getDate() - 8);
    set.settings = {
      goals: { 0: 240 },
      challenge: { name: "#21days", startKey: key(start), targetDays: 21, goal: { kind: "minutes", categoryId: 0, minutes: 120 } },
    };
    await chrome.storage.local.set(set);
  })()`);
  await page.send("Page.reload");
  await sleep(2800);
  await page.evaluate(`document.getElementById("onboarding-overlay").hidden = true; window.scrollTo(0, 0)`);

  console.log("writing:");
  const first = await shot("screenshot-1-paint.png");

  // The read-out and the challenge sit below the fold at this height, so the
  // second shot scrolls to them. Verified by comparing the two files: the
  // first attempt used a selector that does not exist, scrolled nowhere, and
  // wrote the same image twice.
  const scrolled = await page.evaluate(`(() => {
    const el = document.getElementById("challenge-block") || document.querySelector(".side-card");
    if (!el) return 0;
    // Clamped to what can actually be scrolled. Aiming at an element near the
    // bottom of a short page scrolls past the content and photographs the
    // empty space below it, which is what the first attempt did.
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const y = el.getBoundingClientRect().top + window.scrollY - 150;
    window.scrollTo({ top: Math.min(Math.max(0, y), maxY), behavior: "auto" });
    return Math.round(window.scrollY);
  })()`);
  if (!scrolled) throw new Error("the read-out shot did not scroll — it would duplicate shot 1");
  const second = await shot("screenshot-2-read.png");
  if (second.equals(first)) throw new Error("shot 2 is identical to shot 1");

  await page.evaluate(`document.querySelector('[data-view="history"]').click()`);
  await sleep(1200);
  await page.evaluate(`(() => { const s = document.getElementById("hist-colour-by");
    if (s) { s.value = "category"; s.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
  await sleep(900);
  await page.evaluate(`window.scrollTo(0, 0)`);
  await shot("screenshot-3-history.png");

  await page.evaluate(`document.querySelector('[data-view="day"]').click()`);
  await sleep(600);
  await page.evaluate(`document.getElementById("open-settings").click()`);
  await sleep(800);
  await shot("screenshot-4-categories.png");

  page.ws.close();
} finally {
  chrome.kill();
}
console.log(`\n${outDir} — 1280x800, from the running extension`);
