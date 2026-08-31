# Build instructions

How to produce the submitted Firefox package from this source archive.

This exists to satisfy AMO's source code submission requirements, so it states
the environment and the exact commands rather than assuming anything.

---

## Requirements

| | |
|---|---|
| Operating system | Any. macOS, Linux, or Windows — no platform-specific steps, no native code, no compilation. |
| Node.js | **18.0 or newer.** Download: <https://nodejs.org/en/download> (or `brew install node`, `apt install nodejs`, `winget install OpenJS.NodeJS`). Verify with `node --version`. |
| npm | **Not required to build.** See below. |
| Anything else | Nothing. No compilers, no system libraries, no network access during the build. |

### Why npm is not needed

`scripts/build-firefox.mjs` imports only Node builtins — `node:fs`, `node:url`
and `node:path`. The add-on itself has **zero runtime dependencies**: no
framework, no bundled library, no third-party code of any kind.

`package.json` does list devDependencies (`web-ext`, `eslint`,
`addons-linter`). Those are for linting and packaging only. None of them runs
during the build and none contributes a byte to the output, so
`npm install` is optional and only needed if you want to re-run the linter.

---

## Build

Two commands, from the root of this archive:

```bash
node scripts/build-firefox.mjs      # writes build/firefox/
cd build/firefox && zip -r ../firefox.zip .
```

`build/firefox/` is the complete add-on. Zipped, it is the submitted package.

If you have npm available, `npm run build:firefox` runs the identical script.

---

## What the build does

It copies every source file unchanged and rewrites exactly **one** file,
`manifest.json`, with the three differences Firefox requires:

1. **Background** — Chrome's service worker becomes an event page:
   `{"scripts": ["background.js"], "type": "module"}`. Both keys cannot sit in
   one manifest without Chrome warning about the one it ignores.
2. **`browser_specific_settings.gecko`** — the add-on id (Firefox will not
   sign without one), `strict_min_version: "140.0"`, and
   `data_collection_permissions: { required: ["none"] }`. The version floor is
   set by that last key, which needs Firefox 140.
3. **`browser_specific_settings.gecko_android`** — `strict_min_version:
   "142.0"`, where the same key landed on Android.

Everything else — all JavaScript, HTML, CSS, locales, fonts and icons — is
**byte-identical** to this archive. Nothing is transpiled, concatenated,
minified, bundled, templated, or otherwise machine-generated. The JavaScript
you read here is the JavaScript that runs.

---

## Verifying that claim

You do not have to take the paragraph above on trust:

```bash
node scripts/build-firefox.mjs
diff -r build/firefox /path/to/unzipped-submitted-package
```

The only file that differs is `manifest.json`. Everything else compares equal.

This has been checked from a clean `git archive` checkout with no
`node_modules` present: the build reproduces the submitted package exactly.

---

## Tests and linting (optional)

Not part of the build, but available if useful:

```bash
npm install          # only needed for these
npm run check        # unit tests, plus version/package/locale/demo consistency
npm run lint:firefox # addons-linter against build/firefox
```

`npm run check` runs the test suite on Node's built-in runner — no test
framework is installed. The lint reports 0 errors and 2 warnings, both
`innerHTML` assignments whose every substituted value passes through
`escapeHtml()` first.

---

## Source

The same code is public under the MIT licence at
<https://github.com/pranav083/daily-dial-extension>, tagged per release.
