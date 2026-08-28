#!/usr/bin/env node
/**
 * Regenerates icons/icon-{16,32,48,128}.png from one definition.
 *
 * Run with: npm run icons
 * Requires Google Chrome installed; run only when the mark changes.
 *
 * Small sizes are not scaled-down copies of the large one. Below ~32px the
 * seven-wedge dial turns to mush, so the geometry is simplified per size:
 * fewer, wider wedges and a proportionally thicker needle, keeping the
 * silhouette — ring, gap, needle — recognisable at 16px in a toolbar.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME =
  process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : process.env.CHROME_PATH || "google-chrome";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "icons");

/** Brand colours, matching the categorical palette in dial.css (dark theme). */
const BG = "#171c24";
const NEEDLE = "#e0a458";
const BLUE = "#3987e5";
const ORANGE = "#d95926";
const GREEN = "#199e70";
const PINK = "#d55181";

/**
 * Per-size geometry. `wedges` are [startDeg, endDeg, colour]; 0° is midnight,
 * running clockwise. `ring` is the band thickness as a fraction of the radius.
 */
const SIZES = [
  {
    px: 16,
    radius: 0.9,
    ring: 0.42,
    needleWidth: 0.1,
    cornerRadius: 0.17,
    gap: 0,
    wedges: [
      [30, 130, BLUE],
      [150, 250, ORANGE],
    ],
  },
  {
    px: 32,
    radius: 0.88,
    ring: 0.38,
    needleWidth: 0.075,
    cornerRadius: 0.19,
    gap: 3,
    wedges: [
      [25, 115, BLUE],
      [130, 210, ORANGE],
      [225, 290, GREEN],
    ],
  },
  {
    px: 48,
    radius: 0.86,
    ring: 0.36,
    needleWidth: 0.06,
    cornerRadius: 0.2,
    gap: 3,
    wedges: [
      [22, 100, BLUE],
      [112, 170, ORANGE],
      [182, 240, GREEN],
      [252, 300, PINK],
    ],
  },
  {
    px: 128,
    radius: 0.84,
    ring: 0.34,
    needleWidth: 0.04,
    cornerRadius: 0.22,
    gap: 2.5,
    wedges: [
      [20, 95, BLUE],
      [100, 150, ORANGE],
      [158, 205, GREEN],
      [212, 250, PINK],
      [258, 300, BLUE],
    ],
  },
];

function svgFor({ px, radius, ring, needleWidth, cornerRadius, gap, wedges }) {
  const c = px / 2;
  const rOuter = c * radius;
  const rInner = rOuter * (1 - ring);

  const polar = (r, deg) => {
    const rad = (deg * Math.PI) / 180;
    return { x: c + r * Math.sin(rad), y: c - r * Math.cos(rad) };
  };

  const wedge = (a0, a1) => {
    const large = a1 - a0 > 180 ? 1 : 0;
    const p1 = polar(rOuter, a0);
    const p2 = polar(rOuter, a1);
    const p3 = polar(rInner, a1);
    const p4 = polar(rInner, a0);
    return (
      `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}` +
      ` A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}` +
      ` L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}` +
      ` A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 ${large} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)} Z`
    );
  };

  const paths = wedges
    .map(([a0, a1, fill]) => `<path d="${wedge(a0 + gap, a1 - gap)}" fill="${fill}"/>`)
    .join("\n    ");

  // Needle points at midnight and stops short of the centre dot.
  const needleTop = c - rOuter * 0.98;
  const dotR = Math.max(1, px * needleWidth * 0.9);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">
  <rect width="${px}" height="${px}" rx="${(px * cornerRadius).toFixed(2)}" fill="${BG}"/>
  <g>
    ${paths}
  </g>
  <line x1="${c}" y1="${c}" x2="${c}" y2="${needleTop.toFixed(2)}"
        stroke="${NEEDLE}" stroke-width="${(px * needleWidth).toFixed(2)}" stroke-linecap="round"/>
  <circle cx="${c}" cy="${c}" r="${dotR.toFixed(2)}" fill="${NEEDLE}"/>
</svg>`;
}

if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}. Set CHROME_PATH to override.`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "dial-icons-"));

try {
  for (const size of SIZES) {
    const svgPath = join(work, `icon-${size.px}.svg`);
    const htmlPath = join(work, `icon-${size.px}.html`);
    const out = join(iconsDir, `icon-${size.px}.png`);

    writeFileSync(svgPath, svgFor(size));
    // Wrapped in HTML with zero margin so the capture is exactly the SVG box.
    writeFileSync(
      htmlPath,
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${svgFor(size)}`
    );

    execFileSync(
      CHROME,
      [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--default-background-color=00000000",
        `--window-size=${size.px},${size.px}`,
        `--screenshot=${out}`,
        `file://${htmlPath}`,
      ],
      { stdio: "ignore" }
    );

    console.log(`icons/icon-${size.px}.png`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log("\nDone. Verify with: npm run icons:verify");
