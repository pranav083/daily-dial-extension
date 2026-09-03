#!/usr/bin/env node
/**
 * Records the store promo video by driving the real extension.
 *
 * Not a mockup and not a screen recording of me clicking: the browser paints
 * a real day through real pointer events, and every number on screen is the
 * app's own arithmetic on that day. If the product changes, re-running this
 * produces a video of the product as it now is, which a hand-made recording
 * cannot promise.
 *
 *   npm run promo            # build/promo/daily-dial-promo.mp4
 *   npm run promo -- headful # watch it being recorded
 *
 * The Chrome Web Store takes a YouTube URL rather than a file, so the output
 * is an MP4 to upload there first.
 *
 * Frames are captured only when something changes; still moments are one
 * frame with a duration, assembled by ffmpeg's concat demuxer. A 40-second
 * video at 25fps would otherwise be a thousand 1080p PNGs on disk to say very
 * little.
 */

import { spawn, spawnSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const headful = process.argv.includes("headful");
const PORT = 9422;
const W = 1920, H = 1080, FPS = 25;
const outDir = join(root, "build", "promo");
const frameDir = join(tmpdir(), "daily-dial-promo-frames");
const profile = join(tmpdir(), "daily-dial-promo-profile");

const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => existsSync(p));
if (!CHROME) { console.error("No Chrome found."); process.exit(1); }
if (spawnSync("ffmpeg", ["-version"]).status !== 0) { console.error("ffmpeg is required."); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const d of [frameDir, profile]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }
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

const timeline = [];   // { file, duration }
let frameNo = 0;
let page;

/** One frame, held for `seconds`. */
async function frame(seconds = 1 / FPS) {
  const shot = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 92 });
  const file = join(frameDir, `f${String(++frameNo).padStart(5, "0")}.jpg`);
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  timeline.push({ file, duration: seconds });
}
const hold = (seconds) => frame(seconds);

/** A caption, faded in over the app. Plain DOM so it matches the product. */
async function caption(text, sub = "") {
  if (text) console.log(`  at ${timeline.reduce((a, f) => a + f.duration, 0).toFixed(1).padStart(5)}s  ${text}`);
  await page.evaluate(`(() => {
    let el = document.getElementById("__promo");
    if (!el) {
      el = document.createElement("div"); el.id = "__promo";
      el.style.cssText = "position:fixed;left:0;right:0;bottom:54px;z-index:99999;text-align:center;" +
        "pointer-events:none;font-family:ui-sans-serif,system-ui,sans-serif;transition:opacity .25s ease;" +
        "direction:ltr;unicode-bidi:isolate";
      el.setAttribute("dir", "ltr");
      document.body.appendChild(el);
    }
    el.innerHTML = ${JSON.stringify(text)}
      ? '<div style="display:inline-block;background:rgba(12,14,18,.82);backdrop-filter:blur(8px);' +
        'border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:14px 26px">' +
        '<div style="font-size:30px;font-weight:800;color:#f2f5f7;letter-spacing:-.01em">' + ${JSON.stringify(text)} + '</div>' +
        (${JSON.stringify(sub)} ? '<div style="font-size:17px;color:#aeb6bf;margin-top:5px">' + ${JSON.stringify(sub)} + '</div>' : '') +
        '</div>' : '';
    el.style.opacity = ${JSON.stringify(text)} ? "1" : "0";
  })()`);
}

const pointFor = async (hour) => JSON.parse(await page.evaluate(`(() => {
  const svg = document.getElementById("dial"), r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  const CX = vb.width / 2, CY = vb.height / 2, R = CX * 0.80, a = ((${hour} + 0.125) / 24) * 360 - 90;
  const x = CX + R * Math.cos(a * Math.PI / 180), y = CY + R * Math.sin(a * Math.PI / 180);
  return JSON.stringify({ x: Math.round(r.left + (x / vb.width) * r.width), y: Math.round(r.top + (y / vb.height) * r.height) });
})()`));

const mouse = (type, p) => page.send("Input.dispatchMouseEvent",
  { type, x: p.x, y: p.y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, pointerType: "mouse" });

/** Paints a stretch the way a person would — a press, a sweep, a release —
 *  capturing the ring as it fills rather than cutting to the result. */
async function paint(penIndex, fromHour, toHour, steps = 14) {
  await page.evaluate(`document.querySelectorAll(".pens .pen")[${penIndex}].click()`);
  await frame(0.16);
  const a = await pointFor(fromHour);
  await mouse("mousePressed", a);
  await frame(1 / FPS);
  // Release on the last slot *inside* the range, not on the boundary. pointFor
  // aims at a slot's centre, so releasing at `toHour` lands one slot past the
  // end — each block finished 15 minutes late and the next drag then began on
  // top of it, which the app correctly refuses with "already logged". Real
  // behaviour, caused entirely by the camera.
  // A slot is a quarter hour and pointFor already aims at a slot's centre, so
  // the last slot inside the range starts a full 0.25 before the boundary.
  // Subtracting 0.125 only cancelled pointFor's own offset and still landed on
  // the boundary slot, which the next block then began on.
  const end = toHour - 0.25;
  for (let i = 1; i <= steps; i++) {
    const h = fromHour + ((end - fromHour) * i) / steps;
    await mouse("mouseMoved", await pointFor(h));
    await frame(0.055);
  }
  await mouse("mouseReleased", await pointFor(end));
  // Step the pointer off the ring. Left on a painted block it keeps the hover
  // hint open ("Already Break — double-click to replace it"), which is correct
  // behaviour and reads as an error message in a video.
  await mouse("mouseMoved", { x: 40, y: 640 });
  await frame(0.12);
}

try {
  await sleep(4500);
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  const loaded = await browser.send("Extensions.loadUnpacked", { path: root });
  browser.ws.close();
  const extId = loaded.result?.id;
  if (!extId) throw new Error("could not load the extension: " + JSON.stringify(loaded.error));
  await sleep(1200);

  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  page = await connect(target.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Runtime.enable");

  // Late in the evening, so every hour of the day can be painted on camera.
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const R = Date;
    const t = new R(); t.setHours(23, 30, 0, 0); const off = t - new R();
    function F(...a) { return a.length ? new R(...a) : new R(R.now() + off); }
    F.now = () => R.now() + off; F.parse = R.parse; F.UTC = R.UTC; F.prototype = R.prototype;
    Object.setPrototypeOf(F, R); window.Date = F; })();` });

  // A promo should show the product, not the housekeeping. The backup and
  // review prompts are honest features and they read as warnings in a video,
  // so they are hidden for the recording only — nothing else is staged.
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    document.addEventListener("DOMContentLoaded", () => {
      const css = document.createElement("style");
      css.textContent = ".nudge-bar, #backup-nudge, #review-nudge { display: none !important; }";
      document.head.appendChild(css);
    });` });

  await page.send("Page.navigate", { url: `chrome-extension://${extId}/dial.html` });
  await sleep(2500);

  // 1280x720 CSS at 1.5x captures a native 1920x1080, and at 1280 the app
  // fills the frame instead of sitting in a column with dead space either
  // side, which is what a 1920-wide viewport gives.
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false });
  await sleep(600);

  // A fortnight of history behind today, so the week strip and the month view
  // have something true to show. Today itself is left empty — it gets painted.
  await page.evaluate(`(async () => {
    const p = (n) => String(n).padStart(2, "0");
    const key = (d) => "day:" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    const plans = [[[9,13,0],[13,15,1],[15,16,4],[16,18,2],[20,21,5]], [[8,12,0],[12,13,4],[13,17,2],[19,21,1]],
                   [[10,12,2],[12,13,4],[13,15,0],[19,22,5]], [[9,11,1],[11,12,4],[12,16,0],[16,18,2]],
                   [[8,10,2],[10,13,0],[13,14,4],[14,17,1],[21,22,5]]];
    const set = { onboardingSeen: true };
    for (let i = 1; i <= 26; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const s = Array(96).fill(-1);
      for (const [a, b, c] of plans[i % plans.length]) for (let j = a * 4; j < b * 4; j++) s[j] = c;
      set[key(d)] = { slots: s, reflection: "", notes: [], intents: [], avoid: [] };
    }
    await chrome.storage.local.set(set);
  })()`);
  await page.send("Page.reload");
  await sleep(2600);
  await page.evaluate(`document.getElementById("onboarding-overlay").hidden = true`);
  await page.evaluate(`window.scrollTo(0, 0)`);

  console.log("recording…");

  /** Types into a field one character at a time, so it reads as typing. */
  async function type(selector, text, per = 0.05) {
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    for (const ch of text) {
      await page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)});
        i.value += ${JSON.stringify(ch)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await frame(per);
    }
  }
  /** Scroll position is part of the shot. Left to itself, focus() on an
   *  off-screen field scrolls the page out from under the camera and frames
   *  land mid-jump, so every scene says where it is looking and waits. */
  const look = async (y) => {
    await page.evaluate(`window.scrollTo({ top: ${y}, behavior: "auto" })`);
    await sleep(450);
  };
  /** Puts an element's top a fixed distance below the viewport top, so a
   *  section below the fold is composed deliberately rather than landing
   *  wherever scrollIntoView happens to leave it — which cut headers in half
   *  and framed fragments. */
  const frameOn = async (selector, offsetTop = 120) => {
    await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return; const y = el.getBoundingClientRect().top + window.scrollY - ${offsetTop};
      window.scrollTo({ top: Math.max(0, y), behavior: "auto" }); })()`);
    await sleep(500);
  };
  const click = async (selector, settle = 500) => {
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    await sleep(settle);
  };
  const keyStroke = async (key, code, modifiers) => {
    for (const type of ["keyDown", "keyUp"]) {
      await page.send("Input.dispatchKeyEvent", { type, key, code, modifiers, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
    }
    await sleep(260);
  };

  /* ---- the day ---- */
  await caption("Where did today actually go?");
  await hold(2.2);

  await caption("Pick a category. Drag around the ring.");
  await paint(0, 9, 13);
  await hold(0.4);
  await caption("");
  await paint(1, 13, 15, 8);
  await paint(4, 15, 16, 5);
  await paint(2, 16, 18, 8);
  await hold(0.3);
  await caption("A whole day, in about ten seconds.");
  await paint(5, 20, 22, 8);
  await hold(2.0);

  await sleep(2800);
  await caption("Then see whether it went where you meant.");
  await hold(3.0);

  /* ---- typing, and taking it back ---- */
  await caption("Or type it, if that is faster.");
  await type("#typed-entry-input", "19-20 admin", 0.055);
  await hold(0.5);
  await page.evaluate(`document.getElementById("typed-entry-form")?.requestSubmit?.()`);
  await sleep(500);
  await hold(1.6);

  await caption("Changed your mind? Undo goes thirty strokes deep.");
  await keyStroke("z", "KeyZ", 4);
  await hold(1.9);
  await keyStroke("z", "KeyZ", 4 | 8);
  await hold(1.4);

  /* ---- the journal ---- */
  await sleep(2600);
  await frameOn("#intent-list", 300);
  await caption("Set the day's intentions. Tick them off.");
  await hold(0.5);
  await type("#intent-input", "Finish the take-home", 0.045);
  await page.evaluate(`document.getElementById("intent-form")?.requestSubmit?.()`);
  await sleep(500);
  await hold(1.0);
  await page.evaluate(`document.querySelector("#intent-list input[type=checkbox]")?.click()`);
  await sleep(400);
  await hold(1.8);

  await frameOn(".breakdown", 90);
  await caption("Say what happened, on the row itself.");
  await hold(0.5);
  await type("#breakdown-rows tr:nth-child(2) .bd-note", "shipped the release", 0.04);
  await page.evaluate(`document.querySelector("#breakdown-rows tr:nth-child(2) .bd-note")?.blur()`);
  await sleep(500);
  await hold(2.0);

  /* ---- the ring, other ways round ---- */
  await look(0);
  await caption("One ring — or twelve hours at a time.");
  await hold(0.4);
  await click(`#dial-layout-switch button[data-mode="ampm-toggle"]`, 800);
  await hold(2.2);
  await click("#toggle-pm-btn", 700);
  await hold(2.2);
  await click(`#dial-layout-switch button[data-mode="24h"]`, 700);
  await hold(0.5);

  await look(0);
  await caption("Light or dark, whichever suits.");
  // The button cycles system to light to dark, and which of those "system"
  // resolves to depends on the machine — so press it until the page is
  // actually light rather than assuming a click count.
  const isLight = async () => {
    const bg = await page.evaluate(`getComputedStyle(document.body).backgroundColor`);
    const [r, g, b] = (bg.match(/\d+/g) || [0, 0, 0]).map(Number);
    return (r + g + b) / 3 > 128;
  };
  for (let i = 0; i < 3 && !(await isLight()); i++) await click("#theme-toggle", 550);
  await hold(2.8);
  for (let i = 0; i < 3 && (await isLight()); i++) await click("#theme-toggle", 550);
  await hold(0.6);

  /* ---- the long view ---- */
  await sleep(2200);
  await look(0);
  await caption("Every day you log, at a glance.");
  await hold(0.3);
  await page.evaluate(`document.querySelector('[data-view="history"]').click()`);
  await sleep(1200);
  await hold(3.2);

  await caption("It notices patterns — and states them as facts, not advice.");
  await frameOn("#review-list", 130);
  await hold(3.4);
  await look(0);
  await page.evaluate(`document.querySelector('[data-view="day"]').click()`);
  await sleep(800);

  /* ---- ten languages ---- */
  await look(0);
  await caption("Ten languages, right-to-left included.");
  await hold(0.4);
  await page.evaluate(`(() => { const s = document.getElementById("language-select");
    if (s) { s.value = "ar"; s.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
  await sleep(2600);                       // the app reloads to switch language
  await page.evaluate(`document.getElementById("onboarding-overlay").hidden = true`);
  await caption("Ten languages, right-to-left included.");
  await hold(3.2);
  await page.evaluate(`(() => { const s = document.getElementById("language-select");
    if (s) { s.value = "en"; s.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
  await sleep(2600);
  await page.evaluate(`document.getElementById("onboarding-overlay").hidden = true`);
  await hold(0.4);

  /* ---- close ---- */
  await look(0);
  await caption("No account. No server. Nothing leaves your browser.", "Free and open source");
  await hold(3.6);
  await caption("");
  await hold(0.8);

  page.ws.close();
} finally {
  chrome.kill();
}

// ffmpeg's concat demuxer wants the last entry repeated to honour its duration.
const list =
  timeline.map((f) => `file '${f.file}'\nduration ${f.duration.toFixed(3)}`).join("\n") +
  `\nfile '${timeline.at(-1).file}'\n`;
const listFile = join(frameDir, "list.txt");
writeFileSync(listFile, list);

const mp4 = join(outDir, "daily-dial-promo.mp4");
const enc = spawnSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile,
  "-vf", `fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart", mp4], { stdio: "inherit" });
if (enc.status !== 0) process.exit(1);

const seconds = timeline.reduce((a, f) => a + f.duration, 0);
console.log(`\n${mp4}\n${timeline.length} frames, ${seconds.toFixed(1)}s`);
